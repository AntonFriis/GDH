import type { VerificationResult } from '@gdh/domain';

export interface VerificationCommandSet {
  preflight: string[];
  postrun: string[];
  optional: string[];
}

export const defaultVerificationCommandSet: VerificationCommandSet = {
  preflight: ['pnpm lint', 'pnpm typecheck'],
  postrun: ['pnpm test'],
  optional: ['pnpm test:e2e'],
};

export interface VerificationEngine {
  verify(runId: string, commands?: VerificationCommandSet): Promise<VerificationResult>;
}

export function describeVerificationScope(
  commands: VerificationCommandSet = defaultVerificationCommandSet,
): string[] {
  return [...commands.preflight, ...commands.postrun, ...commands.optional];
}
