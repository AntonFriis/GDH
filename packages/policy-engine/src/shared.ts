import { createHash } from 'node:crypto';
import type { ActionKind, ProposedCommand, ProposedFileChange } from '@gdh/domain';

export function createStableId(prefix: string, seed: string): string {
  return `${prefix}-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
}

export function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').trim();
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function classifyPathActions(path: string): ActionKind[] {
  const normalized = normalizePath(path).toLowerCase();
  const actions: ActionKind[] = ['read', 'write'];

  if (
    normalized === '.env' ||
    normalized.startsWith('.env.') ||
    normalized.endsWith('/.env') ||
    normalized.includes('/.env.') ||
    normalized.includes('secret') ||
    normalized.includes('credential')
  ) {
    actions.push('secrets_touch');
  }

  if (
    normalized.startsWith('.github/workflows/') ||
    normalized.endsWith('package.json') ||
    normalized.endsWith('pnpm-lock.yaml') ||
    normalized.endsWith('turbo.json') ||
    normalized.endsWith('biome.json') ||
    normalized.endsWith('.toml') ||
    normalized.endsWith('.yaml') ||
    normalized.endsWith('.yml') ||
    normalized.includes('/config/') ||
    normalized.includes('.config.')
  ) {
    actions.push('config_change');
  }

  return unique(actions);
}

export function classifyCommandActions(command: string): ActionKind[] {
  const normalized = command.trim().toLowerCase();
  const actions: ActionKind[] = ['command'];

  if (
    normalized.startsWith('git push') ||
    normalized.startsWith('git pull') ||
    normalized.startsWith('git fetch') ||
    normalized.startsWith('git remote') ||
    normalized.startsWith('gh ')
  ) {
    actions.push('git_remote');
  }

  if (
    normalized.startsWith('curl ') ||
    normalized.startsWith('wget ') ||
    normalized.startsWith('git clone ') ||
    normalized.startsWith('npm install ') ||
    normalized.startsWith('pnpm add ') ||
    normalized.startsWith('pnpm dlx ') ||
    normalized.startsWith('npx ') ||
    normalized.startsWith('yarn add ')
  ) {
    actions.push('network');
  }

  return unique(actions);
}

export function toPreviewFileChange(
  path: string,
  pathKind: ProposedFileChange['pathKind'],
): ProposedFileChange {
  const actions = classifyPathActions(path);

  return {
    actionKind: actions.includes('secrets_touch')
      ? 'secrets_touch'
      : actions.includes('config_change')
        ? 'config_change'
        : 'write',
    confidence: pathKind === 'file' ? 'high' : 'medium',
    path: normalizePath(path),
    pathKind,
    reason:
      pathKind === 'file'
        ? 'Explicit path extracted from the spec.'
        : 'Task-class heuristic path hint used because the spec did not name files directly.',
  };
}

export function toPreviewCommand(
  command: string,
  source: ProposedCommand['source'],
  reason: string,
): ProposedCommand {
  const actions = classifyCommandActions(command);

  return {
    actionKind: actions.includes('git_remote')
      ? 'git_remote'
      : actions.includes('network')
        ? 'network'
        : 'command',
    command: command.trim(),
    confidence: source === 'spec_text' ? 'high' : source === 'observed' ? 'high' : 'medium',
    reason,
    source,
  };
}
