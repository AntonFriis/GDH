import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const phaseMetadata = {
  project: 'Governed Delivery Control Plane',
  phase: '2',
  focus: 'Policy evaluation and approval gating for local governed runs',
  nextPhase: 'Phase 3 - Verification and packet fidelity',
} as const;

export const phaseZeroMetadata = phaseMetadata;

export const requiredRepoPaths = [
  'apps/cli',
  'apps/api',
  'apps/web',
  'packages/domain',
  'packages/runner-codex',
  'packages/policy-engine',
  'packages/artifact-store',
  'packages/verification',
  'packages/review-packets',
  'packages/github-adapter',
  'packages/evals',
  'packages/prompts',
  'packages/benchmark-cases',
  'policies',
  'prompts',
  'runs',
  'reports',
  'docs',
  '.codex/config.toml',
] as const;

export const requiredPhaseZeroPaths = requiredRepoPaths;

export function createIsoTimestamp(date = new Date()): string {
  return date.toISOString();
}

export function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'run'
  );
}

export function createShortHash(value: string, length = 10): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

export function createRunId(label: string, date = new Date()): string {
  const stamp = createIsoTimestamp(date)
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'z');
  return `${slugify(label)}-${stamp}-${createShortHash(randomUUID(), 6)}`;
}

export async function findRepoRoot(startDirectory: string): Promise<string> {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    try {
      await access(resolve(currentDirectory, '.git'), constants.F_OK);
      return currentDirectory;
    } catch {
      const parentDirectory = dirname(currentDirectory);

      if (parentDirectory === currentDirectory) {
        throw new Error(`Could not locate a Git repository root from "${startDirectory}".`);
      }

      currentDirectory = parentDirectory;
    }
  }
}
