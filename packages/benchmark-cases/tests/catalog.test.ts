import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadBenchmarkCatalog,
  loadBenchmarkIntakeCatalog,
  resolveBenchmarkTarget,
} from '../src/index';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const tempDirectories: string[] = [];

async function createTempBenchmarkRepo(): Promise<string> {
  const tempRoot = await mkdtemp(resolve(tmpdir(), 'gdh-benchmark-catalog-'));

  tempDirectories.push(tempRoot);
  await cp(resolve(repoRoot, 'benchmarks'), resolve(tempRoot, 'benchmarks'), { recursive: true });
  return tempRoot;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('loadBenchmarkCatalog', () => {
  it('loads the benchmark suites and accepted cases from repo artifacts', async () => {
    const catalog = await loadBenchmarkCatalog(repoRoot);
    const smokeSuite = catalog.suiteMap.get('smoke');
    const freshSuite = catalog.suiteMap.get('fresh');
    const longhorizonSuite = catalog.suiteMap.get('longhorizon');

    expect(smokeSuite?.resolvedBaselineArtifactPath).toBe(
      resolve(repoRoot, 'benchmarks/baselines/smoke-baseline.json'),
    );
    expect(freshSuite?.resolvedBaselineArtifactPath).toBe(
      resolve(repoRoot, 'benchmarks/baselines/fresh-baseline.json'),
    );
    expect(longhorizonSuite?.resolvedBaselineArtifactPath).toBe(
      resolve(repoRoot, 'benchmarks/baselines/longhorizon-baseline.json'),
    );
    expect(catalog.caseMap.has('smoke-success-docs')).toBe(true);
    expect(catalog.caseMap.has('smoke-policy-prompt')).toBe(true);
    expect(catalog.caseMap.has('smoke-policy-forbid')).toBe(true);
    expect(catalog.caseMap.has('smoke-verification-failure')).toBe(true);
    expect(catalog.caseMap.has('fresh-docs-issue-to-draft-pr-example')).toBe(true);
    expect(catalog.caseMap.has('fresh-refactor-forward-head-pr-eligibility')).toBe(true);
    expect(catalog.caseMap.has('longhorizon-release-story-pack')).toBe(true);
    expect(catalog.caseMap.get('fresh-tests-dashboard-loading-wait')?.metadata?.sourceType).toBe(
      'git_commit',
    );
    expect(catalog.cases.every((caseDefinition) => caseDefinition.suiteIds.length === 1)).toBe(
      true,
    );
    expect(
      catalog.caseMap
        .get('smoke-success-ci-workflow')
        ?.metadata?.graders.map((grader) => grader.name),
    ).toContain('task_completion');
  });
});

describe('resolveBenchmarkTarget', () => {
  it('resolves both suite ids and case ids', async () => {
    const catalog = await loadBenchmarkCatalog(repoRoot);
    const suiteTarget = resolveBenchmarkTarget(catalog, 'smoke');
    const caseTarget = resolveBenchmarkTarget(catalog, 'fresh-docs-run-lifecycle-service-rfc');

    expect(suiteTarget.kind).toBe('suite');
    expect(suiteTarget.kind === 'suite' ? suiteTarget.cases.length : 0).toBe(10);
    expect(caseTarget.kind).toBe('case');
    expect(caseTarget.kind === 'case' ? caseTarget.caseDefinition.id : '').toBe(
      'fresh-docs-run-lifecycle-service-rfc',
    );
  });
});

describe('loadBenchmarkIntakeCatalog', () => {
  it('loads accepted and rejected fresh-task intake artifacts', async () => {
    const intakeCatalog = await loadBenchmarkIntakeCatalog(repoRoot);

    expect(intakeCatalog.candidates).toHaveLength(8);
    expect(intakeCatalog.rejected).toHaveLength(2);
    expect(
      intakeCatalog.candidateMap.get('fresh-candidate-forward-head-pr-eligibility')?.review
        .acceptedCaseId,
    ).toBe('fresh-refactor-forward-head-pr-eligibility');
    expect(intakeCatalog.rejectedMap.get('fresh-candidate-live-codex-runner')?.review.status).toBe(
      'rejected',
    );
  });

  it('rejects accepted-case files that are stored under the wrong suite directory', async () => {
    const tempRoot = await createTempBenchmarkRepo();
    const casePath = resolve(
      tempRoot,
      'benchmarks/fresh/cases/fresh-docs-issue-to-draft-pr-example.yaml',
    );
    const original = await readFile(casePath, 'utf8');

    await writeFile(casePath, original.replace('suiteIds:\n  - fresh', 'suiteIds:\n  - smoke'));

    await expect(loadBenchmarkCatalog(tempRoot)).rejects.toThrow(
      'must belong only to suite "fresh"',
    );
  });

  it('rejects rejected intake records that are not marked rejected', async () => {
    const tempRoot = await createTempBenchmarkRepo();
    const rejectedPath = resolve(
      tempRoot,
      'benchmarks/fresh/rejected/fresh-candidate-live-codex-runner.yaml',
    );
    const original = await readFile(rejectedPath, 'utf8');

    await writeFile(rejectedPath, original.replace('status: rejected', 'status: accepted'));

    await expect(loadBenchmarkIntakeCatalog(tempRoot)).rejects.toThrow(
      'must use review.status "rejected"',
    );
  });
});
