import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBenchmarkCatalog, resolveBenchmarkTarget } from '../src/index';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('loadBenchmarkCatalog', () => {
  it('loads the seeded smoke suite and benchmark cases from repo artifacts', async () => {
    const catalog = await loadBenchmarkCatalog(repoRoot);
    const smokeSuite = catalog.suiteMap.get('smoke');

    expect(smokeSuite?.resolvedBaselineArtifactPath).toBe(
      resolve(repoRoot, 'benchmarks/baselines/smoke-baseline.json'),
    );
    expect(catalog.caseMap.has('smoke-success-docs')).toBe(true);
    expect(catalog.caseMap.has('smoke-policy-prompt')).toBe(true);
    expect(catalog.caseMap.has('smoke-policy-forbid')).toBe(true);
    expect(catalog.caseMap.has('smoke-verification-failure')).toBe(true);
  });
});

describe('resolveBenchmarkTarget', () => {
  it('resolves both suite ids and case ids', async () => {
    const catalog = await loadBenchmarkCatalog(repoRoot);
    const suiteTarget = resolveBenchmarkTarget(catalog, 'smoke');
    const caseTarget = resolveBenchmarkTarget(catalog, 'smoke-success-docs');

    expect(suiteTarget.kind).toBe('suite');
    expect(suiteTarget.kind === 'suite' ? suiteTarget.cases.length : 0).toBe(4);
    expect(caseTarget.kind).toBe('case');
    expect(caseTarget.kind === 'case' ? caseTarget.caseDefinition.id : '').toBe(
      'smoke-success-docs',
    );
  });
});
