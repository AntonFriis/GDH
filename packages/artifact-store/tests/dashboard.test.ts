import { rm } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { createDashboardFixtureRepo } from '../../../test-support/dashboard-fixtures';
import { createDashboardQueryService } from '../src/index';

const fixtureRepo = await createDashboardFixtureRepo();

afterAll(async () => {
  await rm(fixtureRepo.repoRoot, { force: true, recursive: true });
});

describe('dashboard query service', () => {
  it('aggregates runs, approvals, benchmarks, and analytics from artifact fixtures', async () => {
    const service = createDashboardQueryService({
      repoRoot: fixtureRepo.repoRoot,
    });

    const overview = await service.getOverview();
    const runs = await service.listRuns();
    const approvals = await service.listApprovals();
    const benchmarks = await service.listBenchmarks();
    const failures = await service.getFailureTaxonomy();

    expect(runs).toHaveLength(3);
    expect(approvals).toHaveLength(1);
    expect(benchmarks).toHaveLength(1);
    expect(overview.analytics.totalRuns).toBe(3);
    expect(overview.analytics.approvalRequiredRuns).toBe(1);
    expect(overview.analytics.verificationFailedRuns).toBe(1);
    expect(overview.analytics.githubDraftPrRuns).toBe(1);
    expect(overview.analytics.benchmarkRegressionFailures).toBe(1);

    expect(failures.buckets.find((bucket) => bucket.kind === 'approval_pending')?.count).toBe(1);
    expect(failures.buckets.find((bucket) => bucket.kind === 'verification_failed')?.count).toBe(1);
    expect(failures.buckets.find((bucket) => bucket.kind === 'benchmark_regression')?.count).toBe(
      1,
    );
  });

  it('builds a detailed run view with benchmark linkage and artifact previews', async () => {
    const service = createDashboardQueryService({
      repoRoot: fixtureRepo.repoRoot,
    });

    const detail = await service.getRunDetail(fixtureRepo.ids.completedRunId);

    expect(detail).not.toBeNull();
    expect(detail?.github.status).toBe('draft_pr_created');
    expect(detail?.verification.status).toBe('passed');
    expect(detail?.benchmarkLinks).toHaveLength(1);
    expect(detail?.artifactLinks.some((link) => link.label === 'review-packet.md')).toBe(true);
  });

  it('builds benchmark detail summaries including related governed run ids', async () => {
    const service = createDashboardQueryService({
      repoRoot: fixtureRepo.repoRoot,
    });

    const detail = await service.getBenchmarkDetail(fixtureRepo.ids.benchmarkRunId);

    expect(detail).not.toBeNull();
    expect(detail?.summary.regressionStatus).toBe('failed');
    expect(detail?.summary.relatedRunIds).toContain(fixtureRepo.ids.completedRunId);
    expect(detail?.caseSummaries).toHaveLength(2);
  });
});
