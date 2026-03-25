import type { LoadedBenchmarkSuite } from '@gdh/benchmark-cases';
import type { BaselineRef, BenchmarkRun, ThresholdPolicy } from '@gdh/domain';
import { BenchmarkRunSchema, createRunEvent } from '@gdh/domain';
import { createIsoTimestamp, createRunId } from '@gdh/shared';
import { compareBenchmarkRuns } from './comparison.js';
import { type LoadedBenchmarkConfig, loadBenchmarkConfig } from './config.js';
import {
  baselineRefFromRun,
  benchmarkRunFilePath,
  loadBenchmarkRun,
  loadBenchmarkRunFromPath,
} from './runs.js';
import {
  aggregateRunScore,
  createEmptyBenchmarkScore,
  defaultThresholdPolicy,
  mergeThresholdPolicy,
} from './scoring.js';
import {
  loadBenchmarkCatalogData,
  resolveBenchmarkCaseExecutionMode,
  resolveBenchmarkTargetContext,
} from './session/catalog.js';
import {
  createBenchmarkArtifactStore,
  persistBenchmarkRun,
  persistComparisonArtifacts,
} from './session/persistence.js';
import type {
  BenchmarkCaseExecutor,
  BenchmarkComparisonResult,
  BenchmarkRunComparisonRequest,
  BenchmarkTargetRunRequest,
  BenchmarkTargetRunResult,
  BenchmarkTargetService,
} from './types.js';
import { executeBenchmarkCase } from './workspace.js';

function benchmarkSummaryLine(
  caseResults: BenchmarkRun['caseResults'],
  score: BenchmarkRun['score'],
): string {
  const passedCases = caseResults.filter((caseResult) => caseResult.status === 'passed').length;
  return `${passedCases}/${caseResults.length} benchmark case(s) passed; overall score ${score.normalizedScore.toFixed(2)}.`;
}

function suiteThresholdPolicy(
  config: LoadedBenchmarkConfig,
  suite: LoadedBenchmarkSuite | undefined,
): ThresholdPolicy {
  return mergeThresholdPolicy(config.thresholds, suite?.thresholds);
}

function requireBenchmarkExecutor(
  executeCase: BenchmarkCaseExecutor | undefined,
): BenchmarkCaseExecutor {
  if (executeCase) {
    return executeCase;
  }

  throw new Error(
    'Benchmark target execution requires an executeCase implementation in the run request.',
  );
}

export function createBenchmarkTargetService(): BenchmarkTargetService {
  return {
    async runTarget(request: BenchmarkTargetRunRequest): Promise<BenchmarkTargetRunResult> {
      const executeCase = requireBenchmarkExecutor(request.executeCase);
      const resolvedTarget = await resolveBenchmarkTargetContext(
        request.repoRoot,
        request.targetId,
      );
      const config = await loadBenchmarkConfig(request.repoRoot);
      const thresholdPolicy = suiteThresholdPolicy(config, resolvedTarget.suite);
      const benchmarkRunId = createRunId(`benchmark-${request.targetId}`);
      const artifactStore = createBenchmarkArtifactStore(request.repoRoot, benchmarkRunId);
      const startedAt = createIsoTimestamp();

      await artifactStore.initialize();
      await artifactStore.appendEvent(
        createRunEvent(benchmarkRunId, 'benchmark.run.started', {
          mode: request.ciSafe ? 'ci_safe' : (resolvedTarget.suite?.mode ?? 'ci_safe'),
          targetId: request.targetId,
          targetKind: resolvedTarget.target.kind,
        }),
      );

      if (resolvedTarget.target.kind === 'suite') {
        await artifactStore.writeJsonArtifact(
          'benchmark-suite',
          'benchmark.suite.json',
          resolvedTarget.target.suite,
          'Resolved benchmark suite definition.',
        );
      }

      const initialRun = BenchmarkRunSchema.parse({
        id: benchmarkRunId,
        status: 'running',
        target: {
          kind: resolvedTarget.target.kind,
          id: request.targetId,
        },
        suiteId: resolvedTarget.suite?.id,
        caseIds: resolvedTarget.caseDefinitions.map((caseDefinition) => caseDefinition.id),
        mode: request.ciSafe ? 'ci_safe' : (resolvedTarget.suite?.mode ?? 'ci_safe'),
        repoRoot: request.repoRoot,
        runDirectory: artifactStore.runDirectory,
        configuration: {
          ciSafe: Boolean(request.ciSafe),
          targetId: request.targetId,
          targetKind: resolvedTarget.target.kind,
          suiteId: resolvedTarget.suite?.id,
          thresholdPolicy,
          baseline: resolvedTarget.suite?.baseline
            ? {
                ...resolvedTarget.suite.baseline,
                artifactPath:
                  resolvedTarget.suite.resolvedBaselineArtifactPath ??
                  resolvedTarget.suite.baseline.artifactPath,
              }
            : undefined,
        },
        score: createEmptyBenchmarkScore('Benchmark run is still executing.'),
        caseResults: [],
        startedAt,
        summary: `Benchmark run "${benchmarkRunId}" is executing.`,
      });
      await persistBenchmarkRun(artifactStore, initialRun);

      const caseResults = [];

      for (const caseDefinition of resolvedTarget.caseDefinitions) {
        await artifactStore.appendEvent(
          createRunEvent(benchmarkRunId, 'benchmark.case.started', {
            caseId: caseDefinition.id,
            title: caseDefinition.title,
          }),
        );
        await artifactStore.writeJsonArtifact(
          'benchmark-case-definition',
          `cases/${caseDefinition.id}.definition.json`,
          caseDefinition,
          'Resolved benchmark case definition.',
        );
        const mode = resolveBenchmarkCaseExecutionMode(
          caseDefinition,
          resolvedTarget.suite,
          Boolean(request.ciSafe),
        );
        const caseResult = await executeBenchmarkCase(
          benchmarkRunId,
          request.repoRoot,
          caseDefinition,
          mode,
          executeCase,
        );

        caseResults.push(caseResult);
        await artifactStore.writeJsonArtifact(
          'benchmark-case-result',
          `cases/${caseDefinition.id}.result.json`,
          caseResult,
          'Per-case benchmark execution result and explicit score breakdown.',
        );
        await artifactStore.appendEvent(
          createRunEvent(benchmarkRunId, 'benchmark.case.completed', {
            caseId: caseDefinition.id,
            score: caseResult.score.normalizedScore,
            status: caseResult.status,
          }),
        );
      }

      const score = aggregateRunScore(caseResults);
      let benchmarkRun = BenchmarkRunSchema.parse({
        ...initialRun,
        status: caseResults.every((caseResult) => caseResult.status === 'passed')
          ? 'completed'
          : 'failed',
        completedAt: createIsoTimestamp(),
        score,
        caseResults,
        summary: benchmarkSummaryLine(caseResults, score),
      });
      let comparisonReport: BenchmarkTargetRunResult['comparisonReport'];
      let regressionResult: BenchmarkTargetRunResult['regressionResult'];

      if (
        resolvedTarget.target.kind === 'suite' &&
        resolvedTarget.suite?.baseline &&
        resolvedTarget.suite.resolvedBaselineArtifactPath
      ) {
        const rhsRun = await loadBenchmarkRunFromPath(
          resolvedTarget.suite.resolvedBaselineArtifactPath,
          `benchmark baseline "${resolvedTarget.suite.baseline.label}"`,
        );
        const rhsRef: BaselineRef = {
          ...resolvedTarget.suite.baseline,
          artifactPath: resolvedTarget.suite.resolvedBaselineArtifactPath,
        };

        await artifactStore.appendEvent(
          createRunEvent(benchmarkRunId, 'benchmark.compare.started', {
            baselineId: rhsRef.id,
            baselinePath: rhsRef.artifactPath,
          }),
        );
        const comparison = await compareBenchmarkRuns({
          lhsRun: benchmarkRun,
          lhsRunFilePath: benchmarkRunFilePath(request.repoRoot, benchmarkRun.id),
          rhsRef,
          rhsRun,
          thresholdPolicy,
        });

        comparisonReport = comparison.comparisonReport;
        regressionResult = comparison.regressionResult;
        benchmarkRun = await persistComparisonArtifacts(
          artifactStore,
          benchmarkRun,
          comparisonReport,
          regressionResult,
        );
        await artifactStore.appendEvent(
          createRunEvent(benchmarkRunId, 'benchmark.compare.completed', {
            baselineId: rhsRef.id,
            comparisonReportPath: benchmarkRun.comparisonReportPath,
            regressionStatus: regressionResult.status,
          }),
        );

        if (regressionResult.status === 'failed') {
          await artifactStore.appendEvent(
            createRunEvent(benchmarkRunId, 'benchmark.regression.detected', {
              reasons: regressionResult.reasons,
              regressionResultPath: benchmarkRun.regressionResultPath,
            }),
          );
        }
      }

      await artifactStore.appendEvent(
        createRunEvent(benchmarkRunId, 'benchmark.run.completed', {
          caseCount: caseResults.length,
          score: score.normalizedScore,
          status: benchmarkRun.status,
        }),
      );
      await persistBenchmarkRun(artifactStore, benchmarkRun);

      const exitCode =
        benchmarkRun.status === 'completed' &&
        (!regressionResult || regressionResult.status === 'passed')
          ? 0
          : 1;

      return {
        artifactsDirectory: artifactStore.runDirectory,
        benchmarkRun,
        comparisonReport,
        exitCode,
        regressionResult,
      };
    },

    async compareRunArtifacts(
      input: BenchmarkRunComparisonRequest,
    ): Promise<BenchmarkComparisonResult> {
      const lhsRun = await loadBenchmarkRun(input.repoRoot, input.lhs);
      const catalog = await loadBenchmarkCatalogData(input.repoRoot);
      const config = await loadBenchmarkConfig(input.repoRoot);
      let rhsRun: BenchmarkRun;
      let rhsRef: BaselineRef;

      if (input.againstBaseline) {
        if (!lhsRun.suiteId) {
          throw new Error(`Benchmark run "${lhsRun.id}" is not linked to a suite baseline.`);
        }

        const suite = catalog.suiteMap.get(lhsRun.suiteId);

        if (!suite?.baseline || !suite.resolvedBaselineArtifactPath) {
          throw new Error(
            `Benchmark suite "${lhsRun.suiteId}" does not define a baseline artifact.`,
          );
        }

        rhsRun = await loadBenchmarkRunFromPath(
          suite.resolvedBaselineArtifactPath,
          `benchmark baseline "${suite.baseline.label}"`,
        );
        rhsRef = {
          ...suite.baseline,
          artifactPath: suite.resolvedBaselineArtifactPath,
        };
      } else if (input.rhs) {
        rhsRun = await loadBenchmarkRun(input.repoRoot, input.rhs);
        rhsRef = baselineRefFromRun(rhsRun, benchmarkRunFilePath(input.repoRoot, rhsRun.id));
      } else {
        throw new Error('A right-hand benchmark run or --against-baseline is required.');
      }

      const suite = lhsRun.suiteId ? catalog.suiteMap.get(lhsRun.suiteId) : undefined;
      const comparison = await compareBenchmarkRuns({
        lhsRun,
        lhsRunFilePath: benchmarkRunFilePath(input.repoRoot, lhsRun.id),
        rhsRef,
        rhsRun,
        thresholdPolicy: suiteThresholdPolicy(config, suite),
      });
      const artifactStore = createBenchmarkArtifactStore(input.repoRoot, lhsRun.id);

      await artifactStore.appendEvent(
        createRunEvent(lhsRun.id, 'benchmark.compare.started', {
          baselineId: rhsRef.id,
          baselinePath: rhsRef.artifactPath,
        }),
      );

      let updatedRun = await persistComparisonArtifacts(
        artifactStore,
        lhsRun,
        comparison.comparisonReport,
        comparison.regressionResult,
      );

      await artifactStore.appendEvent(
        createRunEvent(lhsRun.id, 'benchmark.compare.completed', {
          comparisonReportPath: updatedRun.comparisonReportPath,
          regressionStatus: comparison.regressionResult.status,
          rhsId: rhsRef.id,
        }),
      );

      if (comparison.regressionResult.status === 'failed') {
        await artifactStore.appendEvent(
          createRunEvent(lhsRun.id, 'benchmark.regression.detected', {
            reasons: comparison.regressionResult.reasons,
            regressionResultPath: updatedRun.regressionResultPath,
          }),
        );
      }

      updatedRun = BenchmarkRunSchema.parse({
        ...updatedRun,
        summary: `${lhsRun.summary} Latest comparison: ${comparison.regressionResult.summary}`,
      });
      await persistBenchmarkRun(artifactStore, updatedRun);

      return {
        benchmarkRun: updatedRun,
        comparisonReport: comparison.comparisonReport,
        regressionResult: comparison.regressionResult,
      };
    },
  };
}

export { defaultThresholdPolicy };
