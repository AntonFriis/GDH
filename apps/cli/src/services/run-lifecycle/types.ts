import type { captureWorkspaceSnapshot, createArtifactStore } from '@gdh/artifact-store';
import type {
  ApprovalMode,
  ApprovalPacket,
  ApprovalResolution,
  ArtifactReference,
  ChangedFileCaptureSchema,
  CommandCapture,
  GithubIssueRef,
  ImpactPreviewSchema,
  IssueIngestionResult,
  PlanSchema,
  PolicyAuditResultSchema,
  PolicyEvaluationSchema,
  ResumeEligibility,
  Run,
  RunCheckpoint,
  RunEventType,
  RunGithubState,
  RunnerKind,
  RunnerResult,
  RunProgressSnapshot,
  RunSession,
  RunStage,
  SessionManifest,
  SpecSchema,
  WorkspaceContentSnapshotArtifactSchema,
} from '@gdh/domain';
import type { GithubAdapter, GithubConfig } from '@gdh/github-adapter';
import type { loadPolicyPackFromFile } from '@gdh/policy-engine';
import type { loadVerificationConfig } from '@gdh/verification';
import type { ApprovalResolver, ProgressReporter, RunCommandSummary } from '../../types.js';

export type LoadedSpec = ReturnType<typeof SpecSchema.parse>;
export type LoadedPlan = ReturnType<typeof PlanSchema.parse>;
export type LoadedPolicyDecision = ReturnType<typeof PolicyEvaluationSchema.parse>;
export type LoadedPolicyAudit = ReturnType<typeof PolicyAuditResultSchema.parse>;
export type LoadedChangedFiles = ReturnType<typeof ChangedFileCaptureSchema.parse>;
export type LoadedImpactPreview = ReturnType<typeof ImpactPreviewSchema.parse>;
export type LoadedWorkspaceContentSnapshotArtifact = ReturnType<
  typeof WorkspaceContentSnapshotArtifactSchema.parse
>;
export type ArtifactStore = ReturnType<typeof createArtifactStore>;
export type WorkspaceSnapshotDiff = Awaited<ReturnType<typeof captureWorkspaceSnapshot>>;
export type LoadedPolicyPack = Awaited<ReturnType<typeof loadPolicyPackFromFile>>;
export type LoadedVerificationConfig = Awaited<ReturnType<typeof loadVerificationConfig>>;

export interface LoadedRunContext {
  latestCheckpoint?: RunCheckpoint;
  latestProgress?: RunProgressSnapshot;
  manifest?: SessionManifest;
  approvalPacket?: ApprovalPacket;
  approvalResolution?: ApprovalResolution;
  partialChangedFiles?: LoadedChangedFiles;
  runnerEntrySnapshot?: LoadedWorkspaceContentSnapshotArtifact;
  changedFiles: LoadedChangedFiles;
  commandCapture: CommandCapture;
  diffPatch: string;
  plan: LoadedPlan;
  policyAudit?: LoadedPolicyAudit;
  policyDecision: LoadedPolicyDecision;
  run: Run;
  runnerResult: RunnerResult;
  spec: LoadedSpec;
}

export interface LoadedDurableRunState {
  approvalPacket?: ApprovalPacket;
  approvalResolution?: ApprovalResolution;
  changedFiles?: LoadedChangedFiles;
  commandCapture?: CommandCapture;
  diffPatch?: string;
  latestCheckpoint?: RunCheckpoint;
  latestProgress?: RunProgressSnapshot;
  manifest: SessionManifest;
  partialChangedFiles?: LoadedChangedFiles;
  plan?: LoadedPlan;
  policyAudit?: LoadedPolicyAudit;
  policyDecision?: LoadedPolicyDecision;
  run: Run;
  runnerEntrySnapshot?: LoadedWorkspaceContentSnapshotArtifact;
  runnerResult?: RunnerResult;
  spec?: LoadedSpec;
}

export interface RunLifecycleInspection {
  artifactStore: ArtifactStore;
  continuity: ReturnType<typeof import('@gdh/domain').createContinuityAssessmentRecord>;
  eligibility: ResumeEligibility;
  latestCheckpoint?: RunCheckpoint;
  latestProgress?: RunProgressSnapshot;
  manifest: SessionManifest;
  nextStage?: RunStage;
  resumePlan?: ReturnType<typeof import('@gdh/domain').createResumePlanRecord>;
  run: Run;
  spec?: LoadedSpec;
  state: LoadedDurableRunState;
}

export type RunSource = { kind: 'spec_file'; path: string } | { kind: 'github_issue'; ref: string };

export interface StartRunInput {
  approvalMode?: ApprovalMode;
  approvalResolver?: ApprovalResolver;
  cwd: string;
  githubAdapter?: GithubAdapter;
  githubConfig?: GithubConfig;
  policyPath?: string;
  progressReporter?: ProgressReporter;
  runner?: RunnerKind;
  source: RunSource;
}

export interface RunStatusOptions {
  cwd: string;
  emitStatusRequested?: boolean;
}

export interface RunResumeOptions {
  approvalResolver?: ApprovalResolver;
  cwd: string;
  progressReporter?: ProgressReporter;
}

export interface RunLifecycleService {
  run(input: StartRunInput): Promise<RunCommandSummary>;
  status(runId: string, options: RunStatusOptions): Promise<RunLifecycleInspection>;
  resume(runId: string, options: RunResumeOptions): Promise<RunCommandSummary>;
}

export interface RunLifecycleServiceDeps {
  createArtifactStoreFn?: typeof import('@gdh/artifact-store').createArtifactStore;
  findRepoRootFn?: typeof import('@gdh/shared').findRepoRoot;
  createRunIdFn?: typeof import('@gdh/shared').createRunId;
}

export interface RunLifecycleExecutionContext {
  approvalMode: ApprovalMode;
  approvalPacket?: ApprovalPacket;
  approvalPacketArtifact?: ArtifactReference;
  approvalPacketMarkdownArtifact?: ArtifactReference;
  approvalResolver?: ApprovalResolver;
  artifactStore: ArtifactStore;
  beforeSnapshot?: WorkspaceSnapshotDiff;
  changedFiles?: LoadedChangedFiles;
  commandCapture?: CommandCapture;
  cwd: string;
  diffPatch?: string;
  emitEvent: (type: RunEventType, payload: Record<string, unknown>) => Promise<ArtifactReference>;
  executedRunner: boolean;
  excludedRunPrefix?: string;
  githubIssue?: GithubIssueRef;
  githubState?: RunGithubState;
  impactPreview?: LoadedImpactPreview;
  issueIngestionResult?: IssueIngestionResult;
  loadedPolicyPack: LoadedPolicyPack;
  loadedPolicyPath: string;
  manifest: SessionManifest;
  mode: 'fresh' | 'resume';
  policyAudit?: LoadedPolicyAudit;
  policyDecision?: LoadedPolicyDecision;
  repoRoot: string;
  run: Run;
  runnerKind: RunnerKind;
  runnerResult?: RunnerResult;
  session: RunSession;
  spec?: LoadedSpec;
  plan?: LoadedPlan;
  verificationConfig: LoadedVerificationConfig;
  approvalResolution?: ApprovalResolution;
  progressReporter?: ProgressReporter;
}
