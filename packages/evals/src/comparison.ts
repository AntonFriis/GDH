import type {
  BaselineRef,
  BenchmarkCaseResult,
  BenchmarkComparisonStatus,
  BenchmarkMetric,
  BenchmarkMetricName,
  BenchmarkRun,
  ComparisonReport,
  RegressionMetricFailure,
  RegressionResult,
  ThresholdPolicy,
} from '@gdh/domain';
import {
  BenchmarkCaseComparisonSchema,
  BenchmarkMetricComparisonSchema,
  ComparisonReportSchema,
  RegressionResultSchema,
} from '@gdh/domain';
import { createIsoTimestamp } from '@gdh/shared';

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

export async function compareBenchmarkRuns(input: {
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
