import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const phaseMetadata = {
  project: 'Governed Delivery Control Plane',
  phase: '8',
  focus: 'Release hardening, packaging, demo readiness, and final polish',
  nextPhase: 'Future work - post-release extensions only',
} as const;

export const phaseZeroMetadata = phaseMetadata;

export interface UnsupportedCertaintyClaimRule {
  pattern: RegExp;
  reason: string;
  matches?: (value: string) => boolean;
}

const explicitCommandPattern =
  /(?:`[^`\r\n]+`|(?:pnpm|npm|npx|pnpx|yarn|bun|node|python3?|pytest|vitest|biome|tsc|tsx|cargo|go|dotnet|gradle|mvn|make|cmake|just|git|gh)(?:\s+[^\s.!?\r\n`]+)+)/i;

const commandQualifiedVerifiedPattern = new RegExp(
  String.raw`\bverified\b[^.!?\r\n]*(?:with|using|via)\s+${explicitCommandPattern.source}`,
  'i',
);
const allowedQualifiedSafePattern = /^(?:benchmark|ci|demo|fixture|local|smoke|test)-safe$/i;

export const unsupportedCertaintyClaimRules: UnsupportedCertaintyClaimRule[] = [
  {
    pattern: /\bproduction-ready\b/i,
    reason: 'Production-readiness is not established by the deterministic Phase 3 evidence set.',
  },
  {
    pattern: /\b(?:[A-Za-z0-9]+-)?safe\b/i,
    reason: 'Safety claims require explicit evidence and should not be asserted broadly.',
    matches: (value) =>
      [...value.matchAll(/\b(?:[A-Za-z0-9]+-)?safe\b/gi)].some(
        (match) => !allowedQualifiedSafePattern.test(match[0] ?? ''),
      ),
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
    pattern: /\bverified\b(?!\s+(?:with|using|via)\s+`[^`\r\n]+`)/i,
    reason: 'Use the explicit verification summary instead of a broad “verified” claim.',
    matches: (value) => /\bverified\b/i.test(value) && !commandQualifiedVerifiedPattern.test(value),
  },
] as const;

export function matchesUnsupportedCertaintyClaimRule(
  value: string,
  rule: UnsupportedCertaintyClaimRule,
): boolean {
  return rule.matches ? rule.matches(value) : rule.pattern.test(value);
}

export function hasUnsupportedCertaintyClaim(value: string): boolean {
  return unsupportedCertaintyClaimRules.some((rule) =>
    matchesUnsupportedCertaintyClaimRule(value, rule),
  );
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

function parseEnvAssignment(rawLine: string): [string, string] | undefined {
  const line = rawLine.trim();

  if (!line || line.startsWith('#')) {
    return undefined;
  }

  const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
  const separatorIndex = normalized.indexOf('=');

  if (separatorIndex <= 0) {
    return undefined;
  }

  const key = normalized.slice(0, separatorIndex).trim();
  const rawValue = normalized.slice(separatorIndex + 1).trim();

  if (!key) {
    return undefined;
  }

  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return [key, rawValue.slice(1, -1)];
  }

  return [key, rawValue];
}

export async function loadRepoEnv(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string>> {
  const mergedFileValues: Record<string, string> = {};

  for (const relativePath of ['.env', '.env.local']) {
    try {
      const content = await readFile(resolve(repoRoot, relativePath), 'utf8');

      for (const line of content.split(/\r?\n/u)) {
        const entry = parseEnvAssignment(line);

        if (!entry) {
          continue;
        }

        const [key, value] = entry;
        mergedFileValues[key] = value;
      }
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;

      if (fileError.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  for (const [key, value] of Object.entries(mergedFileValues)) {
    if (env[key] === undefined) {
      env[key] = value;
    }
  }

  return mergedFileValues;
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
