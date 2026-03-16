import type { Spec } from '@gdh/domain';
import { approvalPolicyValues, sandboxModeValues, taskClassValues } from '@gdh/domain';
import { z } from 'zod';

export const policyDecisionValues = ['allow', 'require_approval', 'block'] as const;

export const PolicyDecisionSchema = z.enum(policyDecisionValues);
export const PolicyMatchSchema = z.object({
  taskClasses: z.array(z.enum(taskClassValues)).optional(),
  paths: z.array(z.string()).optional(),
  actions: z.array(z.string()).optional(),
  toolCategories: z.array(z.string()).optional(),
  networkNeed: z.boolean().optional(),
  repoEnvironment: z.array(z.string()).optional(),
});

export const PolicyRuleSchema = z.object({
  id: z.string(),
  match: PolicyMatchSchema,
  decision: PolicyDecisionSchema,
  reason: z.string().optional(),
});

export const PolicyPackSchema = z.object({
  version: z.number(),
  name: z.string(),
  defaults: z.object({
    sandboxMode: z.enum(sandboxModeValues),
    networkAccess: z.boolean(),
    approvalPolicy: z.enum(approvalPolicyValues),
  }),
  rules: z.array(PolicyRuleSchema),
});

export const ResolvedPolicySchema = z.object({
  ruleId: z.string(),
  decision: PolicyDecisionSchema,
  reason: z.string(),
  sandboxMode: z.enum(sandboxModeValues),
  approvalPolicy: z.enum(approvalPolicyValues),
  networkAccess: z.boolean(),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type PolicyMatch = z.infer<typeof PolicyMatchSchema>;
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export type PolicyPack = z.infer<typeof PolicyPackSchema>;
export type ResolvedPolicy = z.infer<typeof ResolvedPolicySchema>;

export const defaultPhaseZeroPolicyPack: PolicyPack = {
  version: 1,
  name: 'phase1-placeholder',
  defaults: {
    sandboxMode: 'workspace-write',
    networkAccess: false,
    approvalPolicy: 'on-request',
  },
  rules: [],
};

export function createPlaceholderResolvedPolicy(
  decision: PolicyDecision = 'allow',
  reason = 'Phase 1 placeholder decision. Real policy evaluation begins in Phase 2.',
): ResolvedPolicy {
  return {
    ruleId: 'phase1-placeholder',
    decision,
    reason,
    sandboxMode: defaultPhaseZeroPolicyPack.defaults.sandboxMode,
    approvalPolicy: defaultPhaseZeroPolicyPack.defaults.approvalPolicy,
    networkAccess: defaultPhaseZeroPolicyPack.defaults.networkAccess,
  };
}

export function resolvePhaseOnePolicy(spec: Spec): ResolvedPolicy {
  return createPlaceholderResolvedPolicy(
    'allow',
    `Phase 1 placeholder policy resolution for "${spec.title}". Path-based approvals and blocking begin in Phase 2.`,
  );
}
