import { createHash } from 'node:crypto';

function createContentHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function createRunScopedId(prefix: string, seed: string): string {
  return `${prefix}-${createContentHash(seed).slice(0, 12)}`;
}
