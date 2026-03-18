import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const phaseMetadata = {
  project: 'Governed Delivery Control Plane',
  phase: '7',
  focus: 'Dashboard visibility and artifact-backed analytics',
  nextPhase: 'Phase 8 - Release hardening',
} as const;

export const phaseZeroMetadata = phaseMetadata;

export interface UnsupportedCertaintyClaimRule {
  pattern: RegExp;
  reason: string;
}

export const unsupportedCertaintyClaimRules: UnsupportedCertaintyClaimRule[] = [
  {
    pattern: /\bproduction-ready\b/i,
    reason: 'Production-readiness is not established by the deterministic Phase 3 evidence set.',
  },
  {
    pattern: /\bsafe\b/i,
    reason: 'Safety claims require explicit evidence and should not be asserted broadly.',
  },
  {
    pattern: /\bfully resolves all edge cases\b/i,
    reason: 'Edge-case completeness is too broad to prove from the current evidence.',
  },
  {
    pattern: /\b(?:is|are|was|were|now)\s+complete\b|\bfully\s+complete\b|^complete[.!]?$/i,
    reason: 'Broad completeness claims are disallowed unless the evidence explicitly proves them.',
  },
  {
    pattern: /\bverified\b/i,
    reason: 'Use the explicit verification summary instead of a broad “verified” claim.',
  },
] as const;

export function hasUnsupportedCertaintyClaim(value: string): boolean {
  return unsupportedCertaintyClaimRules.some((rule) => rule.pattern.test(value));
}

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
