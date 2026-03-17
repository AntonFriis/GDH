import { createHash } from 'node:crypto';
import { basename } from 'node:path';
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
export const runStatusValues = [
  'created',
  'planning',
  'running',
  'in_progress',
  'awaiting_approval',
  'interrupted',
  'resumable',
  'resuming',
  'verifying',
  'completed',
  'failed',
  'cancelled',
  'abandoned',
] as const;
export const runStageValues = [
  'created',
  'spec_normalized',
  'plan_created',
  'policy_evaluated',
  'awaiting_approval',
  'approval_resolved',
  'runner_started',
  'runner_completed',
  'verification_started',
  'verification_completed',
] as const;
export const checkpointStageValues = [
  'spec_normalized',
  'plan_created',
  'policy_evaluated',
  'approval_resolved',
  'runner_completed',
  'verification_completed',
] as const;
export const runnerValues = ['codex-cli', 'codex-sdk', 'fake'] as const;
export const sandboxModeValues = ['read-only', 'workspace-write'] as const;
export const approvalPolicyValues = ['untrusted', 'on-request', 'never'] as const;
export const approvalModeValues = ['interactive', 'fail'] as const;
export const specSourceValues = ['markdown', 'github_issue', 'release_note', 'manual'] as const;
export const actionKindValues = [
  'read',
  'write',
  'command',
  'network',
  'git_remote',
  'config_change',
  'secrets_touch',
  'unknown',
] as const;
export const policyDecisionValues = ['allow', 'prompt', 'forbid'] as const;
export const approvalResolutionValues = ['approved', 'denied', 'abandoned'] as const;
export const previewConfidenceValues = ['high', 'medium', 'low'] as const;
export const proposedPathKindValues = ['file', 'glob'] as const;
export const proposedCommandSourceValues = [
  'heuristic',
  'runner_preview',
  'spec_text',
  'observed',
] as const;
export const policyMatchDimensionValues = [
  'path',
  'action',
  'command',
  'task_class',
  'risk_hint',
  'fallback',
] as const;
export const runEventTypeValues = [
  'run.created',
  'session.started',
  'spec.normalized',
  'plan.created',
  'checkpoint.created',
  'progress.snapshot.created',
  'impact_preview.created',
  'policy.evaluated',
  'approval.requested',
  'approval.granted',
  'approval.denied',
  'policy.blocked',
  'runner.started',
  'runner.completed',
  'runner.failed',
  'run.interrupted',
  'run.marked_resumable',
  'resume.requested',
  'resume.started',
  'resume.completed',
  'resume.failed',
  'status.requested',
  'verification.started',
  'verification.check.started',
  'verification.check.completed',
  'verification.failed',
  'verification.completed',
  'diff.captured',
  'review_packet.generated',
  'github.issue.ingested',
  'github.branch.prepared',
  'github.pr.draft_requested',
  'github.pr.draft_created',
  'github.pr.comment.published',
  'github.iteration.requested',
  'github.sync.failed',
  'run.completed',
  'run.failed',
] as const;
export const commandProvenanceValues = ['observed', 'parsed', 'self_reported'] as const;
export const captureCompletenessValues = ['complete', 'partial', 'unknown'] as const;
export const changedFileStatusValues = ['added', 'modified', 'deleted'] as const;
export const verificationStatusValues = ['not_run', 'partial', 'passed', 'failed'] as const;
export const verificationCheckStatusValues = ['passed', 'failed', 'skipped'] as const;
export const verificationCommandPhaseValues = ['preflight', 'postrun', 'optional'] as const;
export const verificationEvidenceKindValues = [
  'artifact',
  'event',
  'command',
  'packet_field',
  'run_field',
  'note',
] as const;
export const claimCheckStatusValues = ['passed', 'failed'] as const;
export const claimCategoryValues = [
  'files_changed',
  'checks_executed',
  'approvals',
  'policy',
  'commands_executed',
  'verification_status',
  'unsupported_claim',
] as const;
export const reviewPacketStatusValues = ['ready', 'verification_failed'] as const;
export const reviewPacketApprovalStatusValues = [
  'not_required',
  'pending',
  ...approvalResolutionValues,
] as const;
export const policyAuditStatusValues = ['clean', 'scope_drift', 'policy_breach'] as const;
export const runSessionTriggerValues = ['run', 'resume'] as const;
export const runSessionStatusValues = ['active', 'completed', 'interrupted', 'failed'] as const;
export const pendingActionKindValues = [
  'approval',
  'resume',
  'verification',
  'rerun_stage',
  'continuity_review',
] as const;
export const pendingActionStatusValues = ['open', 'resolved', 'superseded'] as const;
export const resumeEligibilityStatusValues = ['eligible', 'ineligible'] as const;
export const workspaceCompatibilityValues = ['compatible', 'warning', 'incompatible'] as const;
export const approvalStateValues = [
  'not_required',
  'pending',
  ...approvalResolutionValues,
] as const;
export const verificationContinuationValues = [
  'not_needed',
  'resume_verification',
  'rerun_verification',
] as const;
export const approvalContinuationValues = [
  'not_needed',
  'reuse_existing',
  'resolve_pending',
  're_evaluate',
] as const;

export const TaskClassSchema = z.enum(taskClassValues);
export const RiskLevelSchema = z.enum(riskLevelValues);
export const TaskModeSchema = z.enum(taskModeValues);
export const TaskStatusSchema = z.enum(taskStatusValues);
export const RunStatusSchema = z.enum(runStatusValues);
export const RunStageSchema = z.enum(runStageValues);
export const CheckpointStageSchema = z.enum(checkpointStageValues);
export const RunnerSchema = z.enum(runnerValues);
export const SandboxModeSchema = z.enum(sandboxModeValues);
export const ApprovalPolicySchema = z.enum(approvalPolicyValues);
export const ApprovalModeSchema = z.enum(approvalModeValues);
export const SpecSourceSchema = z.enum(specSourceValues);
export const ActionKindSchema = z.enum(actionKindValues);
export const PolicyDecisionSchema = z.enum(policyDecisionValues);
export const ApprovalResolutionSchema = z.enum(approvalResolutionValues);
export const PreviewConfidenceSchema = z.enum(previewConfidenceValues);
export const ProposedPathKindSchema = z.enum(proposedPathKindValues);
export const ProposedCommandSourceSchema = z.enum(proposedCommandSourceValues);
export const PolicyMatchDimensionSchema = z.enum(policyMatchDimensionValues);
export const RunEventTypeSchema = z.enum(runEventTypeValues);
export const CommandProvenanceSchema = z.enum(commandProvenanceValues);
export const CaptureCompletenessSchema = z.enum(captureCompletenessValues);
export const ChangedFileStatusSchema = z.enum(changedFileStatusValues);
export const VerificationStatusSchema = z.enum(verificationStatusValues);
export const VerificationCheckStatusSchema = z.enum(verificationCheckStatusValues);
export const VerificationCommandPhaseSchema = z.enum(verificationCommandPhaseValues);
export const VerificationEvidenceKindSchema = z.enum(verificationEvidenceKindValues);
export const ClaimCheckStatusSchema = z.enum(claimCheckStatusValues);
export const ClaimCategorySchema = z.enum(claimCategoryValues);
export const ReviewPacketStatusSchema = z.enum(reviewPacketStatusValues);
export const ReviewPacketApprovalStatusSchema = z.enum(reviewPacketApprovalStatusValues);
export const PolicyAuditStatusSchema = z.enum(policyAuditStatusValues);
export const RunSessionTriggerSchema = z.enum(runSessionTriggerValues);
export const RunSessionStatusSchema = z.enum(runSessionStatusValues);
export const PendingActionKindSchema = z.enum(pendingActionKindValues);
export const PendingActionStatusSchema = z.enum(pendingActionStatusValues);
export const ResumeEligibilityStatusSchema = z.enum(resumeEligibilityStatusValues);
export const WorkspaceCompatibilitySchema = z.enum(workspaceCompatibilityValues);
export const ApprovalStateSchema = z.enum(approvalStateValues);
export const VerificationContinuationSchema = z.enum(verificationContinuationValues);
export const ApprovalContinuationSchema = z.enum(approvalContinuationValues);
export const GithubRepoRefSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  fullName: z.string(),
  url: z.string().optional(),
  defaultBranch: z.string().optional(),
});
export const GithubIssueRefSchema = z.object({
  repo: GithubRepoRefSchema,
  issueNumber: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()),
  url: z.string(),
  state: z.enum(['open', 'closed']),
});
export const GithubBranchRefSchema = z.object({
  repo: GithubRepoRefSchema,
  name: z.string(),
  ref: z.string(),
  sha: z.string().optional(),
  remoteName: z.string().optional(),
  url: z.string().optional(),
  existed: z.boolean().default(false),
});
export const GithubPullRequestRefSchema = z.object({
  repo: GithubRepoRefSchema,
  pullRequestNumber: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  state: z.enum(['open', 'closed']),
  isDraft: z.boolean(),
  baseBranch: z.string(),
  headBranch: z.string(),
});
export const GithubDraftPrRequestSchema = z.object({
  runId: z.string(),
  repo: GithubRepoRefSchema,
  baseBranch: z.string(),
  headBranch: z.string(),
  title: z.string(),
  body: z.string(),
  draft: z.literal(true),
  reviewPacketPath: z.string(),
  artifactPaths: z.array(z.string()),
  createdAt: z.string(),
});
export const GithubCommentRefSchema = z.object({
  repo: GithubRepoRefSchema,
  pullRequestNumber: z.number().int().positive(),
  commentId: z.number().int().positive(),
  url: z.string().optional(),
  author: z.string().optional(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});
export const GithubDraftPrResultSchema = z.object({
  runId: z.string(),
  request: GithubDraftPrRequestSchema,
  pullRequest: GithubPullRequestRefSchema,
  bodyUpdated: z.boolean(),
  supplementalComment: GithubCommentRefSchema.optional(),
  createdAt: z.string(),
});
export const GithubIterationRequestSchema = z.object({
  id: z.string(),
  runId: z.string(),
  pullRequest: GithubPullRequestRefSchema,
  sourceComment: GithubCommentRefSchema,
  command: z.string(),
  instruction: z.string(),
  normalizedInputPath: z.string().optional(),
  createdAt: z.string(),
});
export const RunGithubStateSchema = z.object({
  issue: GithubIssueRefSchema.optional(),
  branch: GithubBranchRefSchema.optional(),
  pullRequest: GithubPullRequestRefSchema.optional(),
  issueIngestionPath: z.string().optional(),
  branchPreparationPath: z.string().optional(),
  draftPrRequestPath: z.string().optional(),
  draftPrResultPath: z.string().optional(),
  publicationPath: z.string().optional(),
  commentSyncPath: z.string().optional(),
  iterationRequestPaths: z.array(z.string()),
  updatedAt: z.string(),
  lastSyncError: z.string().optional(),
});

export const ArtifactReferenceSchema = z.object({
  id: z.string(),
  runId: z.string(),
  kind: z.string(),
  path: z.string(),
  format: z.enum(['json', 'jsonl', 'markdown', 'text', 'patch']),
  createdAt: z.string(),
  summary: z.string().optional(),
});

export const PendingActionSchema = z.object({
  id: z.string(),
  kind: PendingActionKindSchema,
  status: PendingActionStatusSchema,
  title: z.string(),
  summary: z.string(),
  artifactPaths: z.array(z.string()),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
});

export const ResumeEligibilitySchema = z.object({
  status: ResumeEligibilityStatusSchema,
  eligible: z.boolean(),
  evaluatedAt: z.string(),
  summary: z.string(),
  reasons: z.array(z.string()),
  requiredArtifactPaths: z.array(z.string()),
  nextStage: RunStageSchema.optional(),
});

export const WorkspaceSnapshotSchema = z.object({
  capturedAt: z.string(),
  repoRoot: z.string(),
  workingDirectory: z.string(),
  gitAvailable: z.boolean(),
  gitHead: z.string().optional(),
  dirtyWorkingTree: z.boolean().nullable(),
  changedFiles: z.array(z.string()),
  expectedArtifactPaths: z.array(z.string()),
  knownRunChangedFiles: z.array(z.string()),
});

export const ContinuityAssessmentSchema = z.object({
  id: z.string(),
  runId: z.string(),
  evaluatedAt: z.string(),
  status: WorkspaceCompatibilitySchema,
  summary: z.string(),
  reasons: z.array(z.string()),
  missingArtifactPaths: z.array(z.string()),
  changedKnownRunFiles: z.array(z.string()),
  storedSnapshot: WorkspaceSnapshotSchema,
  currentSnapshot: WorkspaceSnapshotSchema,
});

export const ResumePlanSchema = z.object({
  id: z.string(),
  runId: z.string(),
  createdAt: z.string(),
  sourceCheckpointId: z.string().optional(),
  fromStatus: RunStatusSchema,
  lastSuccessfulStage: RunStageSchema.optional(),
  nextStage: RunStageSchema,
  rerunStages: z.array(RunStageSchema),
  actions: z.array(z.string()),
  approvalStrategy: ApprovalContinuationSchema,
  verificationStrategy: VerificationContinuationSchema,
  summary: z.string(),
});

export const ContinuationContextSchema = z.object({
  runId: z.string(),
  repoRoot: z.string(),
  runDirectory: z.string(),
  sessionManifestPath: z.string(),
  progressPath: z.string().optional(),
  lastCheckpointPath: z.string().optional(),
  lastCheckpointId: z.string().optional(),
  pendingStage: RunStageSchema.optional(),
  requiredArtifactPaths: z.array(z.string()),
});

export const RunCheckpointSchema = z.object({
  id: z.string(),
  runId: z.string(),
  sessionId: z.string(),
  stage: CheckpointStageSchema,
  createdAt: z.string(),
  status: RunStatusSchema,
  summary: z.string(),
  requiredArtifactPaths: z.array(z.string()),
  outputArtifactPaths: z.array(z.string()),
  restartable: z.boolean(),
  rerunStageOnResume: z.boolean(),
  resumeInstructions: z.array(z.string()),
  lastSuccessfulStep: z.string(),
  pendingStep: z.string(),
});

export const RunProgressSnapshotSchema = z.object({
  id: z.string(),
  runId: z.string(),
  sessionId: z.string(),
  stage: RunStageSchema,
  status: RunStatusSchema,
  createdAt: z.string(),
  summary: z.string(),
  justCompleted: z.string(),
  remaining: z.array(z.string()),
  blockers: z.array(z.string()),
  currentRisks: z.array(z.string()),
  approvedScope: z.array(z.string()),
  verificationState: z.string(),
  artifactPaths: z.array(z.string()),
  nextRecommendedStep: z.string(),
});

export const RunSessionSchema = z.object({
  id: z.string(),
  runId: z.string(),
  trigger: RunSessionTriggerSchema,
  status: RunSessionStatusSchema,
  startedAt: z.string(),
  updatedAt: z.string(),
  endedAt: z.string().optional(),
  startedFromCheckpointId: z.string().optional(),
  startStage: RunStageSchema,
  currentStage: RunStageSchema,
  summary: z.string(),
  lastProgressSnapshotId: z.string().optional(),
  interruptionReason: z.string().optional(),
  outputArtifactPaths: z.array(z.string()),
});

export const SessionManifestSchema = z.object({
  runId: z.string(),
  currentSessionId: z.string(),
  sessionIds: z.array(z.string()),
  status: RunStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  currentStage: RunStageSchema,
  lastSuccessfulStage: RunStageSchema.optional(),
  lastSuccessfulStep: z.string().optional(),
  pendingStage: RunStageSchema.optional(),
  pendingStep: z.string().optional(),
  policyDecision: z
    .object({
      decision: PolicyDecisionSchema.optional(),
      summary: z.string(),
      artifactPath: z.string().optional(),
      requiredApprovalMode: ApprovalModeSchema.nullable().optional(),
    })
    .optional(),
  approvalState: z.object({
    required: z.boolean(),
    status: ApprovalStateSchema,
    approvalPacketId: z.string().optional(),
    artifactPaths: z.array(z.string()),
  }),
  verificationState: z.object({
    status: VerificationStatusSchema,
    summary: z.string(),
    resultPath: z.string().optional(),
    lastVerifiedAt: z.string().optional(),
  }),
  workspace: z.object({
    repoRoot: z.string(),
    runDirectory: z.string(),
    lastSnapshot: WorkspaceSnapshotSchema.optional(),
  }),
  github: RunGithubStateSchema.optional(),
  artifactPaths: z.record(z.string(), z.string()),
  lastCheckpointId: z.string().optional(),
  lastProgressSnapshotId: z.string().optional(),
  resumeEligibility: ResumeEligibilitySchema,
  pendingActions: z.array(PendingActionSchema),
  continuationContext: ContinuationContextSchema.optional(),
  latestContinuityAssessmentPath: z.string().optional(),
  latestResumePlanPath: z.string().optional(),
  interruption: z
    .object({
      detectedAt: z.string(),
      reason: z.string(),
      summary: z.string(),
    })
    .optional(),
  summary: z.string(),
});

export const SpecSchema = z.object({
  id: z.string(),
  source: SpecSourceSchema,
  sourcePath: z.string(),
  repoRoot: z.string(),
  title: z.string(),
  summary: z.string(),
  objective: z.string(),
  taskClass: TaskClassSchema,
  constraints: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  riskHints: z.array(z.string()),
  body: z.string(),
  githubIssue: GithubIssueRefSchema.optional(),
  normalizationNotes: z.array(z.string()),
  inferredFields: z.array(z.string()),
  createdAt: z.string(),
});

export const TaskUnitSchema = z.object({
  id: z.string(),
  planId: z.string(),
  order: z.number().int().nonnegative(),
  title: z.string(),
  description: z.string(),
  dependsOn: z.array(z.string()),
  riskLevel: RiskLevelSchema,
  suggestedMode: TaskModeSchema,
  status: TaskStatusSchema,
});

export const PlanSchema = z.object({
  id: z.string(),
  specId: z.string(),
  summary: z.string(),
  taskUnits: z.array(TaskUnitSchema),
  doneConditions: z.array(z.string()),
  assumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  generatedAt: z.string(),
});

export const RunSchema = z.object({
  id: z.string(),
  specId: z.string(),
  planId: z.string(),
  status: RunStatusSchema,
  currentStage: RunStageSchema,
  lastSuccessfulStage: RunStageSchema.optional(),
  pendingStage: RunStageSchema.optional(),
  verificationStatus: VerificationStatusSchema,
  verificationResultPath: z.string().optional(),
  lastVerifiedAt: z.string().optional(),
  currentSessionId: z.string().optional(),
  sessionManifestPath: z.string().optional(),
  lastCheckpointId: z.string().optional(),
  lastProgressSnapshotId: z.string().optional(),
  resumeEligibilityStatus: ResumeEligibilityStatusSchema.optional(),
  resumeEligibilitySummary: z.string().optional(),
  interruptionReason: z.string().optional(),
  runner: RunnerSchema,
  model: z.string(),
  sandboxMode: SandboxModeSchema,
  approvalPolicy: ApprovalPolicySchema,
  approvalMode: ApprovalModeSchema,
  networkAccess: z.boolean(),
  policyPackName: z.string(),
  policyPackVersion: z.number().int().positive(),
  policyPackPath: z.string(),
  repoRoot: z.string(),
  runDirectory: z.string(),
  sourceSpecPath: z.string(),
  github: RunGithubStateSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  summary: z.string().optional(),
});

export const RunEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  timestamp: z.string(),
  type: RunEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
});

export const ExecutedCommandSchema = z.object({
  command: z.string(),
  provenance: CommandProvenanceSchema,
  isPartial: z.boolean(),
  notes: z.string().optional(),
});

export const CommandCaptureSchema = z.object({
  source: z.string(),
  completeness: CaptureCompletenessSchema,
  notes: z.array(z.string()),
  commands: z.array(ExecutedCommandSchema),
});

export const ChangedFileRecordSchema = z.object({
  path: z.string(),
  status: ChangedFileStatusSchema,
  beforeHash: z.string().nullable(),
  afterHash: z.string().nullable(),
});

export const ChangedFileCaptureSchema = z.object({
  source: z.enum(['workspace_snapshot', 'git_diff']),
  notes: z.array(z.string()),
  files: z.array(ChangedFileRecordSchema),
});

export const VerificationEvidenceSchema = z.object({
  kind: VerificationEvidenceKindSchema,
  label: z.string(),
  path: z.string().optional(),
  value: z.string().optional(),
});

export const VerificationCommandResultSchema = z.object({
  id: z.string(),
  command: z.string(),
  phase: VerificationCommandPhaseSchema,
  mandatory: z.boolean(),
  status: VerificationCheckStatusSchema,
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
  summary: z.string(),
  stdoutArtifactPath: z.string().optional(),
  stderrArtifactPath: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string(),
  evidence: z.array(VerificationEvidenceSchema),
});

export const VerificationCheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  mandatory: z.boolean(),
  status: VerificationCheckStatusSchema,
  summary: z.string(),
  details: z.array(z.string()),
  evidence: z.array(VerificationEvidenceSchema),
  startedAt: z.string(),
  completedAt: z.string(),
});

export const ClaimCheckResultSchema = z.object({
  id: z.string(),
  category: ClaimCategorySchema,
  claim: z.string(),
  status: ClaimCheckStatusSchema,
  reason: z.string(),
  field: z.string().optional(),
  evidence: z.array(VerificationEvidenceSchema),
});

export const ClaimVerificationSummarySchema = z.object({
  status: z.enum(['passed', 'failed']),
  summary: z.string(),
  totalClaims: z.number().int().nonnegative(),
  passedClaims: z.number().int().nonnegative(),
  failedClaims: z.number().int().nonnegative(),
  results: z.array(ClaimCheckResultSchema),
});

export const PacketCompletenessResultSchema = z.object({
  status: z.enum(['passed', 'failed']),
  summary: z.string(),
  requiredSections: z.array(z.string()),
  missingSections: z.array(z.string()),
  incompleteSections: z.array(z.string()),
});

export const RunCompletionDecisionSchema = z.object({
  finalStatus: z.enum(['completed', 'failed']),
  canComplete: z.boolean(),
  summary: z.string(),
  blockingCheckIds: z.array(z.string()),
  blockingReasons: z.array(z.string()),
});

export const VerificationResultSchema = z.object({
  id: z.string(),
  runId: z.string(),
  status: VerificationStatusSchema,
  summary: z.string(),
  commands: z.array(VerificationCommandResultSchema),
  checks: z.array(VerificationCheckSchema),
  claimVerification: ClaimVerificationSummarySchema,
  packetCompleteness: PacketCompletenessResultSchema,
  completionDecision: RunCompletionDecisionSchema,
  resumable: z.boolean().default(false),
  resumeSummary: z.string().optional(),
  createdAt: z.string(),
});

export const PolicyRuleMatchSchema = z.object({
  taskClasses: z.array(TaskClassSchema).optional(),
  pathGlobs: z.array(z.string()).optional(),
  actionKinds: z.array(ActionKindSchema).optional(),
  commandPrefixes: z.array(z.string()).optional(),
  commandPatterns: z.array(z.string()).optional(),
  riskHints: z.array(z.string()).optional(),
});

export const PolicyRuleSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  match: PolicyRuleMatchSchema,
  decision: PolicyDecisionSchema,
  reason: z.string().optional(),
});

export const PolicyPackSchema = z.object({
  version: z.number().int().positive(),
  name: z.string(),
  description: z.string().optional(),
  defaults: z.object({
    sandboxMode: SandboxModeSchema,
    networkAccess: z.boolean(),
    approvalPolicy: ApprovalPolicySchema,
    fallbackDecision: PolicyDecisionSchema,
  }),
  rules: z.array(PolicyRuleSchema),
});

export const PolicyDecisionReasonSchema = z.object({
  ruleId: z.string().nullable(),
  decision: PolicyDecisionSchema,
  summary: z.string(),
  matchedOn: z.array(PolicyMatchDimensionSchema),
  specificity: z.number().int().nonnegative(),
});

export const MatchedPolicyRuleSchema = z.object({
  ruleId: z.string(),
  decision: PolicyDecisionSchema,
  reason: z.string().optional(),
  matchedOn: z.array(PolicyMatchDimensionSchema),
  specificity: z.number().int().nonnegative(),
});

export const ProposedFileChangeSchema = z.object({
  path: z.string(),
  pathKind: ProposedPathKindSchema,
  actionKind: ActionKindSchema,
  confidence: PreviewConfidenceSchema,
  reason: z.string().optional(),
});

export const ProposedCommandSchema = z.object({
  command: z.string(),
  actionKind: ActionKindSchema,
  confidence: PreviewConfidenceSchema,
  source: ProposedCommandSourceSchema,
  reason: z.string().optional(),
});

export const ImpactPreviewSchema = z.object({
  id: z.string(),
  runId: z.string(),
  specId: z.string(),
  planId: z.string(),
  summary: z.string(),
  rationale: z.array(z.string()),
  requestedSandboxMode: SandboxModeSchema,
  requestedNetworkAccess: z.boolean(),
  taskClass: TaskClassSchema,
  riskHints: z.array(z.string()),
  actionKinds: z.array(ActionKindSchema),
  proposedFileChanges: z.array(ProposedFileChangeSchema),
  proposedCommands: z.array(ProposedCommandSchema),
  uncertaintyNotes: z.array(z.string()),
  createdAt: z.string(),
});

export const PolicyEvaluationSchema = z.object({
  policyPackName: z.string(),
  policyPackVersion: z.number().int().positive(),
  policyPackPath: z.string(),
  decision: PolicyDecisionSchema,
  matchedRules: z.array(MatchedPolicyRuleSchema),
  reasons: z.array(PolicyDecisionReasonSchema),
  affectedPaths: z.array(z.string()),
  matchedCommands: z.array(z.string()),
  actionKinds: z.array(ActionKindSchema),
  requiredApprovalMode: ApprovalModeSchema.nullable(),
  sandboxMode: SandboxModeSchema,
  approvalPolicy: ApprovalPolicySchema,
  networkAccess: z.boolean(),
  notes: z.array(z.string()),
  uncertaintyNotes: z.array(z.string()),
  createdAt: z.string(),
});

export const ApprovalPacketSchema = z.object({
  id: z.string(),
  runId: z.string(),
  specTitle: z.string(),
  decisionSummary: z.string(),
  policyDecision: PolicyDecisionSchema,
  whyApprovalIsRequired: z.array(z.string()),
  affectedPaths: z.array(z.string()),
  predictedCommands: z.array(z.string()),
  matchedRules: z.array(MatchedPolicyRuleSchema),
  riskSummary: z.array(z.string()),
  assumptions: z.array(z.string()),
  mitigationNotes: z.array(z.string()),
  artifactPaths: z.array(z.string()),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
  resolution: ApprovalResolutionSchema.optional(),
});

export const ApprovalResolutionRecordSchema = z.object({
  id: z.string(),
  runId: z.string(),
  approvalPacketId: z.string(),
  resolution: ApprovalResolutionSchema,
  actor: z.string(),
  notes: z.array(z.string()),
  createdAt: z.string(),
});

export const PolicyAuditResultSchema = z.object({
  id: z.string(),
  runId: z.string(),
  status: PolicyAuditStatusSchema,
  summary: z.string(),
  previewedPaths: z.array(z.string()),
  actualChangedPaths: z.array(z.string()),
  previewedCommands: z.array(z.string()),
  actualCommands: z.array(z.string()),
  unexpectedPaths: z.array(z.string()),
  unexpectedCommands: z.array(z.string()),
  promptPathsTouched: z.array(z.string()),
  forbiddenPathsTouched: z.array(z.string()),
  promptCommandsTouched: z.array(z.string()),
  forbiddenCommandsTouched: z.array(z.string()),
  notes: z.array(z.string()),
  createdAt: z.string(),
});

export const RunnerContextSchema = z.object({
  repoRoot: z.string(),
  runDirectory: z.string(),
  spec: SpecSchema,
  plan: PlanSchema,
  run: RunSchema,
  impactPreview: ImpactPreviewSchema,
  verificationRequirements: z.array(z.string()),
  priorArtifacts: z.array(ArtifactReferenceSchema),
  policyDecision: PolicyEvaluationSchema,
  approvalPacket: ApprovalPacketSchema.optional(),
});

export const RunnerResultSchema = z.object({
  status: z.enum(['completed', 'blocked', 'failed']),
  summary: z.string(),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  prompt: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  commandCapture: CommandCaptureSchema,
  reportedChangedFiles: z.array(z.string()),
  reportedChangedFilesCompleteness: CaptureCompletenessSchema,
  reportedChangedFilesNotes: z.array(z.string()),
  limitations: z.array(z.string()),
  artifactsProduced: z.array(ArtifactReferenceSchema),
  metadata: z.record(z.string(), z.unknown()),
});

export const ReviewPacketPolicySectionSchema = z.object({
  decision: PolicyDecisionSchema,
  summary: z.string(),
  auditStatus: PolicyAuditStatusSchema,
  auditSummary: z.string(),
  matchedRuleIds: z.array(z.string()),
});

export const ReviewPacketApprovalSectionSchema = z.object({
  required: z.boolean(),
  status: ReviewPacketApprovalStatusSchema,
  summary: z.string(),
  approvalPacketId: z.string().optional(),
});

export const ReviewPacketVerificationSummarySchema = z.object({
  status: VerificationStatusSchema,
  summary: z.string(),
  mandatoryFailures: z.array(z.string()),
  lastVerifiedAt: z.string().optional(),
});

export const ReviewPacketSchema = z.object({
  id: z.string(),
  runId: z.string(),
  title: z.string(),
  specTitle: z.string(),
  runStatus: RunStatusSchema,
  packetStatus: ReviewPacketStatusSchema,
  objective: z.string(),
  overview: z.string(),
  planSummary: z.string(),
  runnerReportedSummary: z.string(),
  filesChanged: z.array(z.string()),
  commandsExecuted: z.array(ExecutedCommandSchema),
  checksRun: z.array(VerificationCommandResultSchema),
  artifactPaths: z.array(z.string()),
  diffSummary: z.array(z.string()),
  policy: ReviewPacketPolicySectionSchema,
  approvals: ReviewPacketApprovalSectionSchema,
  risks: z.array(z.string()),
  limitations: z.array(z.string()),
  openQuestions: z.array(z.string()),
  verification: ReviewPacketVerificationSummarySchema,
  claimVerification: ClaimVerificationSummarySchema,
  rollbackHint: z.string(),
  github: z
    .object({
      issue: GithubIssueRefSchema.optional(),
      branch: GithubBranchRefSchema.optional(),
      pullRequest: GithubPullRequestRefSchema.optional(),
    })
    .optional(),
  createdAt: z.string(),
});

export const IssueIngestionResultSchema = z.object({
  issue: GithubIssueRefSchema,
  spec: SpecSchema,
  sourceSnapshotPath: z.string(),
  createdAt: z.string(),
  summary: z.string(),
});

export type TaskClass = z.infer<typeof TaskClassSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type TaskMode = z.infer<typeof TaskModeSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunStage = z.infer<typeof RunStageSchema>;
export type CheckpointStage = z.infer<typeof CheckpointStageSchema>;
export type RunnerKind = z.infer<typeof RunnerSchema>;
export type SandboxMode = z.infer<typeof SandboxModeSchema>;
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;
export type SpecSource = z.infer<typeof SpecSourceSchema>;
export type ActionKind = z.infer<typeof ActionKindSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type ApprovalResolution = z.infer<typeof ApprovalResolutionSchema>;
export type PreviewConfidence = z.infer<typeof PreviewConfidenceSchema>;
export type ProposedPathKind = z.infer<typeof ProposedPathKindSchema>;
export type ProposedCommandSource = z.infer<typeof ProposedCommandSourceSchema>;
export type PolicyMatchDimension = z.infer<typeof PolicyMatchDimensionSchema>;
export type RunEventType = z.infer<typeof RunEventTypeSchema>;
export type CommandProvenance = z.infer<typeof CommandProvenanceSchema>;
export type CaptureCompleteness = z.infer<typeof CaptureCompletenessSchema>;
export type ChangedFileStatus = z.infer<typeof ChangedFileStatusSchema>;
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;
export type VerificationCheckStatus = z.infer<typeof VerificationCheckStatusSchema>;
export type VerificationCommandPhase = z.infer<typeof VerificationCommandPhaseSchema>;
export type VerificationEvidenceKind = z.infer<typeof VerificationEvidenceKindSchema>;
export type ClaimCheckStatus = z.infer<typeof ClaimCheckStatusSchema>;
export type ClaimCategory = z.infer<typeof ClaimCategorySchema>;
export type ReviewPacketStatus = z.infer<typeof ReviewPacketStatusSchema>;
export type ReviewPacketApprovalStatus = z.infer<typeof ReviewPacketApprovalStatusSchema>;
export type PolicyAuditStatus = z.infer<typeof PolicyAuditStatusSchema>;
export type RunSessionTrigger = z.infer<typeof RunSessionTriggerSchema>;
export type RunSessionStatus = z.infer<typeof RunSessionStatusSchema>;
export type PendingActionKind = z.infer<typeof PendingActionKindSchema>;
export type PendingActionStatus = z.infer<typeof PendingActionStatusSchema>;
export type ResumeEligibilityStatus = z.infer<typeof ResumeEligibilityStatusSchema>;
export type WorkspaceCompatibility = z.infer<typeof WorkspaceCompatibilitySchema>;
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
export type VerificationContinuation = z.infer<typeof VerificationContinuationSchema>;
export type ApprovalContinuation = z.infer<typeof ApprovalContinuationSchema>;
export type GithubRepoRef = z.infer<typeof GithubRepoRefSchema>;
export type GithubIssueRef = z.infer<typeof GithubIssueRefSchema>;
export type GithubBranchRef = z.infer<typeof GithubBranchRefSchema>;
export type GithubPullRequestRef = z.infer<typeof GithubPullRequestRefSchema>;
export type GithubDraftPrRequest = z.infer<typeof GithubDraftPrRequestSchema>;
export type GithubCommentRef = z.infer<typeof GithubCommentRefSchema>;
export type GithubDraftPrResult = z.infer<typeof GithubDraftPrResultSchema>;
export type GithubIterationRequest = z.infer<typeof GithubIterationRequestSchema>;
export type RunGithubState = z.infer<typeof RunGithubStateSchema>;
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;
export type PendingAction = z.infer<typeof PendingActionSchema>;
export type ResumeEligibility = z.infer<typeof ResumeEligibilitySchema>;
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;
export type ContinuityAssessment = z.infer<typeof ContinuityAssessmentSchema>;
export type ResumePlan = z.infer<typeof ResumePlanSchema>;
export type ContinuationContext = z.infer<typeof ContinuationContextSchema>;
export type RunCheckpoint = z.infer<typeof RunCheckpointSchema>;
export type RunProgressSnapshot = z.infer<typeof RunProgressSnapshotSchema>;
export type RunSession = z.infer<typeof RunSessionSchema>;
export type SessionManifest = z.infer<typeof SessionManifestSchema>;
export type Spec = z.infer<typeof SpecSchema>;
export type TaskUnit = z.infer<typeof TaskUnitSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Run = z.infer<typeof RunSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
export type ExecutedCommand = z.infer<typeof ExecutedCommandSchema>;
export type CommandCapture = z.infer<typeof CommandCaptureSchema>;
export type ChangedFileRecord = z.infer<typeof ChangedFileRecordSchema>;
export type ChangedFileCapture = z.infer<typeof ChangedFileCaptureSchema>;
export type VerificationEvidence = z.infer<typeof VerificationEvidenceSchema>;
export type VerificationCommandResult = z.infer<typeof VerificationCommandResultSchema>;
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;
export type ClaimCheckResult = z.infer<typeof ClaimCheckResultSchema>;
export type ClaimVerificationSummary = z.infer<typeof ClaimVerificationSummarySchema>;
export type PacketCompletenessResult = z.infer<typeof PacketCompletenessResultSchema>;
export type RunCompletionDecision = z.infer<typeof RunCompletionDecisionSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type PolicyRuleMatch = z.infer<typeof PolicyRuleMatchSchema>;
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export type PolicyPack = z.infer<typeof PolicyPackSchema>;
export type PolicyDecisionReason = z.infer<typeof PolicyDecisionReasonSchema>;
export type MatchedPolicyRule = z.infer<typeof MatchedPolicyRuleSchema>;
export type ProposedFileChange = z.infer<typeof ProposedFileChangeSchema>;
export type ProposedCommand = z.infer<typeof ProposedCommandSchema>;
export type ImpactPreview = z.infer<typeof ImpactPreviewSchema>;
export type PolicyEvaluation = z.infer<typeof PolicyEvaluationSchema>;
export type ApprovalPacket = z.infer<typeof ApprovalPacketSchema>;
export type ApprovalResolutionRecord = z.infer<typeof ApprovalResolutionRecordSchema>;
export type PolicyAuditResult = z.infer<typeof PolicyAuditResultSchema>;
export type RunnerContext = z.infer<typeof RunnerContextSchema>;
export type RunnerResult = z.infer<typeof RunnerResultSchema>;
export type ReviewPacketPolicySection = z.infer<typeof ReviewPacketPolicySectionSchema>;
export type ReviewPacketApprovalSection = z.infer<typeof ReviewPacketApprovalSectionSchema>;
export type ReviewPacketVerificationSummary = z.infer<typeof ReviewPacketVerificationSummarySchema>;
export type ReviewPacket = z.infer<typeof ReviewPacketSchema>;
export type IssueIngestionResult = z.infer<typeof IssueIngestionResultSchema>;

export interface NormalizeMarkdownSpecInput {
  content: string;
  repoRoot: string;
  sourcePath: string;
  createdAt?: string;
}

export interface NormalizeGithubIssueSpecInput {
  issue: GithubIssueRef;
  repoRoot: string;
  sourcePath: string;
  createdAt?: string;
}

export interface CreateRunInput {
  runId?: string;
  spec: Spec;
  plan: Plan;
  runner: RunnerKind;
  model: string;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  approvalMode: ApprovalMode;
  networkAccess: boolean;
  policyPackName: string;
  policyPackVersion: number;
  policyPackPath: string;
  repoRoot: string;
  runDirectory: string;
  github?: RunGithubState;
  createdAt?: string;
}

export interface CreateRunSessionInput {
  runId: string;
  trigger: RunSessionTrigger;
  startStage: RunStage;
  startedFromCheckpointId?: string;
  startedAt?: string;
  summary: string;
}

export interface CreateRunCheckpointInput {
  runId: string;
  sessionId: string;
  stage: CheckpointStage;
  status: RunStatus;
  requiredArtifactPaths: string[];
  outputArtifactPaths: string[];
  restartable: boolean;
  rerunStageOnResume: boolean;
  resumeInstructions: string[];
  lastSuccessfulStep: string;
  pendingStep: string;
  createdAt?: string;
  summary: string;
}

export interface CreateRunProgressSnapshotInput {
  runId: string;
  sessionId: string;
  stage: RunStage;
  status: RunStatus;
  justCompleted: string;
  remaining: string[];
  blockers?: string[];
  currentRisks?: string[];
  approvedScope?: string[];
  verificationState: string;
  artifactPaths: string[];
  nextRecommendedStep: string;
  createdAt?: string;
  summary: string;
}

interface ParsedFrontmatter {
  body: string;
  data: Record<string, string | string[]>;
}

function createContentHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function createRunScopedId(prefix: string, seed: string): string {
  return `${prefix}-${createContentHash(seed).slice(0, 12)}`;
}

function createSectionMap(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = markdown.split(/\r?\n/);
  let currentHeading = '';
  let currentLines: string[] = [];

  const flush = (): void => {
    if (!currentHeading) {
      return;
    }

    sections.set(currentHeading, currentLines.join('\n').trim());
  };

  for (const line of lines) {
    const headingMatch = /^##\s+(.+)$/.exec(line.trim());

    if (headingMatch) {
      const heading = headingMatch[1];

      if (!heading) {
        continue;
      }

      flush();
      currentHeading = normalizeKey(heading);
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  flush();
  return sections;
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseInlineArray(value: string): string[] {
  return value
    .slice(1, -1)
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function parseFrontmatter(markdown: string): ParsedFrontmatter {
  if (!markdown.startsWith('---\n')) {
    return { body: markdown, data: {} };
  }

  const lines = markdown.split(/\r?\n/);
  let closingIndex = -1;

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex === -1) {
    return { body: markdown, data: {} };
  }

  const data: Record<string, string | string[]> = {};
  const frontmatterLines = lines.slice(1, closingIndex);

  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const line = frontmatterLines[index]?.trim();

    if (!line) {
      continue;
    }

    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);

    if (!match) {
      continue;
    }

    const rawKey = match[1];
    const rawValue = match[2];

    if (!rawKey || rawValue === undefined) {
      continue;
    }

    const key = normalizeKey(rawKey);
    const value = rawValue.trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = parseInlineArray(value);
      continue;
    }

    if (value) {
      data[key] = value.replace(/^['"]|['"]$/g, '');
      continue;
    }

    const items: string[] = [];
    let nextIndex = index + 1;

    while (nextIndex < frontmatterLines.length) {
      const candidate = frontmatterLines[nextIndex];

      if (!candidate?.trim()) {
        nextIndex += 1;
        continue;
      }

      if (/^[A-Za-z0-9_-]+:\s*/.test(candidate)) {
        break;
      }

      const itemMatch = /^\s*-\s+(.*)$/.exec(candidate);

      if (!itemMatch) {
        break;
      }

      const itemValue = itemMatch[1];

      if (!itemValue) {
        break;
      }

      items.push(itemValue.trim());
      nextIndex += 1;
    }

    if (items.length > 0) {
      data[key] = items;
      index = nextIndex - 1;
    }
  }

  return {
    body: lines
      .slice(closingIndex + 1)
      .join('\n')
      .trim(),
    data,
  };
}

function firstHeading(markdown: string): string | undefined {
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^#\s+(.+)$/.exec(line.trim());

    if (match) {
      const heading = match[1];

      if (heading) {
        return heading.trim();
      }
    }
  }

  return undefined;
}

function firstParagraph(markdown: string): string | undefined {
  const paragraphs = markdown
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !paragraph.startsWith('#') && !paragraph.startsWith('- '));

  return paragraphs[0];
}

function toStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^[-*]\s+/, ''))
      .filter(Boolean);
  }

  return [];
}

function extractList(section: string | undefined): string[] {
  if (!section) {
    return [];
  }

  const bulletItems = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);

  if (bulletItems.length > 0) {
    return bulletItems;
  }

  return section
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function inferTaskClass(text: string): TaskClass {
  const normalized = text.toLowerCase();

  if (/\b(doc|docs|documentation|readme|guide|markdown)\b/.test(normalized)) {
    return 'docs';
  }

  if (/\b(test|tests|vitest|playwright|coverage)\b/.test(normalized)) {
    return 'tests';
  }

  if (/\b(ci|workflow|github actions|pipeline)\b/.test(normalized)) {
    return 'ci';
  }

  if (/\b(refactor|rename|cleanup|restructure)\b/.test(normalized)) {
    return 'refactor';
  }

  if (/\b(release|changelog|release notes)\b/.test(normalized)) {
    return 'release_notes';
  }

  if (/\b(triage|label|issue hygiene)\b/.test(normalized)) {
    return 'triage';
  }

  return 'other';
}

function inferRiskHints(text: string): string[] {
  const hints = new Set<string>();
  const normalized = text.toLowerCase();

  if (/\bauth|permission|billing|migration|secret|credential\b/.test(normalized)) {
    hints.add('Touches a protected area and should stay out of scope for Phase 1.');
  }

  if (/\bnetwork|internet|fetch|external\b/.test(normalized)) {
    hints.add('May imply network access, which is disabled by default.');
  }

  return [...hints];
}

function inferRiskLevel(taskClass: TaskClass, riskHints: string[]): RiskLevel {
  if (riskHints.length > 0 || taskClass === 'other') {
    return 'medium';
  }

  return 'low';
}

function inferTaskClassFromLabels(labels: string[]): TaskClass | undefined {
  for (const label of labels) {
    const normalized = normalizeKey(label);

    if (normalized === 'documentation' || normalized === 'docs') {
      return 'docs';
    }

    if (normalized === 'test' || normalized === 'tests') {
      return 'tests';
    }

    if (normalized === 'ci' || normalized === 'github_actions' || normalized === 'workflow') {
      return 'ci';
    }

    if (normalized === 'refactor') {
      return 'refactor';
    }

    if (normalized === 'release_notes' || normalized === 'release') {
      return 'release_notes';
    }

    if (normalized === 'triage') {
      return 'triage';
    }
  }

  return undefined;
}

function pickFirstString(
  notes: string[],
  inferredFields: string[],
  field: string,
  candidates: Array<string | undefined>,
): string {
  for (const candidate of candidates) {
    if (candidate?.trim()) {
      return candidate.trim();
    }
  }

  inferredFields.push(field);
  notes.push(`${field} was inferred from the available markdown content.`);
  return '';
}

export function normalizeMarkdownSpec(input: NormalizeMarkdownSpecInput): Spec {
  const timestamp = input.createdAt ?? new Date().toISOString();
  const { body, data } = parseFrontmatter(input.content);
  const sections = createSectionMap(body);
  const notes: string[] = [];
  const inferredFields: string[] = [];
  const fileStem = basename(input.sourcePath).replace(/\.[^.]+$/, '');

  const title =
    pickFirstString(notes, inferredFields, 'title', [
      typeof data.title === 'string' ? data.title : undefined,
      firstHeading(body),
      fileStem,
    ]) || fileStem;
  const objective =
    pickFirstString(notes, inferredFields, 'objective', [
      typeof data.objective === 'string' ? data.objective : undefined,
      sections.get('objective'),
      typeof data.summary === 'string' ? data.summary : undefined,
      firstParagraph(body),
      title,
    ]) || title;
  const summary =
    pickFirstString(notes, inferredFields, 'summary', [
      typeof data.summary === 'string' ? data.summary : undefined,
      sections.get('summary'),
      firstParagraph(body),
      objective,
    ]) || objective;
  const constraints =
    toStringArray(data.constraints)
      .concat(extractList(sections.get('constraints')))
      .filter(Boolean) || [];
  const acceptanceCriteria =
    toStringArray(data.acceptance_criteria ?? data.acceptancecriteria)
      .concat(extractList(sections.get('acceptance_criteria')))
      .concat(extractList(sections.get('acceptance_criteria_and_done_conditions')))
      .filter(Boolean) || [];
  const riskHints =
    toStringArray(data.risk_hints ?? data.riskhints)
      .concat(extractList(sections.get('risk_hints')))
      .filter(Boolean) || [];
  const taskClassInput =
    (typeof data.task_type === 'string' ? data.task_type : undefined) ??
    (typeof data.taskclass === 'string' ? data.taskclass : undefined) ??
    sections.get('task_type') ??
    sections.get('task_class');
  const taskClass = TaskClassSchema.safeParse(normalizeKey(taskClassInput ?? '')).success
    ? (normalizeKey(taskClassInput ?? '') as TaskClass)
    : inferTaskClass([title, summary, objective, body].join('\n'));

  if (!taskClassInput) {
    inferredFields.push('taskClass');
    notes.push('taskClass was inferred from the markdown content.');
  }

  const combinedRiskHints = [...new Set([...riskHints, ...inferRiskHints(body)])];

  if (constraints.length === 0) {
    notes.push('constraints were not specified explicitly.');
  }

  if (acceptanceCriteria.length === 0) {
    notes.push('acceptanceCriteria were not specified explicitly.');
  }

  const spec: Spec = {
    id:
      typeof data.id === 'string' && data.id.trim()
        ? data.id.trim()
        : createRunScopedId('spec', `${input.sourcePath}:${input.content}`),
    source: 'markdown',
    sourcePath: input.sourcePath,
    repoRoot: input.repoRoot,
    title,
    summary,
    objective,
    taskClass,
    constraints,
    acceptanceCriteria,
    riskHints: combinedRiskHints,
    body,
    normalizationNotes: notes,
    inferredFields,
    createdAt: timestamp,
  };

  return SpecSchema.parse(spec);
}

export function normalizeGithubIssueSpec(input: NormalizeGithubIssueSpecInput): Spec {
  const timestamp = input.createdAt ?? new Date().toISOString();
  const body = input.issue.body?.trim() || input.issue.title;
  const sections = createSectionMap(body);
  const notes: string[] = [
    `Normalized from GitHub issue ${input.issue.repo.fullName}#${input.issue.issueNumber}.`,
  ];
  const inferredFields: string[] = [];
  const labels = input.issue.labels;
  const labelTaskClass = inferTaskClassFromLabels(labels);
  const title =
    input.issue.title.trim() || `${input.issue.repo.fullName}#${input.issue.issueNumber}`;
  const summary =
    pickFirstString(notes, inferredFields, 'summary', [
      sections.get('summary'),
      firstParagraph(body),
      title,
    ]) || title;
  const objective =
    pickFirstString(notes, inferredFields, 'objective', [
      sections.get('objective'),
      summary,
      title,
    ]) || title;
  const constraints = extractList(sections.get('constraints'));
  const acceptanceCriteria = extractList(sections.get('acceptance_criteria')).concat(
    extractList(sections.get('acceptance_criteria_and_done_conditions')),
  );
  const explicitRiskHints = extractList(sections.get('risk_hints'));
  const inferredRiskHints = inferRiskHints([title, body, ...labels].join('\n'));
  const riskHints = [...new Set([...explicitRiskHints, ...inferredRiskHints])];
  const taskClass =
    labelTaskClass ?? inferTaskClass([title, summary, objective, body, ...labels].join('\n'));

  if (!labelTaskClass) {
    inferredFields.push('taskClass');
    notes.push('taskClass was inferred from the issue title, body, and labels.');
  } else {
    notes.push(`taskClass was derived from the issue labels: ${labels.join(', ')}.`);
  }

  if (constraints.length === 0) {
    notes.push('constraints were not specified explicitly in the issue body.');
  }

  if (acceptanceCriteria.length === 0) {
    notes.push('acceptanceCriteria were not specified explicitly in the issue body.');
  }

  return SpecSchema.parse({
    id: createRunScopedId(
      'spec',
      `${input.issue.repo.fullName}#${input.issue.issueNumber}:${input.issue.title}:${body}`,
    ),
    source: 'github_issue',
    sourcePath: input.sourcePath,
    repoRoot: input.repoRoot,
    title,
    summary,
    objective,
    taskClass,
    constraints,
    acceptanceCriteria,
    riskHints,
    body,
    githubIssue: input.issue,
    normalizationNotes: notes,
    inferredFields,
    createdAt: timestamp,
  });
}

export function createPlanFromSpec(spec: Spec, generatedAt = new Date().toISOString()): Plan {
  const planId = createRunScopedId('plan', spec.id);
  const riskLevel = inferRiskLevel(spec.taskClass, spec.riskHints);
  const assumptions = [
    'The task stays within the current governed-run phase boundaries and avoids protected zones unless explicitly approved.',
    'The runner should prefer minimal diffs and artifact-backed evidence over broad claims.',
    'Network access remains disabled unless a future phase explicitly enables it.',
  ];
  const openQuestions =
    spec.acceptanceCriteria.length > 0
      ? []
      : [
          'Acceptance criteria were not explicit in the source spec and may need human clarification.',
        ];
  const doneConditions =
    spec.acceptanceCriteria.length > 0
      ? spec.acceptanceCriteria
      : [`Address the objective: ${spec.objective}`];
  const taskUnits: TaskUnit[] = [
    {
      id: `${planId}-task-1`,
      planId,
      order: 1,
      title: 'Inspect local repo context',
      description:
        'Read the relevant repository instructions, current files, and constraints needed to complete the task without leaving the current governed-run scope.',
      dependsOn: [],
      riskLevel: 'low',
      suggestedMode: 'read_only',
      status: 'pending',
    },
    {
      id: `${planId}-task-2`,
      planId,
      order: 2,
      title: 'Apply the requested low-risk change',
      description: spec.objective,
      dependsOn: [`${planId}-task-1`],
      riskLevel,
      suggestedMode: 'workspace_write',
      status: 'pending',
    },
    {
      id: `${planId}-task-3`,
      planId,
      order: 3,
      title: 'Capture run evidence and summarize outcomes',
      description:
        'Run deterministic verification, then leave an evidence-based summary of what changed, what checks ran, and what remains unresolved.',
      dependsOn: [`${planId}-task-2`],
      riskLevel: 'low',
      suggestedMode: 'read_only',
      status: 'pending',
    },
  ];

  return PlanSchema.parse({
    id: planId,
    specId: spec.id,
    summary: `Execute the "${spec.title}" request as a bounded ${spec.taskClass} run, then capture verification evidence and an evidence-based review packet.`,
    taskUnits,
    doneConditions,
    assumptions,
    openQuestions,
    generatedAt,
  });
}

export function createRunRecord(input: CreateRunInput): Run {
  const timestamp = input.createdAt ?? new Date().toISOString();

  return RunSchema.parse({
    id:
      input.runId ??
      createRunScopedId(
        'run',
        `${input.spec.id}:${input.runner}:${timestamp}:${input.spec.sourcePath}`,
      ),
    specId: input.spec.id,
    planId: input.plan.id,
    status: 'created',
    currentStage: 'created',
    verificationStatus: 'not_run',
    runner: input.runner,
    model: input.model,
    sandboxMode: input.sandboxMode,
    approvalPolicy: input.approvalPolicy,
    approvalMode: input.approvalMode,
    networkAccess: input.networkAccess,
    policyPackName: input.policyPackName,
    policyPackVersion: input.policyPackVersion,
    policyPackPath: input.policyPackPath,
    repoRoot: input.repoRoot,
    runDirectory: input.runDirectory,
    sourceSpecPath: input.spec.sourcePath,
    github:
      input.github ??
      (input.spec.githubIssue
        ? {
            issue: input.spec.githubIssue,
            iterationRequestPaths: [],
            updatedAt: timestamp,
          }
        : undefined),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function updateRunStatus(
  run: Run,
  status: RunStatus,
  summary?: string,
  updatedAt = new Date().toISOString(),
): Run {
  return RunSchema.parse({
    ...run,
    status,
    summary: summary ?? run.summary,
    updatedAt,
  });
}

export function updateRunStage(
  run: Run,
  input: {
    currentStage: RunStage;
    lastSuccessfulStage?: RunStage;
    pendingStage?: RunStage;
    lastCheckpointId?: string;
    lastProgressSnapshotId?: string;
    sessionId?: string;
    summary?: string;
    interruptionReason?: string;
  },
  updatedAt = new Date().toISOString(),
): Run {
  return RunSchema.parse({
    ...run,
    currentStage: input.currentStage,
    lastSuccessfulStage: input.lastSuccessfulStage ?? run.lastSuccessfulStage,
    pendingStage: input.pendingStage,
    lastCheckpointId: input.lastCheckpointId ?? run.lastCheckpointId,
    lastProgressSnapshotId: input.lastProgressSnapshotId ?? run.lastProgressSnapshotId,
    currentSessionId: input.sessionId ?? run.currentSessionId,
    summary: input.summary ?? run.summary,
    interruptionReason: input.interruptionReason ?? run.interruptionReason,
    updatedAt,
  });
}

export function updateRunVerification(
  run: Run,
  input: {
    status: VerificationStatus;
    resultPath?: string;
    verifiedAt?: string;
    summary?: string;
  },
  updatedAt = new Date().toISOString(),
): Run {
  return RunSchema.parse({
    ...run,
    verificationStatus: input.status,
    verificationResultPath: input.resultPath ?? run.verificationResultPath,
    lastVerifiedAt: input.verifiedAt ?? run.lastVerifiedAt,
    summary: input.summary ?? run.summary,
    updatedAt,
  });
}

export function updateRunResumeEligibility(
  run: Run,
  eligibility: ResumeEligibility,
  updatedAt = new Date().toISOString(),
): Run {
  return RunSchema.parse({
    ...run,
    resumeEligibilityStatus: eligibility.status,
    resumeEligibilitySummary: eligibility.summary,
    updatedAt,
  });
}

export function updateRunGithubState(
  run: Run,
  github: RunGithubState,
  updatedAt = new Date().toISOString(),
): Run {
  return RunSchema.parse({
    ...run,
    github,
    updatedAt,
  });
}

export function createRunSessionRecord(input: CreateRunSessionInput): RunSession {
  const timestamp = input.startedAt ?? new Date().toISOString();

  return RunSessionSchema.parse({
    id: createRunScopedId(
      'session',
      `${input.runId}:${input.trigger}:${input.startStage}:${input.startedFromCheckpointId ?? timestamp}:${timestamp}`,
    ),
    runId: input.runId,
    trigger: input.trigger,
    status: 'active',
    startedAt: timestamp,
    updatedAt: timestamp,
    startedFromCheckpointId: input.startedFromCheckpointId,
    startStage: input.startStage,
    currentStage: input.startStage,
    summary: input.summary,
    outputArtifactPaths: [],
  });
}

export function updateRunSessionRecord(
  session: RunSession,
  input: {
    status?: RunSessionStatus;
    currentStage?: RunStage;
    summary?: string;
    lastProgressSnapshotId?: string;
    interruptionReason?: string;
    outputArtifactPaths?: string[];
    endedAt?: string;
  },
  updatedAt = new Date().toISOString(),
): RunSession {
  return RunSessionSchema.parse({
    ...session,
    status: input.status ?? session.status,
    currentStage: input.currentStage ?? session.currentStage,
    summary: input.summary ?? session.summary,
    lastProgressSnapshotId: input.lastProgressSnapshotId ?? session.lastProgressSnapshotId,
    interruptionReason: input.interruptionReason ?? session.interruptionReason,
    outputArtifactPaths: input.outputArtifactPaths ?? session.outputArtifactPaths,
    updatedAt,
    endedAt: input.endedAt ?? session.endedAt,
  });
}

export function createRunCheckpointRecord(input: CreateRunCheckpointInput): RunCheckpoint {
  const timestamp = input.createdAt ?? new Date().toISOString();

  return RunCheckpointSchema.parse({
    id: createRunScopedId(
      'checkpoint',
      `${input.runId}:${input.sessionId}:${input.stage}:${timestamp}`,
    ),
    runId: input.runId,
    sessionId: input.sessionId,
    stage: input.stage,
    createdAt: timestamp,
    status: input.status,
    summary: input.summary,
    requiredArtifactPaths: input.requiredArtifactPaths,
    outputArtifactPaths: input.outputArtifactPaths,
    restartable: input.restartable,
    rerunStageOnResume: input.rerunStageOnResume,
    resumeInstructions: input.resumeInstructions,
    lastSuccessfulStep: input.lastSuccessfulStep,
    pendingStep: input.pendingStep,
  });
}

export function createRunProgressSnapshotRecord(
  input: CreateRunProgressSnapshotInput,
): RunProgressSnapshot {
  const timestamp = input.createdAt ?? new Date().toISOString();

  return RunProgressSnapshotSchema.parse({
    id: createRunScopedId(
      'progress',
      `${input.runId}:${input.sessionId}:${input.stage}:${timestamp}:${input.summary}`,
    ),
    runId: input.runId,
    sessionId: input.sessionId,
    stage: input.stage,
    status: input.status,
    createdAt: timestamp,
    summary: input.summary,
    justCompleted: input.justCompleted,
    remaining: input.remaining,
    blockers: input.blockers ?? [],
    currentRisks: input.currentRisks ?? [],
    approvedScope: input.approvedScope ?? [],
    verificationState: input.verificationState,
    artifactPaths: input.artifactPaths,
    nextRecommendedStep: input.nextRecommendedStep,
  });
}

export function createResumeEligibilityRecord(input: {
  eligible: boolean;
  evaluatedAt?: string;
  nextStage?: RunStage;
  reasons: string[];
  requiredArtifactPaths?: string[];
  summary: string;
}): ResumeEligibility {
  return ResumeEligibilitySchema.parse({
    status: input.eligible ? 'eligible' : 'ineligible',
    eligible: input.eligible,
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
    summary: input.summary,
    reasons: input.reasons,
    requiredArtifactPaths: input.requiredArtifactPaths ?? [],
    nextStage: input.nextStage,
  });
}

export function createPendingActionRecord(input: {
  runId: string;
  kind: PendingActionKind;
  title: string;
  summary: string;
  artifactPaths?: string[];
  createdAt?: string;
  status?: PendingActionStatus;
  resolvedAt?: string;
}): PendingAction {
  const timestamp = input.createdAt ?? new Date().toISOString();

  return PendingActionSchema.parse({
    id: createRunScopedId(
      'pending-action',
      `${input.runId}:${input.kind}:${input.title}:${timestamp}`,
    ),
    kind: input.kind,
    status: input.status ?? 'open',
    title: input.title,
    summary: input.summary,
    artifactPaths: input.artifactPaths ?? [],
    createdAt: timestamp,
    resolvedAt: input.resolvedAt,
  });
}

export function createWorkspaceSnapshotRecord(input: {
  repoRoot: string;
  workingDirectory: string;
  gitAvailable: boolean;
  gitHead?: string;
  dirtyWorkingTree?: boolean | null;
  changedFiles?: string[];
  expectedArtifactPaths?: string[];
  knownRunChangedFiles?: string[];
  capturedAt?: string;
}): WorkspaceSnapshot {
  return WorkspaceSnapshotSchema.parse({
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    repoRoot: input.repoRoot,
    workingDirectory: input.workingDirectory,
    gitAvailable: input.gitAvailable,
    gitHead: input.gitHead,
    dirtyWorkingTree: input.dirtyWorkingTree ?? null,
    changedFiles: input.changedFiles ?? [],
    expectedArtifactPaths: input.expectedArtifactPaths ?? [],
    knownRunChangedFiles: input.knownRunChangedFiles ?? [],
  });
}

export function createContinuityAssessmentRecord(input: {
  runId: string;
  status: WorkspaceCompatibility;
  summary: string;
  reasons: string[];
  missingArtifactPaths?: string[];
  changedKnownRunFiles?: string[];
  storedSnapshot: WorkspaceSnapshot;
  currentSnapshot: WorkspaceSnapshot;
  evaluatedAt?: string;
}): ContinuityAssessment {
  const timestamp = input.evaluatedAt ?? new Date().toISOString();

  return ContinuityAssessmentSchema.parse({
    id: createRunScopedId(
      'continuity',
      `${input.runId}:${input.status}:${timestamp}:${input.summary}`,
    ),
    runId: input.runId,
    evaluatedAt: timestamp,
    status: input.status,
    summary: input.summary,
    reasons: input.reasons,
    missingArtifactPaths: input.missingArtifactPaths ?? [],
    changedKnownRunFiles: input.changedKnownRunFiles ?? [],
    storedSnapshot: input.storedSnapshot,
    currentSnapshot: input.currentSnapshot,
  });
}

export function createResumePlanRecord(input: {
  runId: string;
  fromStatus: RunStatus;
  nextStage: RunStage;
  summary: string;
  sourceCheckpointId?: string;
  lastSuccessfulStage?: RunStage;
  rerunStages?: RunStage[];
  actions?: string[];
  approvalStrategy?: ApprovalContinuation;
  verificationStrategy?: VerificationContinuation;
  createdAt?: string;
}): ResumePlan {
  const timestamp = input.createdAt ?? new Date().toISOString();

  return ResumePlanSchema.parse({
    id: createRunScopedId(
      'resume-plan',
      `${input.runId}:${input.fromStatus}:${input.nextStage}:${timestamp}`,
    ),
    runId: input.runId,
    createdAt: timestamp,
    sourceCheckpointId: input.sourceCheckpointId,
    fromStatus: input.fromStatus,
    lastSuccessfulStage: input.lastSuccessfulStage,
    nextStage: input.nextStage,
    rerunStages: input.rerunStages ?? [],
    actions: input.actions ?? [],
    approvalStrategy: input.approvalStrategy ?? 'not_needed',
    verificationStrategy: input.verificationStrategy ?? 'not_needed',
    summary: input.summary,
  });
}

export function createSessionManifestRecord(input: {
  run: Run;
  currentSession: RunSession;
  createdAt?: string;
  updatedAt?: string;
  approvalState?: SessionManifest['approvalState'];
  verificationState?: SessionManifest['verificationState'];
  policyDecision?: SessionManifest['policyDecision'];
  artifactPaths?: Record<string, string>;
  lastCheckpointId?: string;
  lastProgressSnapshotId?: string;
  pendingActions?: PendingAction[];
  resumeEligibility?: ResumeEligibility;
  workspaceLastSnapshot?: WorkspaceSnapshot;
  github?: RunGithubState;
  continuationContext?: ContinuationContext;
  latestContinuityAssessmentPath?: string;
  latestResumePlanPath?: string;
  interruption?: SessionManifest['interruption'];
  sessionIds?: string[];
  summary: string;
}): SessionManifest {
  const createdAt = input.createdAt ?? input.run.createdAt;
  const updatedAt = input.updatedAt ?? new Date().toISOString();

  return SessionManifestSchema.parse({
    runId: input.run.id,
    currentSessionId: input.currentSession.id,
    sessionIds: input.sessionIds ?? [input.currentSession.id],
    status: input.run.status,
    createdAt,
    updatedAt,
    currentStage: input.run.currentStage,
    lastSuccessfulStage: input.run.lastSuccessfulStage,
    lastSuccessfulStep: input.run.lastSuccessfulStage,
    pendingStage: input.run.pendingStage,
    pendingStep: input.run.pendingStage,
    policyDecision: input.policyDecision,
    approvalState: input.approvalState ?? {
      required: false,
      status: 'not_required',
      artifactPaths: [],
    },
    verificationState: input.verificationState ?? {
      status: input.run.verificationStatus,
      summary: input.run.summary ?? 'Verification has not run yet.',
      resultPath: input.run.verificationResultPath,
      lastVerifiedAt: input.run.lastVerifiedAt,
    },
    workspace: {
      repoRoot: input.run.repoRoot,
      runDirectory: input.run.runDirectory,
      lastSnapshot: input.workspaceLastSnapshot,
    },
    github: input.github ?? input.run.github,
    artifactPaths: input.artifactPaths ?? {},
    lastCheckpointId: input.lastCheckpointId ?? input.run.lastCheckpointId,
    lastProgressSnapshotId: input.lastProgressSnapshotId ?? input.run.lastProgressSnapshotId,
    resumeEligibility:
      input.resumeEligibility ??
      createResumeEligibilityRecord({
        eligible: false,
        reasons: ['Resume eligibility has not been evaluated yet.'],
        summary: 'Resume eligibility has not been evaluated yet.',
      }),
    pendingActions: input.pendingActions ?? [],
    continuationContext: input.continuationContext,
    latestContinuityAssessmentPath: input.latestContinuityAssessmentPath,
    latestResumePlanPath: input.latestResumePlanPath,
    interruption: input.interruption,
    summary: input.summary,
  });
}

export function updateSessionManifestRecord(
  manifest: SessionManifest,
  input: Partial<Omit<SessionManifest, 'runId' | 'createdAt'>> & {
    updatedAt?: string;
  },
): SessionManifest {
  return SessionManifestSchema.parse({
    ...manifest,
    ...input,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  });
}

export function createRunEvent(
  runId: string,
  type: RunEventType,
  payload: Record<string, unknown>,
  timestamp = new Date().toISOString(),
): RunEvent {
  return RunEventSchema.parse({
    id: createRunScopedId('evt', `${runId}:${type}:${timestamp}:${JSON.stringify(payload)}`),
    runId,
    timestamp,
    type,
    payload,
  });
}

export function createGithubIterationRequestRecord(input: {
  runId: string;
  pullRequest: GithubPullRequestRef;
  sourceComment: GithubCommentRef;
  instruction: string;
  command?: string;
  normalizedInputPath?: string;
  createdAt?: string;
}): GithubIterationRequest {
  const timestamp = input.createdAt ?? new Date().toISOString();

  return GithubIterationRequestSchema.parse({
    id: createRunScopedId(
      'github-iteration',
      `${input.runId}:${input.sourceComment.commentId}:${input.instruction}:${timestamp}`,
    ),
    runId: input.runId,
    pullRequest: input.pullRequest,
    sourceComment: input.sourceComment,
    command: input.command ?? '/gdh iterate',
    instruction: input.instruction,
    normalizedInputPath: input.normalizedInputPath,
    createdAt: timestamp,
  });
}

export function createArtifactReference(
  runId: string,
  kind: string,
  path: string,
  format: ArtifactReference['format'],
  createdAt = new Date().toISOString(),
  summary?: string,
): ArtifactReference {
  return ArtifactReferenceSchema.parse({
    id: createRunScopedId('artifact', `${runId}:${kind}:${path}`),
    runId,
    kind,
    path,
    format,
    createdAt,
    summary,
  });
}
