import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { LoadedBenchmarkCase } from '@gdh/benchmark-cases';
import type {
  ApprovalState,
  BenchmarkCaseResult,
  BenchmarkMetric,
  BenchmarkMetricName,
  BenchmarkScore,
  PolicyDecision,
  ReviewPacket,
  RunStatus,
  ThresholdPolicy,
  VerificationStatus,
} from '@gdh/domain';
import { BenchmarkMetricSchema, BenchmarkScoreSchema } from '@gdh/domain';

export const requiredReviewPacketFields = [
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

export function createEmptyBenchmarkScore(summary: string): BenchmarkScore {
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

export function mergeThresholdPolicy(
  base: ThresholdPolicy,
  override?: Partial<ThresholdPolicy>,
): ThresholdPolicy {
  return {
    maxOverallScoreDrop: override?.maxOverallScoreDrop ?? base.maxOverallScoreDrop,
    requiredMetrics: override?.requiredMetrics ?? base.requiredMetrics,
    failOnNewlyFailingCases: override?.failOnNewlyFailingCases ?? base.failOnNewlyFailingCases,
  };
}

export function createMetric(input: {
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

export function createScore(metrics: BenchmarkMetric[], summaryPrefix: string): BenchmarkScore {
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

export function scoreSuccessMetric(
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

export function scorePolicyMetric(
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

export function scoreVerificationMetric(
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

export function scorePacketMetric(
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

export async function scoreArtifactMetric(
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

export function aggregateRunScore(caseResults: BenchmarkCaseResult[]): BenchmarkScore {
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
