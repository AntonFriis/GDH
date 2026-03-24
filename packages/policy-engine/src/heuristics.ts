import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Spec, TaskClassSchema, taskClassValues } from '@gdh/domain';
import { z } from 'zod';

export interface ImpactPreviewCommandHint {
  command: string;
  reason: string;
}

export interface ImpactPreviewHeuristics {
  version: 1;
  defaultPathHintsByTaskClass: Record<Spec['taskClass'], string[]>;
  defaultCommandsByTaskClass: Record<Spec['taskClass'], ImpactPreviewCommandHint[]>;
}

const impactPreviewCommandHintSchema = z.object({
  command: z.string().min(1),
  reason: z.string().min(1),
});

const impactPreviewHeuristicsOverrideSchema = z.object({
  version: z.literal(1).optional(),
  defaultPathHintsByTaskClass: z.partialRecord(TaskClassSchema, z.array(z.string())).optional(),
  defaultCommandsByTaskClass: z
    .partialRecord(TaskClassSchema, z.array(impactPreviewCommandHintSchema))
    .optional(),
});

export const defaultImpactPreviewHeuristics: ImpactPreviewHeuristics = {
  version: 1,
  defaultPathHintsByTaskClass: {
    ci: ['.github/workflows/**'],
    docs: ['README.md', 'docs/**', 'documentation.md', 'AGENTS.md', 'PLANS.md', 'implement.md'],
    other: ['**/*'],
    refactor: ['src/**'],
    release_notes: ['CHANGELOG.md', 'docs/**'],
    tests: ['tests/**', '**/*.test.ts', '**/*.spec.ts'],
    triage: ['docs/**', 'reports/**'],
  },
  defaultCommandsByTaskClass: {
    ci: [
      {
        command: 'pnpm lint',
        reason: 'CI-oriented work commonly validates the repo with lint.',
      },
      {
        command: 'pnpm typecheck',
        reason: 'CI-oriented work commonly validates the repo with typecheck.',
      },
    ],
    docs: [],
    other: [],
    refactor: [
      {
        command: 'pnpm typecheck',
        reason: 'Structured refactors commonly validate type safety before finishing.',
      },
    ],
    release_notes: [],
    tests: [
      {
        command: 'pnpm test',
        reason: 'Test-focused work commonly validates the changed suite locally.',
      },
    ],
    triage: [],
  },
};

function mergeTaskClassRecord<T>(
  base: Record<Spec['taskClass'], T>,
  override?: Partial<Record<Spec['taskClass'], T>>,
): Record<Spec['taskClass'], T> {
  const merged = {} as Record<Spec['taskClass'], T>;

  for (const taskClass of taskClassValues) {
    merged[taskClass] = override?.[taskClass] ?? base[taskClass];
  }

  return merged;
}

export function mergeImpactPreviewHeuristics(override?: {
  defaultCommandsByTaskClass?: Partial<Record<Spec['taskClass'], ImpactPreviewCommandHint[]>>;
  defaultPathHintsByTaskClass?: Partial<Record<Spec['taskClass'], string[]>>;
}): ImpactPreviewHeuristics {
  return {
    version: 1,
    defaultPathHintsByTaskClass: mergeTaskClassRecord(
      defaultImpactPreviewHeuristics.defaultPathHintsByTaskClass,
      override?.defaultPathHintsByTaskClass,
    ),
    defaultCommandsByTaskClass: mergeTaskClassRecord(
      defaultImpactPreviewHeuristics.defaultCommandsByTaskClass,
      override?.defaultCommandsByTaskClass,
    ),
  };
}

export async function loadImpactPreviewHeuristics(
  repoRoot: string,
  filePath = resolve(repoRoot, 'config', 'optimization', 'impact-preview-hints.json'),
): Promise<ImpactPreviewHeuristics> {
  try {
    const parsed = impactPreviewHeuristicsOverrideSchema.parse(
      JSON.parse(await readFile(filePath, 'utf8')),
    );

    return mergeImpactPreviewHeuristics({
      defaultCommandsByTaskClass: parsed.defaultCommandsByTaskClass,
      defaultPathHintsByTaskClass: parsed.defaultPathHintsByTaskClass,
    });
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;

    if (fileError.code === 'ENOENT') {
      return defaultImpactPreviewHeuristics;
    }

    throw new Error(
      `Could not load impact preview heuristics from "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
