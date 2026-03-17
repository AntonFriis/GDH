import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BenchmarkRun } from '@gdh/domain';
import { describe, expect, it } from 'vitest';
import { compareBenchmarkRuns, defaultThresholdPolicy, loadBenchmarkConfig } from '../src/index';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function createBenchmarkRun(input: {
  id: string;
  caseScore: number;
  caseStatus?: 'passed' | 'failed';
  successMetricPassed?: boolean;
}): BenchmarkRun {
  const successPassed = input.successMetricPassed ?? input.caseStatus !== 'failed';

  return {
    id: input.id,
    status: input.caseStatus === 'failed' ? 'failed' : 'completed',
    target: {
      kind: 'suite',
      id: 'smoke',
    },
    suiteId: 'smoke',
    caseIds: ['smoke-success-docs'],
    mode: 'ci_safe',
    repoRoot: '/tmp/gdh',
    runDirectory: `/tmp/gdh/runs/benchmarks/${input.id}`,
    configuration: {
      ciSafe: true,
      targetId: 'smoke',
      targetKind: 'suite',
      suiteId: 'smoke',
      thresholdPolicy: defaultThresholdPolicy,
    },
    score: {
      totalWeight: 1,
      earnedWeight: input.caseScore,
      normalizedScore: input.caseScore,
      passedMetrics: successPassed ? 1 : 0,
      failedMetrics: successPassed ? 0 : 1,
      metrics: [
        {
          name: 'success',
          title: 'Success / Failure',
          description: 'Checks benchmark success.',
          weight: 1,
          score: input.caseScore,
          passed: successPassed,
          summary: successPassed ? 'Passed.' : 'Failed.',
          evidence: [],
        },
      ],
      summary: 'Synthetic benchmark score.',
    },
    caseResults: [
      {
        id: `${input.id}:smoke-success-docs`,
        benchmarkRunId: input.id,
        caseId: 'smoke-success-docs',
        title: 'Smoke success docs',
        suiteIds: ['smoke'],
        status: input.caseStatus ?? 'passed',
        mode: 'ci_safe',
        tags: ['smoke'],
        startedAt: '2026-03-17T12:00:00.000Z',
        completedAt: '2026-03-17T12:00:01.000Z',
        durationMs: 1000,
        expected: {
          runStatus: 'completed',
          requiredArtifacts: ['review-packet.json'],
        },
        actual: {
          runStatus: input.caseStatus === 'failed' ? 'failed' : 'completed',
          artifactPaths: ['review-packet.json'],
        },
        score: {
          totalWeight: 1,
          earnedWeight: input.caseScore,
          normalizedScore: input.caseScore,
          passedMetrics: successPassed ? 1 : 0,
          failedMetrics: successPassed ? 0 : 1,
          metrics: [
            {
              name: 'success',
              title: 'Success / Failure',
              description: 'Checks benchmark success.',
              weight: 1,
              score: input.caseScore,
              passed: successPassed,
              summary: successPassed ? 'Passed.' : 'Failed.',
              evidence: [],
            },
          ],
          summary: 'Synthetic case score.',
        },
        failureReasons: successPassed ? [] : ['Synthetic failure'],
        notes: ['Synthetic benchmark case'],
      },
    ],
    startedAt: '2026-03-17T12:00:00.000Z',
    completedAt: '2026-03-17T12:00:01.000Z',
    summary: 'Synthetic benchmark run.',
  };
}

describe('loadBenchmarkConfig', () => {
  it('loads the repo benchmark threshold defaults', async () => {
    const config = await loadBenchmarkConfig(repoRoot);

    expect(config.thresholds.maxOverallScoreDrop).toBe(0);
    expect(config.thresholds.requiredMetrics).toContain('success');
    expect(config.thresholds.failOnNewlyFailingCases).toBe(true);
  });
});

describe('compareBenchmarkRuns', () => {
  it('detects a regression when the score drops and a previously passing case fails', async () => {
    const lhsRun = createBenchmarkRun({
      id: 'lhs',
      caseScore: 0,
      caseStatus: 'failed',
      successMetricPassed: false,
    });
    const rhsRun = createBenchmarkRun({
      id: 'rhs',
      caseScore: 1,
      caseStatus: 'passed',
      successMetricPassed: true,
    });

    const comparison = await compareBenchmarkRuns({
      lhsRun,
      lhsRunFilePath: '/tmp/lhs/benchmark.run.json',
      rhsRef: {
        kind: 'benchmark_run',
        id: 'rhs',
        label: 'rhs',
        artifactPath: '/tmp/rhs/benchmark.run.json',
        benchmarkRunId: 'rhs',
      },
      rhsRun,
      thresholdPolicy: defaultThresholdPolicy,
    });

    expect(comparison.comparisonReport.overall.delta).toBe(-1);
    expect(comparison.comparisonReport.overall.newlyFailingCases).toEqual(['smoke-success-docs']);
    expect(comparison.regressionResult.status).toBe('failed');
    expect(comparison.regressionResult.requiredMetricFailures).toHaveLength(1);
  });
});
