import { rm } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { createDashboardFixtureRepo } from '../../../test-support/dashboard-fixtures';
import { buildServer } from '../src/index';

const fixtureRepo = await createDashboardFixtureRepo();

afterAll(async () => {
  await rm(fixtureRepo.repoRoot, { force: true, recursive: true });
});

describe('dashboard routes', () => {
  it('serves overview, runs, and benchmark summaries from artifact-backed queries', async () => {
    const app = buildServer({
      repoRoot: fixtureRepo.repoRoot,
    });

    const [overview, runs, benchmarks] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/overview' }),
      app.inject({ method: 'GET', url: '/api/runs?sort=updated_desc' }),
      app.inject({ method: 'GET', url: '/api/benchmarks' }),
    ]);

    expect(overview.statusCode).toBe(200);
    expect(overview.json().analytics.totalRuns).toBe(3);

    expect(runs.statusCode).toBe(200);
    expect(runs.json().items).toHaveLength(3);
    expect(runs.json().items[0].status).toBe('failed');

    expect(benchmarks.statusCode).toBe(200);
    expect(benchmarks.json().items[0].regressionStatus).toBe('failed');

    await app.close();
  });

  it('serves detailed run and benchmark views plus artifact preview content', async () => {
    const app = buildServer({
      repoRoot: fixtureRepo.repoRoot,
    });

    const runDetail = await app.inject({
      method: 'GET',
      url: `/api/runs/${fixtureRepo.ids.completedRunId}`,
    });
    const benchmarkDetail = await app.inject({
      method: 'GET',
      url: `/api/benchmarks/${fixtureRepo.ids.benchmarkRunId}`,
    });
    const artifact = await app.inject({
      method: 'GET',
      url: `/api/artifacts/content?path=${encodeURIComponent(
        `${fixtureRepo.repoRoot}/runs/local/${fixtureRepo.ids.completedRunId}/review-packet.md`,
      )}`,
    });

    expect(runDetail.statusCode).toBe(200);
    expect(runDetail.json().github.status).toBe('draft_pr_created');
    expect(runDetail.json().benchmarkLinks).toHaveLength(1);

    expect(benchmarkDetail.statusCode).toBe(200);
    expect(benchmarkDetail.json().summary.id).toBe(fixtureRepo.ids.benchmarkRunId);
    expect(benchmarkDetail.json().caseSummaries).toHaveLength(2);

    expect(artifact.statusCode).toBe(200);
    expect(artifact.body).toContain('Completed dashboard work.');

    await app.close();
  });
});
