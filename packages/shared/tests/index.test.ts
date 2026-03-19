import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasUnsupportedCertaintyClaim, loadRepoEnv } from '../src/index';

describe('hasUnsupportedCertaintyClaim', () => {
  it('flags explicit completeness claims', () => {
    expect(hasUnsupportedCertaintyClaim('The run is complete.')).toBe(true);
  });

  it('flags broad verified claims', () => {
    expect(hasUnsupportedCertaintyClaim('The change is verified.')).toBe(true);
  });

  it('does not flag command-qualified verified statements', () => {
    expect(hasUnsupportedCertaintyClaim('Verified with `pnpm lint:root`.')).toBe(false);
  });

  it('does not flag evidence-qualified verified statements with scoped context', () => {
    expect(
      hasUnsupportedCertaintyClaim(
        'Deepened the RFC and verified the touched docs with Biome via pnpm lint:root.',
      ),
    ).toBe(false);
  });

  it('does not flag task objectives that use complete as a verb', () => {
    expect(
      hasUnsupportedCertaintyClaim(
        'Create a short docs note that proves the run can complete a low-risk docs task end to end.',
      ),
    ).toBe(false);
  });
});

describe('loadRepoEnv', () => {
  it('loads repo root env files while preserving explicit environment values', async () => {
    const repoRoot = await mkdtemp(resolve(tmpdir(), 'gdh-shared-env-'));

    await writeFile(
      resolve(repoRoot, '.env'),
      'API_PORT=3001\nGITHUB_TOKEN=from-env-file\n',
      'utf8',
    );
    await writeFile(
      resolve(repoRoot, '.env.local'),
      'WEB_PORT=5174\nGITHUB_TOKEN=from-env-local\n',
      'utf8',
    );

    const env: NodeJS.ProcessEnv = {
      GITHUB_TOKEN: 'explicit-token',
    };

    const loaded = await loadRepoEnv(repoRoot, env);

    expect(loaded.API_PORT).toBe('3001');
    expect(loaded.WEB_PORT).toBe('5174');
    expect(loaded.GITHUB_TOKEN).toBe('from-env-local');
    expect(env.API_PORT).toBe('3001');
    expect(env.WEB_PORT).toBe('5174');
    expect(env.GITHUB_TOKEN).toBe('explicit-token');
  });
});
