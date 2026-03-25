import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import { listArtifactReferencesFromRunDirectory } from '@gdh/artifact-store';
import type { LoadedBenchmarkCase } from '@gdh/benchmark-cases';
import type {
  ApprovalState,
  BenchmarkCaseResult,
  BenchmarkExecutionMode,
  ReviewPacket,
} from '@gdh/domain';
import { BenchmarkCaseResultSchema, ReviewPacketSchema, SessionManifestSchema } from '@gdh/domain';
import { createIsoTimestamp } from '@gdh/shared';
import {
  createMetric,
  createScore,
  scoreArtifactMetric,
  scorePacketMetric,
  scorePolicyMetric,
  scoreSuccessMetric,
  scoreVerificationMetric,
} from './scoring.js';
import type { BenchmarkCaseExecutionSummary, BenchmarkCaseExecutor } from './types.js';

const execFileAsync = promisify(execFile);

interface PreparedCaseWorkspace {
  cleanup(): Promise<void>;
  repoRoot: string;
  specPath: string;
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

async function initFixtureRepository(repoRoot: string): Promise<void> {
  await execFileAsync('git', ['init'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  await execFileAsync('git', ['add', '.'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  await execFileAsync(
    'git',
    ['-c', 'user.name=GDH', '-c', 'user.email=gdh@example.invalid', 'commit', '-m', 'init'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

async function materializeSpecFixture(
  caseDefinition: LoadedBenchmarkCase,
  repoRoot: string,
): Promise<string> {
  const sourcePath = caseDefinition.resolvedSpecFixturePath ?? caseDefinition.resolvedSpecPath;

  if (!sourcePath) {
    throw new Error(`Benchmark case "${caseDefinition.id}" does not resolve to a spec path.`);
  }

  const targetPath = resolve(
    repoRoot,
    caseDefinition.input.targetPath ?? `benchmarks/specs/${basename(sourcePath)}`,
  );
  const contents = await readFile(sourcePath, 'utf8');
  const parentDirectory = resolve(targetPath, '..');

  await mkdir(parentDirectory, { recursive: true });
  await writeFile(targetPath, contents, 'utf8');
  return targetPath;
}

async function materializeOptimizationHarnessInputs(
  currentRepoRoot: string,
  fixtureRepoRoot: string,
): Promise<void> {
  const optimizationConfigRoot = resolve(currentRepoRoot, 'config', 'optimization');

  try {
    await cp(optimizationConfigRoot, resolve(fixtureRepoRoot, 'config', 'optimization'), {
      recursive: true,
    });
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;

    if (fileError.code === 'ENOENT') {
      return;
    }

    throw error;
  }
}

async function prepareCaseWorkspace(
  currentRepoRoot: string,
  caseDefinition: LoadedBenchmarkCase,
  mode: BenchmarkExecutionMode,
): Promise<PreparedCaseWorkspace> {
  if (mode === 'live') {
    const specPath = caseDefinition.resolvedSpecPath ?? caseDefinition.resolvedSpecFixturePath;

    if (!specPath) {
      throw new Error(`Benchmark case "${caseDefinition.id}" is missing a live spec path.`);
    }

    return {
      cleanup: async () => undefined,
      repoRoot: currentRepoRoot,
      specPath,
    };
  }

  if (!caseDefinition.resolvedRepoFixturePath) {
    throw new Error(
      `Benchmark case "${caseDefinition.id}" is missing a repo fixture path for ci_safe mode.`,
    );
  }

  const tempRepoRoot = await mkdtemp(resolve(tmpdir(), `gdh-benchmark-${caseDefinition.id}-`));

  await cp(caseDefinition.resolvedRepoFixturePath, tempRepoRoot, { recursive: true });
  await materializeOptimizationHarnessInputs(currentRepoRoot, tempRepoRoot);

  const specPath = await materializeSpecFixture(caseDefinition, tempRepoRoot);

  await initFixtureRepository(tempRepoRoot);

  return {
    cleanup: async () => {
      await rm(tempRepoRoot, { recursive: true, force: true });
    },
    repoRoot: tempRepoRoot,
    specPath,
  };
}

async function loadActualCaseState(summary: BenchmarkCaseExecutionSummary): Promise<{
  approvalState: ApprovalState;
  artifactPaths: string[];
  reviewPacket: ReviewPacket;
}> {
  const manifest = await readJsonFile(
    resolve(summary.artifactsDirectory, 'session.manifest.json'),
    SessionManifestSchema,
    'session manifest',
  );
  const reviewPacket = await readJsonFile(
    resolve(summary.artifactsDirectory, 'review-packet.json'),
    ReviewPacketSchema,
    'review packet',
  );
  const artifactPaths = (
    await listArtifactReferencesFromRunDirectory(summary.runId, summary.artifactsDirectory)
  ).map((artifact) => artifact.path);

  return {
    approvalState: manifest.approvalState.status,
    artifactPaths,
    reviewPacket,
  };
}

export async function executeBenchmarkCase(
  benchmarkRunId: string,
  currentRepoRoot: string,
  caseDefinition: LoadedBenchmarkCase,
  mode: BenchmarkExecutionMode,
  executeCase: BenchmarkCaseExecutor,
): Promise<BenchmarkCaseResult> {
  const startedAt = createIsoTimestamp();
  const workspace = await prepareCaseWorkspace(currentRepoRoot, caseDefinition, mode);

  try {
    const executionSummary = await executeCase({
      approvalMode: caseDefinition.execution.approvalMode,
      cwd: workspace.repoRoot,
      policyPath: caseDefinition.resolvedPolicyPath ?? caseDefinition.execution.policyPath,
      runner: caseDefinition.execution.runner,
      specPath: workspace.specPath,
    });
    const actualState = await loadActualCaseState(executionSummary);
    const metrics = [
      scoreSuccessMetric(caseDefinition, executionSummary.status),
      scorePolicyMetric(caseDefinition, executionSummary.policyDecision, actualState.approvalState),
      scoreVerificationMetric(caseDefinition, executionSummary.verificationStatus),
      scorePacketMetric(caseDefinition, actualState.reviewPacket),
      await scoreArtifactMetric(caseDefinition, executionSummary.artifactsDirectory),
    ];
    const score = createScore(metrics, `Benchmark case "${caseDefinition.id}"`);
    const failureReasons = metrics
      .filter((metric) => !metric.passed && metric.weight > 0)
      .map((metric) => metric.summary);
    const completedAt = createIsoTimestamp();

    return BenchmarkCaseResultSchema.parse({
      id: `${benchmarkRunId}:${caseDefinition.id}`,
      benchmarkRunId,
      caseId: caseDefinition.id,
      title: caseDefinition.title,
      suiteIds: caseDefinition.suiteIds,
      status: failureReasons.length === 0 ? 'passed' : 'failed',
      mode,
      tags: caseDefinition.tags,
      governedRunId: executionSummary.runId,
      governedRunPath: executionSummary.artifactsDirectory,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      expected: caseDefinition.expected,
      actual: {
        runStatus: executionSummary.status,
        policyDecision: executionSummary.policyDecision,
        approvalState: actualState.approvalState,
        verificationStatus: executionSummary.verificationStatus,
        reviewPacketStatus: actualState.reviewPacket.packetStatus,
        artifactPaths: actualState.artifactPaths,
      },
      score,
      failureReasons,
      notes: [executionSummary.summary],
    });
  } catch (error) {
    const completedAt = createIsoTimestamp();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const metrics = [
      createMetric({
        actual: errorMessage,
        description:
          'Records benchmark execution failures before a governed run result could be scored.',
        name: 'success',
        passed: false,
        score: 0,
        summary: errorMessage,
        title: 'Success / Failure',
        weight: caseDefinition.weights.success ?? 0,
      }),
    ];

    return BenchmarkCaseResultSchema.parse({
      id: `${benchmarkRunId}:${caseDefinition.id}`,
      benchmarkRunId,
      caseId: caseDefinition.id,
      title: caseDefinition.title,
      suiteIds: caseDefinition.suiteIds,
      status: 'error',
      mode,
      tags: caseDefinition.tags,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      expected: caseDefinition.expected,
      actual: {
        artifactPaths: [],
      },
      score: createScore(metrics, `Benchmark case "${caseDefinition.id}" errored`),
      failureReasons: [errorMessage],
      notes: [errorMessage],
    });
  } finally {
    await workspace.cleanup();
  }
}
