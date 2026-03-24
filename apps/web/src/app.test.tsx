import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestApp } from './App';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const sampleArtifactLink = {
  label: 'review-packet.md',
  path: '/tmp/review-packet.md',
  relativePath: 'runs/local/run-1/review-packet.md',
  format: 'markdown',
  exists: true,
  href: '/api/artifacts/content?path=%2Ftmp%2Freview-packet.md',
};

const sampleSnapshot = {
  generatedAt: '2026-03-18T10:05:00.000Z',
  overview: {
    analytics: {
      generatedAt: '2026-03-18T10:00:00.000Z',
      totalRuns: 3,
      totalBenchmarks: 1,
      runCountsByStatus: [
        { label: 'completed', count: 1 },
        { label: 'failed', count: 1 },
        { label: 'awaiting_approval', count: 1 },
      ],
      approvalRequiredRuns: 1,
      autoAllowedRuns: 2,
      approvalPendingRuns: 1,
      approvalDeniedRuns: 0,
      verificationPassedRuns: 1,
      verificationFailedRuns: 1,
      githubDraftPrRuns: 1,
      benchmarkRegressionFailures: 1,
      recentActivity: [],
    },
    recentRuns: [
      {
        id: 'run-1',
        title: 'Completed run',
        objective: 'Show run analytics.',
        summary: 'Completed run summary.',
        taskClass: 'docs',
        status: 'completed',
        currentStage: 'verification_completed',
        repoRoot: '/tmp/repo',
        runDirectory: '/tmp/repo/runs/local/run-1',
        createdAt: '2026-03-18T09:00:00.000Z',
        updatedAt: '2026-03-18T09:05:00.000Z',
        approval: {
          required: false,
          status: 'not_required',
          summary: 'No approval required.',
          affectedPaths: [],
          predictedCommands: [],
          reasons: [],
          riskSummary: [],
          artifactLinks: [],
        },
        verification: {
          status: 'passed',
          summary: 'Verification passed.',
          commandsPassed: 1,
          commandsFailed: 0,
          checksPassed: 1,
          checksFailed: 0,
          mandatoryFailures: [],
          artifactLinks: [],
        },
        github: {
          status: 'draft_pr_created',
          summary: 'Draft PR recorded.',
          artifactLinks: [],
        },
        linkedBenchmarkIds: ['bench-1'],
      },
    ],
    recentBenchmarks: [
      {
        id: 'bench-1',
        title: 'Dashboard smoke',
        suiteId: 'smoke',
        targetKind: 'suite',
        targetId: 'smoke',
        status: 'completed',
        mode: 'ci_safe',
        normalizedScore: 0.75,
        summary: 'One regression.',
        startedAt: '2026-03-18T10:00:00.000Z',
        completedAt: '2026-03-18T10:01:00.000Z',
        regressionStatus: 'failed',
        regressionSummary: 'Regression detected.',
        comparisonSummary: 'Comparison summary.',
        passedCases: 1,
        failedCases: 1,
        errorCases: 0,
        totalCases: 2,
        relatedRunIds: ['run-1'],
        artifactLinks: [],
      },
    ],
    approvals: [],
    failures: {
      generatedAt: '2026-03-18T10:00:00.000Z',
      buckets: [
        {
          kind: 'benchmark_regression',
          title: 'Benchmark regression',
          count: 1,
          items: [
            {
              id: 'bench-1',
              title: 'Dashboard smoke',
              summary: 'Regression detected.',
              status: 'failed',
              timestamp: '2026-03-18T10:01:00.000Z',
              href: '/benchmarks/bench-1',
            },
          ],
        },
      ],
    },
  },
  runs: {
    items: [
      {
        id: 'run-approval',
        title: 'Awaiting approval run',
        objective: 'Wait for approval.',
        summary: 'Awaiting approval.',
        taskClass: 'ci',
        status: 'awaiting_approval',
        currentStage: 'awaiting_approval',
        repoRoot: '/tmp/repo',
        runDirectory: '/tmp/repo/runs/local/run-approval',
        createdAt: '2026-03-18T09:15:00.000Z',
        updatedAt: '2026-03-18T09:16:00.000Z',
        approval: {
          required: true,
          status: 'pending',
          summary: 'Approval pending.',
          affectedPaths: ['.github/workflows/ci.yml'],
          predictedCommands: ['pnpm test'],
          reasons: ['Protected workflow files.'],
          riskSummary: ['Protected path.'],
          artifactLinks: [],
        },
        verification: {
          status: 'not_run',
          summary: 'Verification not run.',
          commandsPassed: 0,
          commandsFailed: 0,
          checksPassed: 0,
          checksFailed: 0,
          mandatoryFailures: [],
          artifactLinks: [],
        },
        github: {
          status: 'not_requested',
          summary: 'No GitHub state.',
          artifactLinks: [],
        },
        linkedBenchmarkIds: [],
      },
      {
        id: 'run-1',
        title: 'Completed run',
        objective: 'Show run detail.',
        summary: 'Run detail summary.',
        taskClass: 'docs',
        status: 'completed',
        currentStage: 'verification_completed',
        repoRoot: '/tmp/repo',
        runDirectory: '/tmp/repo/runs/local/run-1',
        createdAt: '2026-03-18T09:00:00.000Z',
        updatedAt: '2026-03-18T09:05:00.000Z',
        approval: {
          required: false,
          status: 'not_required',
          summary: 'No approval required.',
          affectedPaths: [],
          predictedCommands: [],
          reasons: [],
          riskSummary: [],
          artifactLinks: [],
        },
        verification: {
          status: 'passed',
          summary: 'Verification passed.',
          commandsPassed: 1,
          commandsFailed: 0,
          checksPassed: 1,
          checksFailed: 0,
          mandatoryFailures: [],
          artifactLinks: [sampleArtifactLink],
        },
        github: {
          status: 'draft_pr_created',
          summary: 'Draft PR recorded.',
          artifactLinks: [sampleArtifactLink],
        },
        linkedBenchmarkIds: ['bench-1'],
      },
    ],
    detailsById: {
      'run-1': {
        id: 'run-1',
        title: 'Completed run',
        objective: 'Show run detail.',
        summary: 'Run detail summary.',
        taskClass: 'docs',
        status: 'completed',
        currentStage: 'verification_completed',
        repoRoot: '/tmp/repo',
        runDirectory: '/tmp/repo/runs/local/run-1',
        createdAt: '2026-03-18T09:00:00.000Z',
        updatedAt: '2026-03-18T09:05:00.000Z',
        normalizedSpec: {
          source: 'markdown',
          sourcePath: '/tmp/repo/spec.md',
          summary: 'Spec summary.',
          objective: 'Show run detail.',
          constraints: [],
          acceptanceCriteria: ['Render run detail.'],
          riskHints: [],
          normalizationNotes: [],
        },
        plan: {
          summary: 'Implement the detail page.',
          doneConditions: ['Render run detail.'],
          assumptions: [],
          openQuestions: [],
          taskUnits: [
            {
              order: 1,
              title: 'Build detail',
              description: 'Render the detail page.',
              riskLevel: 'low',
              suggestedMode: 'workspace_write',
              status: 'done',
            },
          ],
        },
        approval: {
          required: false,
          status: 'not_required',
          summary: 'No approval required.',
          affectedPaths: [],
          predictedCommands: [],
          reasons: [],
          riskSummary: [],
          artifactLinks: [],
        },
        verification: {
          status: 'passed',
          summary: 'Verification passed.',
          commandsPassed: 1,
          commandsFailed: 0,
          checksPassed: 1,
          checksFailed: 0,
          mandatoryFailures: [],
          artifactLinks: [sampleArtifactLink],
        },
        github: {
          status: 'draft_pr_created',
          summary: 'Draft PR recorded.',
          pullRequest: {
            repo: {
              owner: 'acme',
              repo: 'gdh',
              fullName: 'acme/gdh',
            },
            pullRequestNumber: 34,
            title: 'Phase 8 release candidate',
            url: 'https://github.com/acme/gdh/pull/34',
            state: 'open',
            isDraft: true,
            baseBranch: 'main',
            headBranch: 'anf/codex/release-rc-phase8',
          },
          artifactLinks: [sampleArtifactLink],
        },
        reviewPacket: {
          packetStatus: 'ready',
          overview: 'Run detail page is ready.',
          runnerSummary: 'Completed route rendering.',
          filesChanged: ['apps/web/src/App.tsx'],
          diffSummary: ['1 file changed.'],
          risks: [],
          limitations: [],
          openQuestions: [],
          artifactLinks: [sampleArtifactLink],
        },
        benchmarkLinks: [
          {
            id: 'bench-1',
            title: 'Dashboard smoke',
            suiteId: 'smoke',
            targetKind: 'suite',
            targetId: 'smoke',
            status: 'completed',
            mode: 'ci_safe',
            normalizedScore: 0.75,
            summary: 'One regression.',
            startedAt: '2026-03-18T10:00:00.000Z',
            completedAt: '2026-03-18T10:01:00.000Z',
            regressionStatus: 'failed',
            regressionSummary: 'Regression detected.',
            comparisonSummary: 'Comparison summary.',
            passedCases: 1,
            failedCases: 1,
            errorCases: 0,
            totalCases: 2,
            relatedRunIds: ['run-1'],
            artifactLinks: [],
          },
        ],
        timeline: [
          {
            id: 'event-1',
            timestamp: '2026-03-18T09:01:00.000Z',
            type: 'plan.created',
            title: 'Plan created',
            summary: 'Plan artifact recorded.',
            severity: 'info',
          },
        ],
        artifactLinks: [sampleArtifactLink],
      },
    },
  },
  approvals: [
    {
      runId: 'run-approval',
      title: 'Awaiting approval run',
      summary: 'Awaiting approval.',
      updatedAt: '2026-03-18T09:16:00.000Z',
      approval: {
        required: true,
        status: 'pending',
        summary: 'Approval pending.',
        affectedPaths: ['.github/workflows/ci.yml'],
        predictedCommands: ['pnpm test'],
        reasons: ['Protected workflow files.'],
        riskSummary: ['Protected path.'],
        artifactLinks: [],
      },
    },
  ],
  benchmarks: {
    items: [
      {
        id: 'bench-1',
        title: 'Dashboard smoke',
        suiteId: 'smoke',
        targetKind: 'suite',
        targetId: 'smoke',
        status: 'completed',
        mode: 'ci_safe',
        normalizedScore: 0.75,
        summary: 'One regression.',
        startedAt: '2026-03-18T10:00:00.000Z',
        completedAt: '2026-03-18T10:01:00.000Z',
        regressionStatus: 'failed',
        regressionSummary: 'Regression detected.',
        comparisonSummary: 'Comparison summary.',
        passedCases: 1,
        failedCases: 1,
        errorCases: 0,
        totalCases: 2,
        relatedRunIds: ['run-1'],
        artifactLinks: [],
      },
    ],
    detailsById: {
      'bench-1': {
        summary: {
          id: 'bench-1',
          title: 'Dashboard smoke',
          suiteId: 'smoke',
          targetKind: 'suite',
          targetId: 'smoke',
          status: 'completed',
          mode: 'ci_safe',
          normalizedScore: 0.75,
          summary: 'One regression.',
          startedAt: '2026-03-18T10:00:00.000Z',
          completedAt: '2026-03-18T10:01:00.000Z',
          regressionStatus: 'failed',
          regressionSummary: 'Regression detected.',
          comparisonSummary: 'Comparison summary.',
          passedCases: 1,
          failedCases: 1,
          errorCases: 0,
          totalCases: 2,
          relatedRunIds: ['run-1'],
          artifactLinks: [],
        },
        suiteTitle: 'Smoke suite',
        thresholdPolicy: {
          maxOverallScoreDrop: 0.05,
          requiredMetrics: ['overall'],
          failOnNewlyFailingCases: true,
        },
        caseSummaries: [
          {
            caseId: 'case-1',
            title: 'Run dashboard overview',
            status: 'passed',
            normalizedScore: 1,
            durationMs: 1200,
            governedRunId: 'run-1',
            failureReasons: [],
          },
          {
            caseId: 'case-2',
            title: 'Inspect regression handling',
            status: 'failed',
            normalizedScore: 0.5,
            durationMs: 1300,
            governedRunId: 'run-1',
            failureReasons: ['Regression detected.'],
          },
        ],
      },
    },
  },
  failures: {
    generatedAt: '2026-03-18T10:00:00.000Z',
    buckets: [
      {
        kind: 'benchmark_regression',
        title: 'Benchmark regression',
        count: 1,
        items: [
          {
            id: 'bench-1',
            title: 'Dashboard smoke',
            summary: 'Regression detected.',
            status: 'failed',
            timestamp: '2026-03-18T10:01:00.000Z',
            href: '/benchmarks/bench-1',
          },
        ],
      },
    ],
  },
};

function installFetchMock(snapshot = sampleSnapshot) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url !== '/api/dashboard') {
        return {
          ok: false,
          status: 404,
          text: async () => `Missing mock for ${url}`,
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => snapshot,
        text: async () => JSON.stringify(snapshot),
      };
    }),
  );
}

describe('dashboard app', () => {
  it('renders the overview analytics and recent activity from the snapshot endpoint', async () => {
    installFetchMock();

    render(<TestApp initialEntries={['/']} />);

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getAllByText('Dashboard smoke').length).toBeGreaterThan(0);
    expect(screen.getByText('Completed run')).toBeTruthy();
  });

  it('renders the run list page from the snapshot endpoint', async () => {
    installFetchMock();

    render(<TestApp initialEntries={['/runs']} />);

    expect(await screen.findByRole('heading', { name: 'Runs' })).toBeTruthy();
    expect(await screen.findByText('Awaiting approval run')).toBeTruthy();
    expect(await screen.findByText('Wait for approval.')).toBeTruthy();
    expect(screen.getByText('pending')).toBeTruthy();
  });

  it('renders the run detail and benchmark pages from snapshot detail lookups', async () => {
    installFetchMock();

    render(<TestApp initialEntries={['/runs/run-1']} />);

    expect(await screen.findByRole('heading', { name: 'Completed run' })).toBeTruthy();
    expect(screen.getByText('Run detail page is ready.')).toBeTruthy();
    expect(screen.getByText('Draft PR #34')).toBeTruthy();

    cleanup();
    installFetchMock();
    render(<TestApp initialEntries={['/benchmarks/bench-1']} />);

    expect(await screen.findByRole('heading', { name: 'Dashboard smoke' })).toBeTruthy();
    expect(await screen.findByText('75%')).toBeTruthy();
    expect(screen.getByText('Smoke suite')).toBeTruthy();
  });
});
