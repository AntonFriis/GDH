import { describe, expect, it } from 'vitest';
import { renderReviewChecklistMarkdown } from '../src/index';

describe('renderReviewChecklistMarkdown', () => {
  it('renders the main reviewer evidence with links and dashboard routes', () => {
    const markdown = renderReviewChecklistMarkdown({
      benchmarkRun: {
        artifactsDirectory: 'runs/benchmarks/benchmark-smoke-1',
        benchmarkRunId: 'benchmark-smoke-1',
        score: 1,
        status: 'completed',
        summary: '10/10 benchmark case(s) passed; overall score 1.00.',
      },
      dashboard: {
        apiHealthUrl: 'http://127.0.0.1:3000/health',
        benchmarkRoute: '/benchmarks/benchmark-smoke-1',
        command: 'pnpm dashboard:dev',
        runRoute: '/runs/demo-run-1',
        webUrl: 'http://127.0.0.1:5173',
      },
      demoRun: {
        artifactsDirectory: 'runs/local/demo-run-1',
        runId: 'demo-run-1',
        summary: 'Verification passed.',
      },
      environment: {
        branch: 'main',
        dirty: false,
        gitSha: 'abc1234',
        nodeVersion: 'v20.0.0',
        pnpmVersion: '10.0.0',
      },
      generatedAt: '2026-03-26T12:00:00.000Z',
      references: {
        architecture: 'docs/architecture-overview.md',
        benchmarkCorpus: 'reports/benchmark-corpus-summary.md',
        benchmarkSummary: 'reports/benchmark-summary.md',
        demoWalkthrough: 'docs/demo-walkthrough.md',
        knownLimitations: 'README.md#known-limitations',
        releaseReport: 'reports/v1-release-report.md',
      },
      version: '1.0.0',
    });

    expect(markdown).toContain('# GDH Review Checklist');
    expect(markdown).toContain('`pnpm release:validate` passed');
    expect(markdown).toContain('[docs/architecture-overview.md](docs/architecture-overview.md)');
    expect(markdown).toContain('`/runs/demo-run-1`');
    expect(markdown).toContain('[http://127.0.0.1:5173](http://127.0.0.1:5173)');
  });
});
