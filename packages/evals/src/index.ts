import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  type ArtifactStore,
  createArtifactStore,
  listArtifactReferencesFromRunDirectory,
  resolveRunDirectory,
} from '@gdh/artifact-store';
import {
  type LoadedBenchmarkCase,
  type LoadedBenchmarkSuite,
  loadBenchmarkCatalog,
  resolveBenchmarkTarget,
  selectBenchmarkExecutionMode,
} from '@gdh/benchmark-cases';
import {
  type ApprovalMode,
  type ApprovalState,
  type BaselineRef,
  type BenchmarkCase,
  BenchmarkCaseComparisonSchema,
  type BenchmarkCaseResult,
  BenchmarkCaseResultSchema,
  type BenchmarkComparisonStatus,
  type BenchmarkExecutionMode,
  type BenchmarkMetric,
  BenchmarkMetricComparisonSchema,
  type BenchmarkMetricName,
  BenchmarkMetricSchema,
  type BenchmarkRun,
  BenchmarkRunSchema,
  type BenchmarkScore,
  BenchmarkScoreSchema,
  type ComparisonReport,
  ComparisonReportSchema,
  createRunEvent,
  type PolicyDecision,
  type RegressionMetricFailure,
  type RegressionResult,
  RegressionResultSchema,
  type ReviewPacket,
  ReviewPacketSchema,
  type RunStatus,
  SessionManifestSchema,
  type ThresholdPolicy,
  type VerificationStatus,
} from '@gdh/domain';
import { createIsoTimestamp, createRunId } from '@gdh/shared';

const execFileAsync = promisify(execFile);

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

interface PreparedCaseWorkspace {
  cleanup(): Promise<void>;
  repoRoot: string;
  specPath: string;
}

const requiredReviewPacketFields = [
  'objective',
  'overview',
  'planSummary',
  'runnerReportedSummary',
  'artifactPaths',
  'diffSummary',
  'policy',
  'approvals',
  'verification',
  'claimVerification',
  'rollbackHint',
] as const satisfies ReadonlyArray<keyof ReviewPacket>;

export const defaultThresholdPolicy: ThresholdPolicy = {
  maxOverallScoreDrop: 0,
  requiredMetrics: [
    'success',
    'policy_correctness',
    'verification_correctness',
    'packet_completeness',
    'artifact_presence',
  ],
  failOnNewlyFailingCases: true,
};

function benchmarkRunsRoot(repoRoot: string): string {
  return resolve(repoRoot, benchmarkRunsDirectoryName);
}

function benchmarkRunFilePath(repoRoot: string, runId: string): string {
  return resolve(
    resolveRunDirectory(repoRoot, runId, benchmarkRunsRoot(repoRoot)),
    'benchmark.run.json',
  );
}

function createEmptyBenchmarkScore(summary: string): BenchmarkScore {
  return BenchmarkScoreSchema.parse({
    totalWeight: 0,
    earnedWeight: 0,
    normalizedScore: 0,
    passedMetrics: 0,
    failedMetrics: 0,
    metrics: [],
    summary,
  });
}

function mergeThresholdPolicy(
  base: ThresholdPolicy,
  override?: Partial<ThresholdPolicy>,
): ThresholdPolicy {
  return {
    maxOverallScoreDrop: override?.maxOverallScoreDrop ?? base.maxOverallScoreDrop,
    requiredMetrics: override?.requiredMetrics ?? base.requiredMetrics,
    failOnNewlyFailingCases: override?.failOnNewlyFailingCases ?? base.failOnNewlyFailingCases,
  };
}

function createMetric(input: {
  actual?: unknown;
  description: string;
  evidence?: Array<{ label: string; path?: string; value?: string }>;
  expected?: unknown;
  name: BenchmarkMetricName;
  passed: boolean;
  score: number;
  summary: string;
  title: string;
  weight: number;
}): BenchmarkMetric {
  return BenchmarkMetricSchema.parse({
    actual: input.actual,
    description: input.description,
    evidence: input.evidence ?? [],
    expected: input.expected,
    name: input.name,
    passed: input.passed,
    score: input.score,
    summary: input.summary,
    title: input.title,
    weight: input.weight,
  });
}

function createScore(metrics: BenchmarkMetric[], summaryPrefix: string): BenchmarkScore {
  const totalWeight = metrics.reduce((sum, metric) => sum + metric.weight, 0);
  const earnedWeight = metrics.reduce((sum, metric) => sum + metric.weight * metric.score, 0);
  const normalizedScore = totalWeight === 0 ? 1 : earnedWeight / totalWeight;
  const passedMetrics = metrics.filter((metric) => metric.passed).length;
  const failedMetrics = metrics.length - passedMetrics;

  return BenchmarkScoreSchema.parse({
    totalWeight,
    earnedWeight,
    normalizedScore,
    passedMetrics,
    failedMetrics,
    metrics,
    summary: `${summaryPrefix} (${passedMetrics}/${metrics.length} metrics passed; score ${normalizedScore.toFixed(2)}).`,
  });
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

function scoreSuccessMetric(
  caseDefinition: LoadedBenchmarkCase,
  actualRunStatus: RunStatus,
): BenchmarkMetric {
  const expectedRunStatus = caseDefinition.expected.runStatus ?? 'completed';
  const passed = actualRunStatus === expectedRunStatus;

  return createMetric({
    actual: actualRunStatus,
    description: 'Checks whether the governed run ended in the expected terminal or paused status.',
    expected: expectedRunStatus,
    name: 'success',
    passed,
    score: passed ? 1 : 0,
    summary: passed
      ? `Run status matched the expected result "${expectedRunStatus}".`
      : `Expected run status "${expectedRunStatus}" but observed "${actualRunStatus}".`,
    title: 'Success / Failure',
    weight: caseDefinition.weights.success ?? 0,
  });
}

function scorePolicyMetric(
  caseDefinition: LoadedBenchmarkCase,
  actualPolicyDecision: PolicyDecision | undefined,
  actualApprovalState: ApprovalState,
): BenchmarkMetric {
  const expectations = [
    caseDefinition.expected.policyDecision !== undefined,
    caseDefinition.expected.approvalState !== undefined,
  ].filter(Boolean).length;
  const passedPolicy =
    caseDefinition.expected.policyDecision === undefined ||
    caseDefinition.expected.policyDecision === actualPolicyDecision;
  const passedApproval =
    caseDefinition.expected.approvalState === undefined ||
    caseDefinition.expected.approvalState === actualApprovalState;
  const satisfied = [passedPolicy, passedApproval].filter(Boolean).length;
  const score = expectations === 0 ? 1 : satisfied / expectations;
  const passed = passedPolicy && passedApproval;

  return createMetric({
    actual: {
      approvalState: actualApprovalState,
      policyDecision: actualPolicyDecision,
    },
    description:
      'Checks whether policy evaluation and approval state match the benchmark expectation.',
    expected: {
      approvalState: caseDefinition.expected.approvalState,
      policyDecision: caseDefinition.expected.policyDecision,
    },
    name: 'policy_correctness',
    passed,
    score,
    summary: passed
      ? 'Observed policy decision and approval state matched the benchmark expectations.'
      : `Expected policy ${caseDefinition.expected.policyDecision ?? 'n/a'} / approval ${caseDefinition.expected.approvalState ?? 'n/a'}, observed policy ${actualPolicyDecision ?? 'n/a'} / approval ${actualApprovalState}.`,
    title: 'Policy Correctness',
    weight: caseDefinition.weights.policy_correctness ?? 0,
  });
}

function scoreVerificationMetric(
  caseDefinition: LoadedBenchmarkCase,
  actualVerificationStatus: VerificationStatus,
): BenchmarkMetric {
  const expectedVerificationStatus = caseDefinition.expected.verificationStatus ?? 'passed';
  const passed = actualVerificationStatus === expectedVerificationStatus;

  return createMetric({
    actual: actualVerificationStatus,
    description: 'Checks whether deterministic verification ended in the expected status.',
    expected: expectedVerificationStatus,
    name: 'verification_correctness',
    passed,
    score: passed ? 1 : 0,
    summary: passed
      ? `Verification status matched the expected result "${expectedVerificationStatus}".`
      : `Expected verification status "${expectedVerificationStatus}" but observed "${actualVerificationStatus}".`,
    title: 'Verification Correctness',
    weight: caseDefinition.weights.verification_correctness ?? 0,
  });
}

function scorePacketMetric(
  caseDefinition: LoadedBenchmarkCase,
  reviewPacket: ReviewPacket,
): BenchmarkMetric {
  const missingFields = requiredReviewPacketFields.filter((fieldName) => {
    const value = reviewPacket[fieldName];

    if (Array.isArray(value)) {
      return value.length === 0;
    }

    if (value && typeof value === 'object') {
      return Object.keys(value).length === 0;
    }

    return value === undefined || value === null || value === '';
  });
  const expectedStatus = caseDefinition.expected.reviewPacketStatus;
  const statusMatched = !expectedStatus || reviewPacket.packetStatus === expectedStatus;
  const totalChecks = requiredReviewPacketFields.length + (expectedStatus ? 1 : 0);
  const passedChecks =
    requiredReviewPacketFields.length -
    missingFields.length +
    (statusMatched ? (expectedStatus ? 1 : 0) : 0);
  const score = totalChecks === 0 ? 1 : passedChecks / totalChecks;
  const passed = missingFields.length === 0 && statusMatched;

  return createMetric({
    actual: {
      missingFields,
      packetStatus: reviewPacket.packetStatus,
    },
    description:
      'Checks whether the persisted review packet is structurally complete and has the expected packet status.',
    expected: {
      packetStatus: expectedStatus,
      requiredFields: requiredReviewPacketFields,
    },
    name: 'packet_completeness',
    passed,
    score,
    summary: passed
      ? 'Review packet contains the required fields and expected packet status.'
      : `Review packet is missing ${missingFields.length} required field(s) or has an unexpected packet status.`,
    title: 'Packet Completeness',
    weight: caseDefinition.weights.packet_completeness ?? 0,
  });
}

async function scoreArtifactMetric(
  caseDefinition: LoadedBenchmarkCase,
  artifactsDirectory: string,
): Promise<BenchmarkMetric> {
  const requiredArtifacts = caseDefinition.expected.requiredArtifacts;
  const checks = await Promise.all(
    requiredArtifacts.map(async (relativePath) => ({
      exists: await pathExists(resolve(artifactsDirectory, relativePath)),
      relativePath,
    })),
  );
  const foundCount = checks.filter((check) => check.exists).length;
  const score = requiredArtifacts.length === 0 ? 1 : foundCount / requiredArtifacts.length;
  const missingArtifacts = checks
    .filter((check) => !check.exists)
    .map((check) => check.relativePath);
  const passed = missingArtifacts.length === 0;

  return createMetric({
    actual: {
      foundCount,
      missingArtifacts,
    },
    description:
      'Checks whether the expected run artifacts were persisted for this benchmark case.',
    evidence: checks.map((check) => ({
      label: check.relativePath,
      path: resolve(artifactsDirectory, check.relativePath),
      value: check.exists ? 'present' : 'missing',
    })),
    expected: requiredArtifacts,
    name: 'artifact_presence',
    passed,
    score,
    summary: passed
      ? 'All expected artifacts were present.'
      : `Missing expected artifact(s): ${missingArtifacts.join(', ')}.`,
    title: 'Artifact Presence',
    weight: caseDefinition.weights.artifact_presence ?? 0,
  });
}

function aggregateRunScore(caseResults: BenchmarkCaseResult[]): BenchmarkScore {
  const metricNames = new Set<BenchmarkMetricName>();

  for (const caseResult of caseResults) {
    for (const metric of caseResult.score.metrics) {
      metricNames.add(metric.name);
    }
  }

  const metrics = [...metricNames].sort().map((metricName) => {
    const matchingMetrics = caseResults
      .flatMap((caseResult) => caseResult.score.metrics)
      .filter((metric) => metric.name === metricName);
    const totalWeight = matchingMetrics.reduce((sum, metric) => sum + metric.weight, 0);
    const averageWeight = matchingMetrics.length === 0 ? 0 : totalWeight / matchingMetrics.length;
    const averageScore =
      matchingMetrics.length === 0
        ? 0
        : matchingMetrics.reduce((sum, metric) => sum + metric.score, 0) / matchingMetrics.length;
    const passedCases = matchingMetrics.filter((metric) => metric.passed).length;

    return createMetric({
      actual: {
        passedCases,
        totalCases: matchingMetrics.length,
      },
      description: matchingMetrics[0]?.description ?? metricName,
      name: metricName,
      passed: passedCases === matchingMetrics.length,
      score: averageScore,
      summary: `${passedCases}/${matchingMetrics.length} case(s) passed ${metricName}.`,
      title: matchingMetrics[0]?.title ?? metricName,
      weight: averageWeight,
    });
  });

  return createScore(metrics, 'Benchmark run score aggregated across all cases');
}

async function executeBenchmarkCase(
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

function metricComparisonStatus(delta: number | null): BenchmarkComparisonStatus {
  if (delta === null) {
    return 'missing';
  }

  if (delta < 0) {
    return 'regressed';
  }

  if (delta > 0) {
    return 'improved';
  }

  return 'equal';
}

function compareMetrics(
  lhsMetrics: BenchmarkMetric[],
  rhsMetrics: BenchmarkMetric[],
): ReturnType<typeof BenchmarkMetricComparisonSchema.parse>[] {
  const metricNames = new Set<BenchmarkMetricName>([
    ...lhsMetrics.map((metric) => metric.name),
    ...rhsMetrics.map((metric) => metric.name),
  ]);

  return [...metricNames].sort().map((metricName) => {
    const lhsMetric = lhsMetrics.find((metric) => metric.name === metricName);
    const rhsMetric = rhsMetrics.find((metric) => metric.name === metricName);
    const delta = lhsMetric && rhsMetric ? lhsMetric.score - rhsMetric.score : null;

    return BenchmarkMetricComparisonSchema.parse({
      name: metricName,
      lhsScore: lhsMetric?.score ?? null,
      rhsScore: rhsMetric?.score ?? null,
      delta,
      lhsPassed: lhsMetric?.passed ?? null,
      rhsPassed: rhsMetric?.passed ?? null,
      status: metricComparisonStatus(delta),
      summary:
        lhsMetric && rhsMetric
          ? `${metricName} delta: ${(delta ?? 0).toFixed(2)}.`
          : `${metricName} is missing from one side of the comparison.`,
    });
  });
}

function compareCaseResults(
  lhsCase: BenchmarkCaseResult | undefined,
  rhsCase: BenchmarkCaseResult | undefined,
): ReturnType<typeof BenchmarkCaseComparisonSchema.parse> {
  const delta =
    lhsCase && rhsCase ? lhsCase.score.normalizedScore - rhsCase.score.normalizedScore : null;
  const status = lhsCase && rhsCase ? metricComparisonStatus(delta) : 'missing';

  return BenchmarkCaseComparisonSchema.parse({
    caseId: lhsCase?.caseId ?? rhsCase?.caseId ?? 'unknown',
    title: lhsCase?.title ?? rhsCase?.title ?? 'Unknown benchmark case',
    lhsStatus: lhsCase?.status ?? 'missing',
    rhsStatus: rhsCase?.status ?? 'missing',
    lhsScore: lhsCase?.score.normalizedScore ?? null,
    rhsScore: rhsCase?.score.normalizedScore ?? null,
    delta,
    status,
    metricComparisons: compareMetrics(lhsCase?.score.metrics ?? [], rhsCase?.score.metrics ?? []),
    summary:
      lhsCase && rhsCase
        ? `Case delta: ${(delta ?? 0).toFixed(2)} (${status}).`
        : 'Case is missing from one side of the comparison.',
  });
}

function detectRegressions(
  comparisonReport: ComparisonReport,
  thresholdPolicy: ThresholdPolicy,
): RegressionResult {
  const overallScoreDrop = Math.max(
    0,
    comparisonReport.overall.rhsScore - comparisonReport.overall.lhsScore,
  );
  const exceededOverallScoreDrop = overallScoreDrop > thresholdPolicy.maxOverallScoreDrop;
  const requiredMetricFailures: RegressionMetricFailure[] = [];

  for (const caseComparison of comparisonReport.caseComparisons) {
    for (const metricComparison of caseComparison.metricComparisons) {
      if (!thresholdPolicy.requiredMetrics.includes(metricComparison.name)) {
        continue;
      }

      const regressed =
        metricComparison.lhsPassed === false &&
        (metricComparison.rhsPassed === true || metricComparison.rhsPassed === null);

      if (regressed) {
        requiredMetricFailures.push({
          caseId: caseComparison.caseId,
          metric: metricComparison.name,
          summary: `Required metric "${metricComparison.name}" regressed for case "${caseComparison.caseId}".`,
        });
      }
    }
  }

  const reasons: string[] = [];

  if (exceededOverallScoreDrop) {
    reasons.push(
      `Overall score dropped by ${overallScoreDrop.toFixed(2)}, exceeding the threshold ${thresholdPolicy.maxOverallScoreDrop.toFixed(2)}.`,
    );
  }

  if (
    thresholdPolicy.failOnNewlyFailingCases &&
    comparisonReport.overall.newlyFailingCases.length > 0
  ) {
    reasons.push(
      `Newly failing cases detected: ${comparisonReport.overall.newlyFailingCases.join(', ')}.`,
    );
  }

  if (requiredMetricFailures.length > 0) {
    reasons.push(
      `Required metric regressions detected for ${requiredMetricFailures.length} case/metric pair(s).`,
    );
  }

  return RegressionResultSchema.parse({
    id: `regression-${comparisonReport.id}`,
    status: reasons.length === 0 ? 'passed' : 'failed',
    comparedAt: comparisonReport.comparedAt,
    thresholdPolicy,
    overallScoreDrop,
    exceededOverallScoreDrop,
    newlyFailingCases: comparisonReport.overall.newlyFailingCases,
    requiredMetricFailures,
    reasons,
    summary:
      reasons.length === 0
        ? 'No regressions detected against the selected baseline.'
        : `Detected ${reasons.length} regression condition(s).`,
  });
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

function benchmarkSummaryLine(caseResults: BenchmarkCaseResult[], score: BenchmarkScore): string {
  const passedCases = caseResults.filter((caseResult) => caseResult.status === 'passed').length;
  return `${passedCases}/${caseResults.length} benchmark case(s) passed; overall score ${score.normalizedScore.toFixed(2)}.`;
}

function suiteThresholdPolicy(
  config: LoadedBenchmarkConfig,
  suite: LoadedBenchmarkSuite | undefined,
): ThresholdPolicy {
  return mergeThresholdPolicy(config.thresholds, suite?.thresholds);
}

async function compareRunsInternal(input: {
  lhsRun: BenchmarkRun;
  lhsRunFilePath: string;
  rhsRef: BaselineRef;
  rhsRun: BenchmarkRun;
  thresholdPolicy: ThresholdPolicy;
}): Promise<{ comparisonReport: ComparisonReport; regressionResult: RegressionResult }> {
  const caseIds = new Set<string>([
    ...input.lhsRun.caseResults.map((caseResult) => caseResult.caseId),
    ...input.rhsRun.caseResults.map((caseResult) => caseResult.caseId),
  ]);
  const caseComparisons = [...caseIds].sort().map((caseId) =>
    compareCaseResults(
      input.lhsRun.caseResults.find((caseResult) => caseResult.caseId === caseId),
      input.rhsRun.caseResults.find((caseResult) => caseResult.caseId === caseId),
    ),
  );
  const newlyFailingCases = caseComparisons
    .filter(
      (caseComparison) =>
        caseComparison.lhsStatus !== 'passed' && caseComparison.rhsStatus === 'passed',
    )
    .map((caseComparison) => caseComparison.caseId);
  const comparisonReport = ComparisonReportSchema.parse({
    id: `comparison-${input.lhsRun.id}-vs-${input.rhsRef.id}`,
    comparedAt: createIsoTimestamp(),
    lhsRunId: input.lhsRun.id,
    rhs: input.rhsRef,
    suiteId: input.lhsRun.suiteId ?? input.rhsRun.suiteId,
    overall: {
      lhsScore: input.lhsRun.score.normalizedScore,
      rhsScore: input.rhsRun.score.normalizedScore,
      delta: input.lhsRun.score.normalizedScore - input.rhsRun.score.normalizedScore,
      lhsPassedCases: input.lhsRun.caseResults.filter(
        (caseResult) => caseResult.status === 'passed',
      ).length,
      rhsPassedCases: input.rhsRun.caseResults.filter(
        (caseResult) => caseResult.status === 'passed',
      ).length,
      newlyFailingCases,
    },
    caseComparisons,
    summary: `Compared benchmark run "${input.lhsRun.id}" against "${input.rhsRef.label}".`,
  });
  const regressionResult = detectRegressions(comparisonReport, input.thresholdPolicy);

  return {
    comparisonReport: ComparisonReportSchema.parse({
      ...comparisonReport,
      regression: regressionResult,
    }),
    regressionResult,
  };
}

export async function compareBenchmarkRuns(input: {
  lhsRun: BenchmarkRun;
  lhsRunFilePath: string;
  rhsRef: BaselineRef;
  rhsRun: BenchmarkRun;
  thresholdPolicy: ThresholdPolicy;
}): Promise<{ comparisonReport: ComparisonReport; regressionResult: RegressionResult }> {
  return compareRunsInternal(input);
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

  const caseResults: BenchmarkCaseResult[] = [];

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

  if (suite?.baseline && suite.resolvedBaselineArtifactPath) {
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
    const comparison = await compareRunsInternal({
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
  const comparison = await compareRunsInternal({
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
