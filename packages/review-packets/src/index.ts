import type { ReviewPacket } from '@gdh/domain';

export const reviewPacketSections = [
  'objective',
  'plan-summary',
  'files-changed',
  'tests-run',
  'policy-decisions',
  'approvals',
  'risks-open-questions',
  'claim-verification',
  'rollback-hint',
] as const;

export interface ReviewPacketGenerator {
  generate(runId: string): Promise<ReviewPacket>;
}

export function createReviewPacketOutline(runId: string): {
  runId: string;
  sections: typeof reviewPacketSections;
} {
  return {
    runId,
    sections: reviewPacketSections,
  };
}
