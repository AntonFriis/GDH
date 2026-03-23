import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface VerificationCommandSet {
  preflight: string[];
  postrun: string[];
  optional: string[];
}

export interface LoadedVerificationConfig {
  commands: VerificationCommandSet;
  path: string;
}

export const defaultVerificationCommandSet: VerificationCommandSet = {
  preflight: ['pnpm lint', 'pnpm typecheck'],
  postrun: ['pnpm test'],
  optional: ['pnpm test:e2e'],
};

function normalizeCommandList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item).trim()).filter(Boolean);
}

export async function loadVerificationConfig(
  repoRoot: string,
  configPath = resolve(repoRoot, 'gdh.config.json'),
): Promise<LoadedVerificationConfig> {
  try {
    const raw = JSON.parse(await readFile(configPath, 'utf8')) as {
      verification?: Partial<VerificationCommandSet>;
    };

    return {
      commands: {
        preflight: normalizeCommandList(raw.verification?.preflight),
        postrun: normalizeCommandList(raw.verification?.postrun),
        optional: normalizeCommandList(raw.verification?.optional),
      },
      path: configPath,
    };
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;

    if (fileError.code === 'ENOENT') {
      return {
        commands: defaultVerificationCommandSet,
        path: configPath,
      };
    }

    throw new Error(
      `Could not load verification config from "${configPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function describeVerificationScope(
  commands: VerificationCommandSet = defaultVerificationCommandSet,
): string[] {
  return [...commands.preflight, ...commands.postrun, ...commands.optional];
}
