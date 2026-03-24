import { rm } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { createDashboardFixtureRepo } from '../../../test-support/dashboard-fixtures';
import { createArtifactPreviewService, createDashboardSnapshotService } from '../src/index';

const fixtureRepo = await createDashboardFixtureRepo();

afterAll(async () => {
  await rm(fixtureRepo.repoRoot, { force: true, recursive: true });
});

describe('dashboard snapshot service', () => {
  it('aggregates runs, approvals, benchmarks, and analytics from artifact fixtures', async () => {
    const service = createDashboardSnapshotService({
      repoRoot: fixtureRepo.repoRoot,
    });

    const snapshot = await service.load();

    expect(snapshot.runs.items).toHaveLength(3);
    expect(snapshot.approvals).toHaveLength(1);
    expect(snapshot.benchmarks.items).toHaveLength(1);
    expect(snapshot.overview.analytics.totalRuns).toBe(3);
    expect(snapshot.overview.analytics.approvalRequiredRuns).toBe(1);
    expect(snapshot.overview.analytics.verificationFailedRuns).toBe(1);
    expect(snapshot.overview.analytics.githubDraftPrRuns).toBe(1);
    expect(snapshot.overview.analytics.benchmarkRegressionFailures).toBe(1);

    expect(
      snapshot.failures.buckets.find((bucket) => bucket.kind === 'approval_pending')?.count,
    ).toBe(1);
    expect(
      snapshot.failures.buckets.find((bucket) => bucket.kind === 'verification_failed')?.count,
    ).toBe(1);
    expect(
      snapshot.failures.buckets.find((bucket) => bucket.kind === 'benchmark_regression')?.count,
    ).toBe(1);
  });

  it('builds detail lookups with benchmark linkage inside the loaded snapshot', async () => {
    const service = createDashboardSnapshotService({
      repoRoot: fixtureRepo.repoRoot,
    });

    const snapshot = await service.load();
    const detail = snapshot.runs.detailsById[fixtureRepo.ids.completedRunId];

    expect(detail).toBeDefined();
    expect(detail.github.status).toBe('draft_pr_created');
    expect(detail.verification.status).toBe('passed');
    expect(detail.benchmarkLinks).toHaveLength(1);
    expect(detail.artifactLinks.some((link) => link.label === 'review-packet.md')).toBe(true);
    expect(
      snapshot.benchmarks.detailsById[fixtureRepo.ids.benchmarkRunId]?.summary.relatedRunIds,
    ).toContain(fixtureRepo.ids.completedRunId);
  });

  it('guards artifact preview reads to paths inside the repo root', async () => {
    const previewService = createArtifactPreviewService({
      repoRoot: fixtureRepo.repoRoot,
    });

    const preview = await previewService.read(
      `${fixtureRepo.repoRoot}/runs/local/${fixtureRepo.ids.completedRunId}/review-packet.md`,
    );
    const blockedPreview = await previewService.read('/tmp/outside-dashboard-preview.md');

    expect(preview?.content).toContain('Completed dashboard work.');
    expect(preview?.format).toBe('markdown');
    expect(blockedPreview).toBeNull();
  });
});
