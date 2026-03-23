import { createHash } from 'node:crypto';
import type {
  ClaimCategory,
  ClaimCheckResult,
  VerificationCheck,
  VerificationCheckStatus,
  VerificationEvidence,
} from '@gdh/domain';
import { VerificationCheckSchema } from '@gdh/domain';

export function createStableId(prefix: string, seed: string): string {
  return `${prefix}-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
}

export function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function createEvidence(
  kind: VerificationEvidence['kind'],
  label: string,
  options?: { path?: string; value?: string },
): VerificationEvidence {
  return {
    kind,
    label,
    path: options?.path,
    value: options?.value,
  };
}

export function createCheck(
  seed: string,
  input: {
    name: string;
    mandatory: boolean;
    status: VerificationCheckStatus;
    summary: string;
    details?: string[];
    evidence?: VerificationEvidence[];
    startedAt: string;
    completedAt: string;
  },
): VerificationCheck {
  return VerificationCheckSchema.parse({
    id: createStableId('verification-check', seed),
    name: input.name,
    mandatory: input.mandatory,
    status: input.status,
    summary: input.summary,
    details: input.details ?? [],
    evidence: input.evidence ?? [],
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  });
}

export function createClaimResult(
  seed: string,
  input: {
    category: ClaimCategory;
    claim: string;
    status: ClaimCheckResult['status'];
    reason: string;
    field?: string;
    evidence?: VerificationEvidence[];
  },
): ClaimCheckResult {
  return {
    id: createStableId('claim-check', seed),
    category: input.category,
    claim: input.claim,
    status: input.status,
    reason: input.reason,
    field: input.field,
    evidence: input.evidence ?? [],
  };
}
