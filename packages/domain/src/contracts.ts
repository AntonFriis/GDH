import { z } from 'zod';
import {
  actionKindValues,
  activityKindValues,
  approvalContinuationValues,
  approvalModeValues,
  approvalPolicyValues,
  approvalResolutionValues,
  approvalStateValues,
  artifactLinkFormatValues,
  baselineRefKindValues,
  benchmarkCandidateStatusValues,
  benchmarkCaseResultStatusValues,
  benchmarkComparisonStatusValues,
  benchmarkExecutionModeValues,
  benchmarkGraderNameValues,
  benchmarkMetricNameValues,
  benchmarkRunStatusValues,
  benchmarkSourceTypeValues,
  benchmarkSuiteIdValues,
  benchmarkTargetKindValues,
  captureCompletenessValues,
  changedFileStatusValues,
  checkpointStageValues,
  claimCategoryValues,
  claimCheckStatusValues,
  commandProvenanceValues,
  failureBucketKindValues,
  failureCategoryValues,
  failureRecordStatusValues,
  failureSeverityValues,
  failureSourceSurfaceValues,
  githubSummaryStateValues,
  pendingActionKindValues,
  pendingActionStatusValues,
  policyAuditStatusValues,
  policyDecisionValues,
  policyMatchDimensionValues,
  previewConfidenceValues,
  proposedCommandSourceValues,
  proposedPathKindValues,
  regressionStatusValues,
  resumeEligibilityStatusValues,
  reviewPacketApprovalStatusValues,
  reviewPacketStatusValues,
  riskLevelValues,
  runEventTypeValues,
  runnerValues,
  runSessionStatusValues,
  runSessionTriggerValues,
  runStageValues,
  runStatusValues,
  sandboxModeValues,
  specSourceValues,
  taskClassValues,
  taskModeValues,
  taskStatusValues,
  timelineSeverityValues,
  verificationCheckStatusValues,
  verificationCommandPhaseValues,
  verificationContinuationValues,
  verificationEvidenceKindValues,
  verificationStatusValues,
  workspaceCompatibilityValues,
} from './values.js';

export * from './values.js';

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
export const BenchmarkRunStatusSchema = z.enum(benchmarkRunStatusValues);
export const BenchmarkExecutionModeSchema = z.enum(benchmarkExecutionModeValues);
export const BenchmarkTargetKindSchema = z.enum(benchmarkTargetKindValues);
export const BenchmarkSuiteIdSchema = z.enum(benchmarkSuiteIdValues);
export const BenchmarkMetricNameSchema = z.enum(benchmarkMetricNameValues);
export const BenchmarkGraderNameSchema = z.enum(benchmarkGraderNameValues);
export const BenchmarkSourceTypeSchema = z.enum(benchmarkSourceTypeValues);
export const BenchmarkCandidateStatusSchema = z.enum(benchmarkCandidateStatusValues);
export const BenchmarkCaseResultStatusSchema = z.enum(benchmarkCaseResultStatusValues);
export const BaselineRefKindSchema = z.enum(baselineRefKindValues);
export const BenchmarkComparisonStatusSchema = z.enum(benchmarkComparisonStatusValues);
export const RegressionStatusSchema = z.enum(regressionStatusValues);
export const TimelineSeveritySchema = z.enum(timelineSeverityValues);
export const GithubSummaryStateSchema = z.enum(githubSummaryStateValues);
export const ArtifactLinkFormatSchema = z.enum(artifactLinkFormatValues);
export const ActivityKindSchema = z.enum(activityKindValues);
export const FailureCategorySchema = z.enum(failureCategoryValues);
export const FailureSeveritySchema = z.enum(failureSeverityValues);
export const FailureSourceSurfaceSchema = z.enum(failureSourceSurfaceValues);
export const FailureRecordStatusSchema = z.enum(failureRecordStatusValues);
export const FailureBucketKindSchema = z.enum(failureBucketKindValues);
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

export const WorkspaceContentSnapshotEntrySchema = z.object({
  path: z.string(),
  hash: z.string(),
});

export const WorkspaceContentSnapshotArtifactSchema = z.object({
  capturedAt: z.string(),
  entries: z.array(WorkspaceContentSnapshotEntrySchema),
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

export const ThresholdPolicySchema = z.object({
  maxOverallScoreDrop: z.number().min(0).max(1),
  requiredMetrics: z.array(BenchmarkMetricNameSchema),
  failOnNewlyFailingCases: z.boolean(),
});

export const BaselineRefSchema = z.object({
  kind: BaselineRefKindSchema,
  id: z.string(),
  label: z.string(),
  artifactPath: z.string(),
  benchmarkRunId: z.string().optional(),
});

export const BenchmarkCaseInputSchema = z.object({
  kind: z.literal('markdown_spec'),
  specPath: z.string().optional(),
  specFixturePath: z.string().optional(),
  targetPath: z.string().optional(),
});

export const BenchmarkCaseExpectedSchema = z.object({
  runStatus: RunStatusSchema.optional(),
  policyDecision: PolicyDecisionSchema.optional(),
  approvalState: ApprovalStateSchema.optional(),
  verificationStatus: VerificationStatusSchema.optional(),
  reviewPacketStatus: ReviewPacketStatusSchema.optional(),
  requiredArtifacts: z.array(z.string()),
});

export const BenchmarkMetricEvidenceSchema = z.object({
  label: z.string(),
  path: z.string().optional(),
  value: z.string().optional(),
});

export const BenchmarkSourceProvenanceSchema = z.object({
  summary: z.string(),
  references: z.array(z.string()).min(1),
});

export const BenchmarkGraderSelectionSchema = z.object({
  name: BenchmarkGraderNameSchema,
  metric: BenchmarkMetricNameSchema.optional(),
  threshold: z.string().optional(),
  notes: z.string().optional(),
});

export const BenchmarkCaseMetadataSchema = z.object({
  candidateId: z.string().optional(),
  sourceType: BenchmarkSourceTypeSchema,
  sourceProvenance: BenchmarkSourceProvenanceSchema,
  collectionDate: z.string(),
  acceptedDate: z.string().optional(),
  taskClass: TaskClassSchema,
  riskClass: RiskLevelSchema,
  successCriteria: z.array(z.string()).min(1),
  allowedPolicies: z.array(PolicyDecisionSchema).min(1),
  expectedVerificationCommands: z.array(z.string()).default([]),
  graders: z.array(BenchmarkGraderSelectionSchema).min(1),
  simplificationNotes: z.array(z.string()).default([]),
  contaminationNotes: z.array(z.string()).default([]),
  acceptanceNotes: z.array(z.string()).default([]),
  maintainerNotes: z.array(z.string()).default([]),
});

export const BenchmarkMetricSchema = z.object({
  name: BenchmarkMetricNameSchema,
  title: z.string(),
  description: z.string(),
  weight: z.number().nonnegative(),
  score: z.number().min(0).max(1),
  passed: z.boolean(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
  summary: z.string(),
  evidence: z.array(BenchmarkMetricEvidenceSchema),
});

export const BenchmarkScoreSchema = z.object({
  totalWeight: z.number().nonnegative(),
  earnedWeight: z.number().nonnegative(),
  normalizedScore: z.number().min(0).max(1),
  passedMetrics: z.number().int().nonnegative(),
  failedMetrics: z.number().int().nonnegative(),
  metrics: z.array(BenchmarkMetricSchema),
  summary: z.string(),
});

export const BenchmarkCaseSchema = z.object({
  version: z.number().int().positive(),
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  metadata: BenchmarkCaseMetadataSchema.optional(),
  suiteIds: z.array(z.string()).min(1),
  tags: z.array(z.string()),
  execution: z.object({
    mode: BenchmarkExecutionModeSchema,
    runner: RunnerSchema,
    approvalMode: ApprovalModeSchema,
    policyPath: z.string().optional(),
    repoFixturePath: z.string().optional(),
    ciSafe: z.boolean(),
  }),
  input: BenchmarkCaseInputSchema,
  expected: BenchmarkCaseExpectedSchema,
  weights: z.partialRecord(BenchmarkMetricNameSchema, z.number().nonnegative()),
});

export const BenchmarkIntakeReviewSchema = z.object({
  status: BenchmarkCandidateStatusSchema,
  reviewedAt: z.string(),
  rationale: z.string(),
  acceptedCaseId: z.string().optional(),
  rejectionReasons: z.array(z.string()).default([]),
});

export const BenchmarkIntakeRecordSchema = z.object({
  version: z.number().int().positive(),
  id: z.string(),
  title: z.string(),
  suiteId: BenchmarkSuiteIdSchema,
  sourceType: BenchmarkSourceTypeSchema,
  sourceProvenance: BenchmarkSourceProvenanceSchema,
  collectionDate: z.string(),
  taskClass: TaskClassSchema,
  riskClass: RiskLevelSchema,
  repoFixturePath: z.string().optional(),
  inputSpecPath: z.string().optional(),
  successCriteria: z.array(z.string()).min(1),
  allowedPolicies: z.array(PolicyDecisionSchema).min(1),
  expectedVerificationCommands: z.array(z.string()).default([]),
  graders: z.array(BenchmarkGraderSelectionSchema).min(1),
  simplificationNotes: z.array(z.string()).default([]),
  contaminationNotes: z.array(z.string()).default([]),
  maintainerNotes: z.array(z.string()).default([]),
  review: BenchmarkIntakeReviewSchema,
});

export const BenchmarkSuiteSchema = z.object({
  version: z.number().int().positive(),
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  caseIds: z.array(z.string()),
  tags: z.array(z.string()),
  mode: BenchmarkExecutionModeSchema,
  baseline: BaselineRefSchema.optional(),
  thresholds: ThresholdPolicySchema.optional(),
});

export const BenchmarkRunConfigurationSchema = z.object({
  ciSafe: z.boolean(),
  targetId: z.string(),
  targetKind: BenchmarkTargetKindSchema,
  suiteId: z.string().optional(),
  thresholdPolicy: ThresholdPolicySchema.optional(),
  baseline: BaselineRefSchema.optional(),
});

export const BenchmarkCaseResultSchema = z.object({
  id: z.string(),
  benchmarkRunId: z.string(),
  caseId: z.string(),
  title: z.string(),
  suiteIds: z.array(z.string()),
  status: BenchmarkCaseResultStatusSchema,
  mode: BenchmarkExecutionModeSchema,
  tags: z.array(z.string()),
  governedRunId: z.string().optional(),
  governedRunPath: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  expected: BenchmarkCaseExpectedSchema,
  actual: z.object({
    runStatus: RunStatusSchema.optional(),
    policyDecision: PolicyDecisionSchema.optional(),
    approvalState: ApprovalStateSchema.optional(),
    verificationStatus: VerificationStatusSchema.optional(),
    reviewPacketStatus: ReviewPacketStatusSchema.optional(),
    artifactPaths: z.array(z.string()),
  }),
  score: BenchmarkScoreSchema,
  failureReasons: z.array(z.string()),
  notes: z.array(z.string()),
});

export const RegressionMetricFailureSchema = z.object({
  caseId: z.string(),
  metric: BenchmarkMetricNameSchema,
  summary: z.string(),
});

export const RegressionResultSchema = z.object({
  id: z.string(),
  status: RegressionStatusSchema,
  comparedAt: z.string(),
  thresholdPolicy: ThresholdPolicySchema,
  overallScoreDrop: z.number(),
  exceededOverallScoreDrop: z.boolean(),
  newlyFailingCases: z.array(z.string()),
  requiredMetricFailures: z.array(RegressionMetricFailureSchema),
  reasons: z.array(z.string()),
  summary: z.string(),
});

export const BenchmarkMetricComparisonSchema = z.object({
  name: BenchmarkMetricNameSchema,
  lhsScore: z.number().min(0).max(1).nullable(),
  rhsScore: z.number().min(0).max(1).nullable(),
  delta: z.number().nullable(),
  lhsPassed: z.boolean().nullable(),
  rhsPassed: z.boolean().nullable(),
  status: BenchmarkComparisonStatusSchema,
  summary: z.string(),
});

export const BenchmarkCaseComparisonSchema = z.object({
  caseId: z.string(),
  title: z.string(),
  lhsStatus: z.union([BenchmarkCaseResultStatusSchema, z.literal('missing')]),
  rhsStatus: z.union([BenchmarkCaseResultStatusSchema, z.literal('missing')]),
  lhsScore: z.number().min(0).max(1).nullable(),
  rhsScore: z.number().min(0).max(1).nullable(),
  delta: z.number().nullable(),
  status: BenchmarkComparisonStatusSchema,
  metricComparisons: z.array(BenchmarkMetricComparisonSchema),
  summary: z.string(),
});

export const ComparisonReportSchema = z.object({
  id: z.string(),
  comparedAt: z.string(),
  lhsRunId: z.string(),
  rhs: BaselineRefSchema,
  suiteId: z.string().optional(),
  overall: z.object({
    lhsScore: z.number().min(0).max(1),
    rhsScore: z.number().min(0).max(1),
    delta: z.number(),
    lhsPassedCases: z.number().int().nonnegative(),
    rhsPassedCases: z.number().int().nonnegative(),
    newlyFailingCases: z.array(z.string()),
  }),
  caseComparisons: z.array(BenchmarkCaseComparisonSchema),
  regression: RegressionResultSchema.optional(),
  summary: z.string(),
});

export const BenchmarkRunSchema = z.object({
  id: z.string(),
  status: BenchmarkRunStatusSchema,
  target: z.object({
    kind: BenchmarkTargetKindSchema,
    id: z.string(),
  }),
  suiteId: z.string().optional(),
  caseIds: z.array(z.string()),
  mode: BenchmarkExecutionModeSchema,
  repoRoot: z.string(),
  runDirectory: z.string(),
  configuration: BenchmarkRunConfigurationSchema,
  score: BenchmarkScoreSchema,
  caseResults: z.array(BenchmarkCaseResultSchema),
  comparisonReportPath: z.string().optional(),
  regressionResultPath: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  summary: z.string(),
});

export const ArtifactLinkViewSchema = z.object({
  label: z.string(),
  path: z.string(),
  relativePath: z.string(),
  format: ArtifactLinkFormatSchema,
  exists: z.boolean(),
  href: z.string().optional(),
  summary: z.string().optional(),
});

export const TimelineEventViewSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  title: z.string(),
  summary: z.string(),
  severity: TimelineSeveritySchema,
  artifactLink: ArtifactLinkViewSchema.optional(),
});

export const ApprovalSummaryViewSchema = z.object({
  required: z.boolean(),
  status: ApprovalStateSchema,
  summary: z.string(),
  policyDecision: PolicyDecisionSchema.optional(),
  requiredApprovalMode: ApprovalModeSchema.nullable().optional(),
  packetId: z.string().optional(),
  createdAt: z.string().optional(),
  resolvedAt: z.string().optional(),
  affectedPaths: z.array(z.string()),
  predictedCommands: z.array(z.string()),
  reasons: z.array(z.string()),
  riskSummary: z.array(z.string()),
  artifactLinks: z.array(ArtifactLinkViewSchema),
});

export const VerificationSummaryViewSchema = z.object({
  status: VerificationStatusSchema,
  summary: z.string(),
  lastVerifiedAt: z.string().optional(),
  claimStatus: z.enum(['passed', 'failed']).optional(),
  packetCompletenessStatus: z.enum(['passed', 'failed']).optional(),
  completionFinalStatus: z.enum(['completed', 'failed']).optional(),
  commandsPassed: z.number().int().nonnegative(),
  commandsFailed: z.number().int().nonnegative(),
  checksPassed: z.number().int().nonnegative(),
  checksFailed: z.number().int().nonnegative(),
  mandatoryFailures: z.array(z.string()),
  artifactLinks: z.array(ArtifactLinkViewSchema),
});

export const GithubSummaryViewSchema = z.object({
  status: GithubSummaryStateSchema,
  summary: z.string(),
  issue: GithubIssueRefSchema.optional(),
  branch: GithubBranchRefSchema.optional(),
  pullRequest: GithubPullRequestRefSchema.optional(),
  lastUpdatedAt: z.string().optional(),
  lastSyncError: z.string().optional(),
  artifactLinks: z.array(ArtifactLinkViewSchema),
});

export const BenchmarkSummaryViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  suiteId: z.string().optional(),
  targetKind: BenchmarkTargetKindSchema,
  targetId: z.string(),
  status: BenchmarkRunStatusSchema,
  mode: BenchmarkExecutionModeSchema,
  normalizedScore: z.number().min(0).max(1),
  summary: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  regressionStatus: RegressionStatusSchema.optional(),
  regressionSummary: z.string().optional(),
  comparisonSummary: z.string().optional(),
  passedCases: z.number().int().nonnegative(),
  failedCases: z.number().int().nonnegative(),
  errorCases: z.number().int().nonnegative(),
  totalCases: z.number().int().nonnegative(),
  relatedRunIds: z.array(z.string()),
  artifactLinks: z.array(ArtifactLinkViewSchema),
});

export const AnalyticsStatusCountViewSchema = z.object({
  label: z.string(),
  count: z.number().int().nonnegative(),
});

export const RecentActivityViewSchema = z.object({
  kind: ActivityKindSchema,
  id: z.string(),
  title: z.string(),
  status: z.string(),
  timestamp: z.string(),
});

export const AnalyticsSummaryViewSchema = z.object({
  generatedAt: z.string(),
  totalRuns: z.number().int().nonnegative(),
  totalBenchmarks: z.number().int().nonnegative(),
  runCountsByStatus: z.array(AnalyticsStatusCountViewSchema),
  approvalRequiredRuns: z.number().int().nonnegative(),
  autoAllowedRuns: z.number().int().nonnegative(),
  approvalPendingRuns: z.number().int().nonnegative(),
  approvalDeniedRuns: z.number().int().nonnegative(),
  verificationPassedRuns: z.number().int().nonnegative(),
  verificationFailedRuns: z.number().int().nonnegative(),
  githubDraftPrRuns: z.number().int().nonnegative(),
  benchmarkRegressionFailures: z.number().int().nonnegative(),
  recentActivity: z.array(RecentActivityViewSchema),
});

export const RunListItemViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  objective: z.string(),
  summary: z.string(),
  taskClass: TaskClassSchema,
  status: RunStatusSchema,
  currentStage: RunStageSchema.optional(),
  repoRoot: z.string(),
  runDirectory: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  approval: ApprovalSummaryViewSchema,
  verification: VerificationSummaryViewSchema,
  github: GithubSummaryViewSchema,
  linkedBenchmarkIds: z.array(z.string()),
});

export const RunDetailSpecViewSchema = z.object({
  source: SpecSourceSchema,
  sourcePath: z.string(),
  summary: z.string(),
  objective: z.string(),
  constraints: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  riskHints: z.array(z.string()),
  normalizationNotes: z.array(z.string()),
  githubIssue: GithubIssueRefSchema.optional(),
});

export const RunDetailPlanTaskViewSchema = z.object({
  order: z.number().int().nonnegative(),
  title: z.string(),
  description: z.string(),
  riskLevel: RiskLevelSchema.optional(),
  suggestedMode: TaskModeSchema.optional(),
  status: TaskStatusSchema.optional(),
});

export const RunDetailPlanViewSchema = z.object({
  summary: z.string(),
  doneConditions: z.array(z.string()),
  assumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  taskUnits: z.array(RunDetailPlanTaskViewSchema),
});

export const RunDetailReviewPacketViewSchema = z.object({
  packetStatus: z.string(),
  overview: z.string(),
  runnerSummary: z.string(),
  filesChanged: z.array(z.string()),
  diffSummary: z.array(z.string()),
  risks: z.array(z.string()),
  limitations: z.array(z.string()),
  openQuestions: z.array(z.string()),
  artifactLinks: z.array(ArtifactLinkViewSchema),
});

export const RunDetailViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  objective: z.string(),
  summary: z.string(),
  taskClass: TaskClassSchema,
  status: RunStatusSchema,
  currentStage: RunStageSchema.optional(),
  repoRoot: z.string(),
  runDirectory: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  normalizedSpec: RunDetailSpecViewSchema,
  plan: RunDetailPlanViewSchema,
  approval: ApprovalSummaryViewSchema,
  verification: VerificationSummaryViewSchema,
  github: GithubSummaryViewSchema,
  reviewPacket: RunDetailReviewPacketViewSchema,
  benchmarkLinks: z.array(BenchmarkSummaryViewSchema),
  timeline: z.array(TimelineEventViewSchema),
  artifactLinks: z.array(ArtifactLinkViewSchema),
});

export const ApprovalQueueItemViewSchema = z.object({
  runId: z.string(),
  title: z.string(),
  taskClass: TaskClassSchema,
  status: RunStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  approval: ApprovalSummaryViewSchema,
});

export const BenchmarkCaseSummaryViewSchema = z.object({
  caseId: z.string(),
  title: z.string(),
  status: BenchmarkCaseResultStatusSchema,
  normalizedScore: z.number().min(0).max(1),
  governedRunId: z.string().optional(),
  governedRunPath: z.string().optional(),
  durationMs: z.number().int().nonnegative(),
  failureReasons: z.array(z.string()),
});

export const BenchmarkDetailViewSchema = z.object({
  summary: BenchmarkSummaryViewSchema,
  suiteTitle: z.string().optional(),
  suiteDescription: z.string().optional(),
  thresholdPolicy: ThresholdPolicySchema.optional(),
  baseline: BaselineRefSchema.optional(),
  caseSummaries: z.array(BenchmarkCaseSummaryViewSchema),
});

export const FailureRecordLinkSchema = z.object({
  label: z.string(),
  path: z.string(),
});

export const FailureRecordSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  category: FailureCategorySchema,
  severity: FailureSeveritySchema,
  sourceSurface: FailureSourceSurfaceSchema,
  runId: z.string().optional(),
  benchmarkRunId: z.string().optional(),
  title: z.string(),
  description: z.string(),
  reproductionNotes: z.string().default(''),
  suspectedCause: z.string().optional(),
  status: FailureRecordStatusSchema,
  owner: z.string(),
  links: z.array(FailureRecordLinkSchema),
});

export const FailureSummaryCountSchema = z.object({
  label: z.string(),
  count: z.number().int().nonnegative(),
});

export const FailureSummarySchema = z.object({
  generatedAt: z.string(),
  totalRecords: z.number().int().nonnegative(),
  activeRecords: z.number().int().nonnegative(),
  countsByCategory: z.array(FailureSummaryCountSchema),
  countsBySeverity: z.array(FailureSummaryCountSchema),
  countsBySourceSurface: z.array(FailureSummaryCountSchema),
  countsByStatus: z.array(FailureSummaryCountSchema),
  latestRecords: z.array(FailureRecordSchema),
});

export const FailureTaxonomyItemViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  status: z.string(),
  timestamp: z.string(),
  href: z.string().optional(),
});

export const FailureTaxonomyBucketViewSchema = z.object({
  kind: FailureBucketKindSchema,
  title: z.string(),
  count: z.number().int().nonnegative(),
  items: z.array(FailureTaxonomyItemViewSchema),
});

export const FailureTaxonomyViewSchema = z.object({
  generatedAt: z.string(),
  buckets: z.array(FailureTaxonomyBucketViewSchema),
});

export const DashboardOverviewViewSchema = z.object({
  analytics: AnalyticsSummaryViewSchema,
  recentRuns: z.array(RunListItemViewSchema),
  recentBenchmarks: z.array(BenchmarkSummaryViewSchema),
  approvals: z.array(ApprovalQueueItemViewSchema),
  failures: FailureTaxonomyViewSchema,
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
export type BenchmarkRunStatus = z.infer<typeof BenchmarkRunStatusSchema>;
export type BenchmarkExecutionMode = z.infer<typeof BenchmarkExecutionModeSchema>;
export type BenchmarkTargetKind = z.infer<typeof BenchmarkTargetKindSchema>;
export type BenchmarkSuiteId = z.infer<typeof BenchmarkSuiteIdSchema>;
export type BenchmarkMetricName = z.infer<typeof BenchmarkMetricNameSchema>;
export type BenchmarkGraderName = z.infer<typeof BenchmarkGraderNameSchema>;
export type BenchmarkSourceType = z.infer<typeof BenchmarkSourceTypeSchema>;
export type BenchmarkCandidateStatus = z.infer<typeof BenchmarkCandidateStatusSchema>;
export type BenchmarkCaseResultStatus = z.infer<typeof BenchmarkCaseResultStatusSchema>;
export type BaselineRefKind = z.infer<typeof BaselineRefKindSchema>;
export type BenchmarkComparisonStatus = z.infer<typeof BenchmarkComparisonStatusSchema>;
export type RegressionStatus = z.infer<typeof RegressionStatusSchema>;
export type TimelineSeverity = z.infer<typeof TimelineSeveritySchema>;
export type GithubSummaryState = z.infer<typeof GithubSummaryStateSchema>;
export type ArtifactLinkFormat = z.infer<typeof ArtifactLinkFormatSchema>;
export type ActivityKind = z.infer<typeof ActivityKindSchema>;
export type FailureCategory = z.infer<typeof FailureCategorySchema>;
export type FailureSeverity = z.infer<typeof FailureSeveritySchema>;
export type FailureSourceSurface = z.infer<typeof FailureSourceSurfaceSchema>;
export type FailureRecordStatus = z.infer<typeof FailureRecordStatusSchema>;
export type FailureBucketKind = z.infer<typeof FailureBucketKindSchema>;
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
export type WorkspaceContentSnapshotArtifact = z.infer<
  typeof WorkspaceContentSnapshotArtifactSchema
>;
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
export type ThresholdPolicy = z.infer<typeof ThresholdPolicySchema>;
export type BaselineRef = z.infer<typeof BaselineRefSchema>;
export type BenchmarkCaseInput = z.infer<typeof BenchmarkCaseInputSchema>;
export type BenchmarkCaseExpected = z.infer<typeof BenchmarkCaseExpectedSchema>;
export type BenchmarkMetricEvidence = z.infer<typeof BenchmarkMetricEvidenceSchema>;
export type BenchmarkSourceProvenance = z.infer<typeof BenchmarkSourceProvenanceSchema>;
export type BenchmarkGraderSelection = z.infer<typeof BenchmarkGraderSelectionSchema>;
export type BenchmarkCaseMetadata = z.infer<typeof BenchmarkCaseMetadataSchema>;
export type BenchmarkMetric = z.infer<typeof BenchmarkMetricSchema>;
export type BenchmarkScore = z.infer<typeof BenchmarkScoreSchema>;
export type BenchmarkCase = z.infer<typeof BenchmarkCaseSchema>;
export type BenchmarkIntakeReview = z.infer<typeof BenchmarkIntakeReviewSchema>;
export type BenchmarkIntakeRecord = z.infer<typeof BenchmarkIntakeRecordSchema>;
export type BenchmarkSuite = z.infer<typeof BenchmarkSuiteSchema>;
export type BenchmarkRunConfiguration = z.infer<typeof BenchmarkRunConfigurationSchema>;
export type BenchmarkCaseResult = z.infer<typeof BenchmarkCaseResultSchema>;
export type RegressionMetricFailure = z.infer<typeof RegressionMetricFailureSchema>;
export type RegressionResult = z.infer<typeof RegressionResultSchema>;
export type BenchmarkMetricComparison = z.infer<typeof BenchmarkMetricComparisonSchema>;
export type BenchmarkCaseComparison = z.infer<typeof BenchmarkCaseComparisonSchema>;
export type ComparisonReport = z.infer<typeof ComparisonReportSchema>;
export type BenchmarkRun = z.infer<typeof BenchmarkRunSchema>;
export type ArtifactLinkView = z.infer<typeof ArtifactLinkViewSchema>;
export type TimelineEventView = z.infer<typeof TimelineEventViewSchema>;
export type ApprovalSummaryView = z.infer<typeof ApprovalSummaryViewSchema>;
export type VerificationSummaryView = z.infer<typeof VerificationSummaryViewSchema>;
export type GithubSummaryView = z.infer<typeof GithubSummaryViewSchema>;
export type BenchmarkSummaryView = z.infer<typeof BenchmarkSummaryViewSchema>;
export type AnalyticsStatusCountView = z.infer<typeof AnalyticsStatusCountViewSchema>;
export type RecentActivityView = z.infer<typeof RecentActivityViewSchema>;
export type AnalyticsSummaryView = z.infer<typeof AnalyticsSummaryViewSchema>;
export type RunListItemView = z.infer<typeof RunListItemViewSchema>;
export type RunDetailSpecView = z.infer<typeof RunDetailSpecViewSchema>;
export type RunDetailPlanTaskView = z.infer<typeof RunDetailPlanTaskViewSchema>;
export type RunDetailPlanView = z.infer<typeof RunDetailPlanViewSchema>;
export type RunDetailReviewPacketView = z.infer<typeof RunDetailReviewPacketViewSchema>;
export type RunDetailView = z.infer<typeof RunDetailViewSchema>;
export type ApprovalQueueItemView = z.infer<typeof ApprovalQueueItemViewSchema>;
export type BenchmarkCaseSummaryView = z.infer<typeof BenchmarkCaseSummaryViewSchema>;
export type BenchmarkDetailView = z.infer<typeof BenchmarkDetailViewSchema>;
export type FailureRecordLink = z.infer<typeof FailureRecordLinkSchema>;
export type FailureRecord = z.infer<typeof FailureRecordSchema>;
export type FailureSummaryCount = z.infer<typeof FailureSummaryCountSchema>;
export type FailureSummary = z.infer<typeof FailureSummarySchema>;
export type FailureTaxonomyItemView = z.infer<typeof FailureTaxonomyItemViewSchema>;
export type FailureTaxonomyBucketView = z.infer<typeof FailureTaxonomyBucketViewSchema>;
export type FailureTaxonomyView = z.infer<typeof FailureTaxonomyViewSchema>;
export type DashboardOverviewView = z.infer<typeof DashboardOverviewViewSchema>;
