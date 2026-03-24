import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFailureRecord,
  type createFailureSummary,
  listFailureRecords,
  toFailureLinkPath,
  writeFailureRecord,
  writeFailureSummaryArtifacts,
} from '../src/index';

const tempDirectories: string[] = [];

async function createTempRepo(): Promise<string> {
  const repoRoot = await mkdtemp(resolve(tmpdir(), 'gdh-failures-test-'));

  tempDirectories.push(repoRoot);

  await mkdir(resolve(repoRoot, '.git'), { recursive: true });
  await mkdir(resolve(repoRoot, 'runs', 'local'), { recursive: true });
  await mkdir(resolve(repoRoot, 'reports'), { recursive: true });
  await writeFile(resolve(repoRoot, 'README.md'), '# Temp Repo\n', 'utf8');

  return repoRoot;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('failure record store', () => {
  it('writes and lists typed failure records', async () => {
    const repoRoot = await createTempRepo();
    const record = createFailureRecord({
      category: 'policy-miss',
      description: 'A workflow edit bypassed the expected approval boundary.',
      links: [
        {
          label: 'policy decision',
          path: 'runs/local/run-1/policy.decision.json',
        },
      ],
      runId: 'run-1',
      severity: 'high',
      sourceSurface: 'run',
      title: 'Workflow write auto-allowed',
    });

    const recordPath = await writeFailureRecord({ repoRoot }, record);
    const stored = await listFailureRecords({ repoRoot });

    expect(recordPath).toContain('/reports/failures/records/');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.record.category).toBe('policy-miss');
    expect(stored[0]?.record.links[0]?.path).toBe('runs/local/run-1/policy.decision.json');
  });

  it('builds and writes failure summary artifacts', async () => {
    const repoRoot = await createTempRepo();

    await writeFailureRecord(
      { repoRoot },
      createFailureRecord({
        category: 'policy-miss',
        description: 'Protected workflow path was auto-allowed.',
        runId: 'run-1',
        severity: 'critical',
        sourceSurface: 'policy',
        title: 'Workflow guardrail missed',
      }),
    );
    await writeFailureRecord(
      { repoRoot },
      createFailureRecord({
        category: 'operator-confusion-dx',
        description: 'Benchmark output hid the inner governed run id.',
        severity: 'low',
        sourceSurface: 'benchmark',
        status: 'triaged',
        title: 'Benchmark summary hides linked run id',
      }),
    );

    const artifacts = await writeFailureSummaryArtifacts({ repoRoot });
    const summaryJson = JSON.parse(await readFile(artifacts.summaryPath, 'utf8')) as ReturnType<
      typeof createFailureSummary
    >;
    const summaryMarkdown = await readFile(artifacts.markdownPath, 'utf8');

    expect(summaryJson.totalRecords).toBe(2);
    expect(summaryJson.activeRecords).toBe(2);
    expect(summaryJson.countsByCategory.find((entry) => entry.label === 'policy-miss')?.count).toBe(
      1,
    );
    expect(summaryMarkdown).toContain('# Failure Summary');
    expect(summaryMarkdown).toContain('Workflow guardrail missed');
  });

  it('normalizes repo-local link paths to repo-relative paths', async () => {
    const repoRoot = await createTempRepo();
    const absolutePath = resolve(repoRoot, 'runs', 'local', 'run-1', 'policy.decision.json');

    expect(toFailureLinkPath(repoRoot, absolutePath)).toBe('runs/local/run-1/policy.decision.json');
    expect(toFailureLinkPath(repoRoot, 'reports/dogfooding-report.md')).toBe(
      'reports/dogfooding-report.md',
    );
  });
});
