import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type ArtifactStore, createArtifactStore, resolveRunDirectory } from '@gdh/artifact-store';
import {
  type LoadedBenchmarkSuite,
  loadBenchmarkCatalog,
  resolveBenchmarkTarget,
  selectBenchmarkExecutionMode,
} from '@gdh/benchmark-cases';
import type {
  ApprovalMode,
  BaselineRef,
  BenchmarkCase,
  BenchmarkRun,
  ComparisonReport,
  PolicyDecision,
  RegressionResult,
  RunStatus,
  ThresholdPolicy,
  VerificationStatus,
} from '@gdh/domain';
import { BenchmarkRunSchema, createRunEvent } from '@gdh/domain';
import { createIsoTimestamp, createRunId } from '@gdh/shared';
import { compareBenchmarkRuns } from './comparison.js';
import {
  aggregateRunScore,
  createEmptyBenchmarkScore,
  defaultThresholdPolicy,
  mergeThresholdPolicy,
} from './scoring.js';
import { executeBenchmarkCase } from './workspace.js';

const benchmarkRunsDirectoryName = 'runs/benchmarks';

export interface BenchmarkCaseExecutionInput {
  approvalMode: ApprovalMode;
  cwd: string;
  policyPath?: string;
  runner: BenchmarkCase['execution']['runner'];
  specPath: string;
}

export interface BenchmarkCaseExecutionSummary {
  artifactsDirectory: string;
  policyDecision?: PolicyDecision;
  reviewPacketPath: string;
  runId: string;
  status: RunStatus;
  summary: string;
  verificationStatus: VerificationStatus;
}

export type BenchmarkCaseExecutor = (
  input: BenchmarkCaseExecutionInput,
) => Promise<BenchmarkCaseExecutionSummary>;

export interface BenchmarkRunRequest {
  ciSafe?: boolean;
  executeCase: BenchmarkCaseExecutor;
  repoRoot: string;
  targetId: string;
}

export interface BenchmarkRunResult {
  artifactsDirectory: string;
  benchmarkRun: BenchmarkRun;
  comparisonReport?: ComparisonReport;
  exitCode: number;
  regressionResult?: RegressionResult;
}

export interface LoadedBenchmarkConfig {
  path: string;
  thresholds: ThresholdPolicy;
}

function benchmarkRunsRoot(repoRoot: string): string {
  return resolve(repoRoot, benchmarkRunsDirectoryName);
}

function benchmarkRunFilePath(repoRoot: string, runId: string): string {
  return resolve(
    resolveRunDirectory(repoRoot, runId, benchmarkRunsRoot(repoRoot)),
    'benchmark.run.json',
  );
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;

    if (fileError.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function readJsonFile<T>(
  filePath: string,
  parser: { parse(value: unknown): T },
  label: string,
): Promise<T> {
  try {
    return parser.parse(JSON.parse(await readFile(filePath, 'utf8')));
  } catch (error) {
    throw new Error(
      `Could not read ${label} from "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function baselineRefFromRun(run: BenchmarkRun, artifactPath: string): BaselineRef {
  return {
    kind: 'benchmark_run',
    id: run.id,
    label: run.id,
    artifactPath,
    benchmarkRunId: run.id,
  };
}

async function loadBenchmarkRunFromPath(filePath: string, label: string): Promise<BenchmarkRun> {
  return readJsonFile(filePath, BenchmarkRunSchema, label);
}

export async function loadBenchmarkRun(
  repoRoot: string,
  identifier: string,
): Promise<BenchmarkRun> {
  const asPath = resolve(repoRoot, identifier);

  if (await pathExists(asPath)) {
    const targetFilePath = (await stat(asPath)).isDirectory()
      ? resolve(asPath, 'benchmark.run.json')
      : asPath;

    return loadBenchmarkRunFromPath(targetFilePath, 'benchmark run snapshot');
  }

  return loadBenchmarkRunFromPath(
    benchmarkRunFilePath(repoRoot, identifier),
    'benchmark run artifact',
  );
}

export async function loadBenchmarkConfig(
  repoRoot: string,
  configPath = resolve(repoRoot, 'gdh.config.json'),
): Promise<LoadedBenchmarkConfig> {
  try {
    const raw = JSON.parse(await readFile(configPath, 'utf8')) as {
      benchmark?: {
        thresholds?: Partial<ThresholdPolicy>;
      };
    };

    return {
      path: configPath,
      thresholds: mergeThresholdPolicy(defaultThresholdPolicy, raw.benchmark?.thresholds),
    };
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;

    if (fileError.code === 'ENOENT') {
      return {
        path: configPath,
        thresholds: defaultThresholdPolicy,
      };
    }

    throw new Error(
      `Could not load benchmark config from "${configPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function persistBenchmarkRun(
  artifactStore: ArtifactStore,
  benchmarkRun: BenchmarkRun,
): Promise<void> {
  await artifactStore.writeJsonArtifact(
    'benchmark-run',
    'benchmark.run.json',
    benchmarkRun,
    'Persisted benchmark run state, scores, and case results.',
  );
}

async function persistComparisonArtifacts(
  artifactStore: ArtifactStore,
  benchmarkRun: BenchmarkRun,
  comparisonReport: ComparisonReport,
  regressionResult?: RegressionResult,
): Promise<BenchmarkRun> {
  const comparisonArtifact = await artifactStore.writeJsonArtifact(
    'benchmark-comparison',
    'comparison.report.json',
    comparisonReport,
    'Comparison report for the benchmark run.',
  );
  let regressionResultPath: string | undefined;

  if (regressionResult) {
    const regressionArtifact = await artifactStore.writeJsonArtifact(
      'benchmark-regression',
      'regression.result.json',
      regressionResult,
      'Regression result for the benchmark run comparison.',
    );
    regressionResultPath = regressionArtifact.path;
  }

  return BenchmarkRunSchema.parse({
    ...benchmarkRun,
    comparisonReportPath: comparisonArtifact.path,
    regressionResultPath,
  });
}

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

export async function runBenchmarkTarget(
  request: BenchmarkRunRequest,
): Promise<BenchmarkRunResult> {
  const catalog = await loadBenchmarkCatalog(request.repoRoot);
  const config = await loadBenchmarkConfig(request.repoRoot);
  const target = resolveBenchmarkTarget(catalog, request.targetId);
  const suite =
    target.kind === 'suite'
      ? target.suite
      : catalog.suiteMap.get(target.caseDefinition.suiteIds[0] ?? '');
  const caseDefinitions = target.kind === 'suite' ? target.cases : [target.caseDefinition];
  const benchmarkRunId = createRunId(`benchmark-${request.targetId}`);
  const artifactStore = createArtifactStore({
    repoRoot: request.repoRoot,
    runId: benchmarkRunId,
    runsRoot: benchmarkRunsRoot(request.repoRoot),
  });
  const startedAt = createIsoTimestamp();
  const thresholdPolicy = suiteThresholdPolicy(config, suite);

  await artifactStore.initialize();
  await artifactStore.appendEvent(
    createRunEvent(benchmarkRunId, 'benchmark.run.started', {
      mode: request.ciSafe ? 'ci_safe' : (suite?.mode ?? 'ci_safe'),
      targetId: request.targetId,
      targetKind: target.kind,
    }),
  );
  if (target.kind === 'suite') {
    await artifactStore.writeJsonArtifact(
      'benchmark-suite',
      'benchmark.suite.json',
      target.suite,
      'Resolved benchmark suite definition.',
    );
  }
  const initialRun = BenchmarkRunSchema.parse({
    id: benchmarkRunId,
    status: 'running',
    target: {
      kind: target.kind,
      id: request.targetId,
    },
    suiteId: suite?.id,
    caseIds: caseDefinitions.map((caseDefinition) => caseDefinition.id),
    mode: request.ciSafe ? 'ci_safe' : (suite?.mode ?? 'ci_safe'),
    repoRoot: request.repoRoot,
    runDirectory: artifactStore.runDirectory,
    configuration: {
      ciSafe: Boolean(request.ciSafe),
      targetId: request.targetId,
      targetKind: target.kind,
      suiteId: suite?.id,
      thresholdPolicy,
      baseline: suite?.baseline
        ? {
            ...suite.baseline,
            artifactPath: suite.resolvedBaselineArtifactPath ?? suite.baseline.artifactPath,
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

  for (const caseDefinition of caseDefinitions) {
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
    const mode = selectBenchmarkExecutionMode(caseDefinition, suite?.mode, Boolean(request.ciSafe));
    const caseResult = await executeBenchmarkCase(
      benchmarkRunId,
      request.repoRoot,
      caseDefinition,
      mode,
      request.executeCase,
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
  let comparisonReport: ComparisonReport | undefined;
  let regressionResult: RegressionResult | undefined;

  if (target.kind === 'suite' && suite?.baseline && suite.resolvedBaselineArtifactPath) {
    const rhsRun = await loadBenchmarkRunFromPath(
      suite.resolvedBaselineArtifactPath,
      `benchmark baseline "${suite.baseline.label}"`,
    );
    const rhsRef: BaselineRef = {
      ...suite.baseline,
      artifactPath: suite.resolvedBaselineArtifactPath,
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
}

export async function compareBenchmarkRunArtifacts(input: {
  againstBaseline?: boolean;
  lhs: string;
  repoRoot: string;
  rhs?: string;
}): Promise<{
  benchmarkRun: BenchmarkRun;
  comparisonReport: ComparisonReport;
  regressionResult: RegressionResult;
}> {
  const lhsRun = await loadBenchmarkRun(input.repoRoot, input.lhs);
  const catalog = await loadBenchmarkCatalog(input.repoRoot);
  const config = await loadBenchmarkConfig(input.repoRoot);
  let rhsRun: BenchmarkRun;
  let rhsRef: BaselineRef;

  if (input.againstBaseline) {
    if (!lhsRun.suiteId) {
      throw new Error(`Benchmark run "${lhsRun.id}" is not linked to a suite baseline.`);
    }

    const suite = catalog.suiteMap.get(lhsRun.suiteId);

    if (!suite?.baseline || !suite.resolvedBaselineArtifactPath) {
      throw new Error(`Benchmark suite "${lhsRun.suiteId}" does not define a baseline artifact.`);
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
  const thresholdPolicy = suiteThresholdPolicy(config, suite);
  const comparison = await compareBenchmarkRuns({
    lhsRun,
    lhsRunFilePath: benchmarkRunFilePath(input.repoRoot, lhsRun.id),
    rhsRef,
    rhsRun,
    thresholdPolicy,
  });
  const artifactStore = createArtifactStore({
    repoRoot: input.repoRoot,
    runId: lhsRun.id,
    runsRoot: benchmarkRunsRoot(input.repoRoot),
  });

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
}

export { defaultThresholdPolicy };
