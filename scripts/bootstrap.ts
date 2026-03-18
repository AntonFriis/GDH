import { mkdir } from 'node:fs/promises';
import { phaseZeroMetadata } from '../packages/shared/src/index.ts';

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function main(): Promise<void> {
  await Promise.all([
    ensureDirectory('runs/local'),
    ensureDirectory('runs/fixtures'),
    ensureDirectory('runs/benchmarks'),
    ensureDirectory('reports'),
    ensureDirectory('reports/release'),
    ensureDirectory('docs/architecture'),
    ensureDirectory('docs/demos'),
    ensureDirectory('docs/decisions'),
  ]);

  console.log(`${phaseZeroMetadata.project}: Phase ${phaseZeroMetadata.phase} bootstrap prepared.`);
  console.log(
    'Next steps: run `pnpm release:validate` for the full release-candidate sweep, `pnpm demo:prepare` to generate demo artifacts, or `pnpm dashboard:dev` to inspect persisted runs locally.',
  );
}

void main();
