import { mkdir } from 'node:fs/promises';
import { phaseZeroMetadata } from '../packages/shared/src/index.ts';

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function main(): Promise<void> {
  await Promise.all([
    ensureDirectory('runs/local'),
    ensureDirectory('runs/fixtures'),
    ensureDirectory('reports'),
    ensureDirectory('docs/decisions'),
  ]);

  console.log(`${phaseZeroMetadata.project}: Phase ${phaseZeroMetadata.phase} bootstrap prepared.`);
  console.log(
    'Next step: run `pnpm validate` to confirm the workspace passes lint, typecheck, test, and build.',
  );
}

void main();
