import { z } from 'zod';

export const taskClassValues = [
  'docs',
  'tests',
  'ci',
  'refactor',
  'release_notes',
  'triage',
  'other',
] as const;
export const riskLevelValues = ['low', 'medium', 'high'] as const;
export const taskModeValues = ['read_only', 'workspace_write'] as const;
export const taskStatusValues = ['pending', 'running', 'blocked', 'done', 'failed'] as const;
export const milestoneStatusValues = ['pending', 'in_progress', 'done'] as const;
export const runStatusValues = [
  'created',
  'planning',
  'running',
  'awaiting_approval',
  'verifying',
  'completed',
  'failed',
  'cancelled',
] as const;
export const runnerValues = ['codex-cli', 'codex-sdk'] as const;
export const sandboxModeValues = ['read-only', 'workspace-write'] as const;
export const approvalPolicyValues = ['untrusted', 'on-request', 'never'] as const;
export const verificationCheckStatusValues = ['passed', 'failed', 'not_run'] as const;
export const claimVerificationStatusValues = ['verified', 'unsupported', 'not_run'] as const;

export const TaskClassSchema = z.enum(taskClassValues);
export const RiskLevelSchema = z.enum(riskLevelValues);
export const TaskModeSchema = z.enum(taskModeValues);
export const TaskStatusSchema = z.enum(taskStatusValues);
export const MilestoneStatusSchema = z.enum(milestoneStatusValues);
export const RunStatusSchema = z.enum(runStatusValues);
export const RunnerSchema = z.enum(runnerValues);
export const SandboxModeSchema = z.enum(sandboxModeValues);
export const ApprovalPolicySchema = z.enum(approvalPolicyValues);
export const VerificationCheckStatusSchema = z.enum(verificationCheckStatusValues);
export const ClaimVerificationStatusSchema = z.enum(claimVerificationStatusValues);
export const SpecSourceSchema = z.enum(['markdown', 'github_issue', 'release_note', 'manual']);

export const ArtifactReferenceSchema = z.object({
  id: z.string(),
  kind: z.string(),
  path: z.string(),
  summary: z.string().optional(),
});

export const PlanMilestoneSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: MilestoneStatusSchema,
});

export const VerificationCheckSchema = z.object({
  name: z.string(),
  status: VerificationCheckStatusSchema,
  details: z.string().optional(),
});

export const ClaimVerificationSchema = z.object({
  claim: z.string(),
  status: ClaimVerificationStatusSchema,
  evidence: z.array(z.string()),
});

export const SpecSchema = z.object({
  id: z.string(),
  source: SpecSourceSchema,
  title: z.string(),
  body: z.string(),
  repoRoot: z.string(),
  taskClass: TaskClassSchema,
  riskHints: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  constraints: z.array(z.string()),
  createdAt: z.string(),
});

export const PlanSchema = z.object({
  id: z.string(),
  specId: z.string(),
  summary: z.string(),
  milestones: z.array(PlanMilestoneSchema),
  assumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  verificationSteps: z.array(z.string()),
  generatedAt: z.string(),
});

export const TaskUnitSchema = z.object({
  id: z.string(),
  planId: z.string(),
  title: z.string(),
  description: z.string(),
  dependsOn: z.array(z.string()),
  riskLevel: RiskLevelSchema,
  suggestedMode: TaskModeSchema,
  status: TaskStatusSchema,
});

export const RunSchema = z.object({
  id: z.string(),
  specId: z.string(),
  planId: z.string(),
  status: RunStatusSchema,
  runner: RunnerSchema,
  model: z.string(),
  sandboxMode: SandboxModeSchema,
  approvalPolicy: ApprovalPolicySchema,
  branchName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const RunEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  type: z.enum([
    'run.created',
    'plan.generated',
    'task.started',
    'task.completed',
    'policy.blocked',
    'approval.requested',
    'approval.granted',
    'approval.denied',
    'verification.started',
    'verification.completed',
    'review_packet.generated',
    'eval.completed',
    'run.failed',
  ]),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const ApprovalPacketSchema = z.object({
  id: z.string(),
  runId: z.string(),
  reason: z.string(),
  affectedPaths: z.array(z.string()),
  requestedAction: z.string(),
  riskSummary: z.string(),
  proposedMitigations: z.array(z.string()),
  diffSummary: z.array(z.string()),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
  resolution: z.enum(['approved', 'rejected']).optional(),
});

export const VerificationResultSchema = z.object({
  id: z.string(),
  runId: z.string(),
  testsPassed: z.boolean(),
  checks: z.array(VerificationCheckSchema),
  summary: z.string(),
  createdAt: z.string(),
});

export const ReviewPacketSchema = z.object({
  id: z.string(),
  runId: z.string(),
  title: z.string(),
  summary: z.string(),
  filesChanged: z.array(z.string()),
  testsRun: z.array(z.string()),
  risks: z.array(z.string()),
  openQuestions: z.array(z.string()),
  claimVerification: z.array(ClaimVerificationSchema),
  createdAt: z.string(),
});

export const EvalRunSchema = z.object({
  id: z.string(),
  benchmarkSuite: z.enum(['smoke', 'fresh', 'longhorizon']),
  configHash: z.string(),
  resultSummary: z.object({
    successRate: z.number(),
    policyViolationRate: z.number(),
    avgLatencyMs: z.number(),
    avgCostUsd: z.number().optional(),
  }),
  createdAt: z.string(),
});

export type TaskClass = z.infer<typeof TaskClassSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type TaskMode = z.infer<typeof TaskModeSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type MilestoneStatus = z.infer<typeof MilestoneStatusSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunnerKind = z.infer<typeof RunnerSchema>;
export type SandboxMode = z.infer<typeof SandboxModeSchema>;
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;
export type PlanMilestone = z.infer<typeof PlanMilestoneSchema>;
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;
export type ClaimVerification = z.infer<typeof ClaimVerificationSchema>;
export type Spec = z.infer<typeof SpecSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type TaskUnit = z.infer<typeof TaskUnitSchema>;
export type Run = z.infer<typeof RunSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
export type ApprovalPacket = z.infer<typeof ApprovalPacketSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type ReviewPacket = z.infer<typeof ReviewPacketSchema>;
export type EvalRun = z.infer<typeof EvalRunSchema>;
