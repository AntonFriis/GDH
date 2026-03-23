import type {
  ImpactPreview,
  Plan,
  PolicyPack,
  ProposedCommand,
  ProposedFileChange,
  Spec,
} from '@gdh/domain';
import { ImpactPreviewSchema } from '@gdh/domain';
import {
  classifyCommandActions,
  classifyPathActions,
  createStableId,
  toPreviewCommand,
  toPreviewFileChange,
  unique,
} from './shared.js';

export interface ImpactPreviewInput {
  runId: string;
  spec: Spec;
  plan: Plan;
  sandboxMode: PolicyPack['defaults']['sandboxMode'];
  networkAccess: boolean;
  createdAt?: string;
}

const defaultPathHintsByTaskClass: Record<Spec['taskClass'], string[]> = {
  ci: ['.github/workflows/**'],
  docs: ['README.md', 'docs/**', 'documentation.md', 'AGENTS.md', 'PLANS.md', 'implement.md'],
  other: ['**/*'],
  refactor: ['src/**'],
  release_notes: ['CHANGELOG.md', 'docs/**'],
  tests: ['tests/**', '**/*.test.ts', '**/*.spec.ts'],
  triage: ['docs/**', 'reports/**'],
};

const defaultCommandsByTaskClass: Record<
  Spec['taskClass'],
  Array<{ command: string; reason: string }>
> = {
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
};

const commandLikePrefixes = [
  'pnpm ',
  'npm ',
  'yarn ',
  'node ',
  'npx ',
  'git ',
  'gh ',
  'bash ',
  'sh ',
  'curl ',
  'wget ',
  'python ',
  'python3 ',
  'tsx ',
  'vitest ',
];

function extractBacktickedSnippets(text: string): string[] {
  const snippets: string[] = [];
  const pattern = /`([^`\n]+)`/g;

  for (const match of text.matchAll(pattern)) {
    const snippet = match[1]?.trim();

    if (snippet) {
      snippets.push(snippet);
    }
  }

  return unique(snippets);
}

function looksLikeCommandSnippet(snippet: string): boolean {
  const normalized = snippet.trim().toLowerCase();
  return commandLikePrefixes.some((prefix) => normalized.startsWith(prefix));
}

function looksLikePathSnippet(snippet: string): boolean {
  const normalized = snippet.trim();

  if (!normalized || looksLikeCommandSnippet(normalized) || /\s/.test(normalized)) {
    return false;
  }

  return (
    normalized.includes('/') || normalized.startsWith('.') || /\.[A-Za-z0-9_-]+$/.test(normalized)
  );
}

function collectSpecSnippets(spec: Spec, plan: Plan): string[] {
  return unique(
    extractBacktickedSnippets(
      [
        spec.title,
        spec.summary,
        spec.objective,
        spec.body,
        ...spec.constraints,
        ...spec.acceptanceCriteria,
        ...spec.riskHints,
        plan.summary,
      ].join('\n'),
    ),
  );
}

export function generateImpactPreview(input: ImpactPreviewInput): ImpactPreview {
  const snippets = collectSpecSnippets(input.spec, input.plan);
  const explicitPaths = snippets
    .filter(looksLikePathSnippet)
    .map((snippet) => toPreviewFileChange(snippet, 'file'));
  const explicitCommands = snippets
    .filter(looksLikeCommandSnippet)
    .map((snippet) =>
      toPreviewCommand(snippet, 'spec_text', 'Explicit command extracted from the spec.'),
    );
  const fallbackPaths =
    explicitPaths.length > 0
      ? []
      : defaultPathHintsByTaskClass[input.spec.taskClass].map((path) =>
          toPreviewFileChange(path, 'glob'),
        );
  const fallbackCommands =
    explicitCommands.length > 0
      ? []
      : defaultCommandsByTaskClass[input.spec.taskClass].map((entry) =>
          toPreviewCommand(entry.command, 'heuristic', entry.reason),
        );
  const proposedFileChanges = unique(
    [...explicitPaths, ...fallbackPaths].map((fileChange) => JSON.stringify(fileChange)),
  ).map((value) => JSON.parse(value) as ProposedFileChange);
  const proposedCommands = unique(
    [...explicitCommands, ...fallbackCommands].map((command) => JSON.stringify(command)),
  ).map((value) => JSON.parse(value) as ProposedCommand);
  const actionKinds = unique([
    'read',
    ...proposedFileChanges.flatMap((fileChange) => classifyPathActions(fileChange.path)),
    ...proposedCommands.flatMap((command) => classifyCommandActions(command.command)),
  ]);
  const uncertaintyNotes: string[] = [];

  if (explicitPaths.length === 0) {
    uncertaintyNotes.push(
      'No explicit file paths were found in the spec, so task-class path heuristics were used.',
    );
  }

  if (explicitCommands.length === 0 && fallbackCommands.length === 0) {
    uncertaintyNotes.push(
      'No explicit commands were found in the spec, and no task-class command heuristic was required.',
    );
  }

  const requestedNetworkAccess =
    input.networkAccess ||
    proposedCommands.some((command) => classifyCommandActions(command.command).includes('network'));

  return ImpactPreviewSchema.parse({
    actionKinds,
    createdAt: input.createdAt ?? new Date().toISOString(),
    id: createStableId('impact', `${input.runId}:${input.spec.id}:${input.plan.id}`),
    planId: input.plan.id,
    proposedCommands,
    proposedFileChanges,
    rationale: [
      'The impact preview is derived from the normalized spec and deterministic task-class heuristics.',
      'This preview is predictive only; post-run policy audit is the evidence-backed check against actual changes.',
    ],
    requestedNetworkAccess,
    requestedSandboxMode: proposedFileChanges.length > 0 ? 'workspace-write' : 'read-only',
    riskHints: input.spec.riskHints,
    runId: input.runId,
    specId: input.spec.id,
    summary: `Impact preview predicts ${proposedFileChanges.length} file target(s) and ${proposedCommands.length} command(s).`,
    taskClass: input.spec.taskClass,
    uncertaintyNotes,
  });
}
