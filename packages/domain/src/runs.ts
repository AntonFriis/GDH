import {
  type ApprovalContinuation,
  type ApprovalMode,
  type ApprovalPolicy,
  type ArtifactReference,
  ArtifactReferenceSchema,
  type CheckpointStage,
  type ContinuationContext,
  type ContinuityAssessment,
  ContinuityAssessmentSchema,
  type GithubCommentRef,
  type GithubIterationRequest,
  GithubIterationRequestSchema,
  type GithubPullRequestRef,
  type PendingAction,
  type PendingActionKind,
  PendingActionSchema,
  type PendingActionStatus,
  type Plan,
  type ResumeEligibility,
  ResumeEligibilitySchema,
  type ResumePlan,
  ResumePlanSchema,
  type Run,
  type RunCheckpoint,
  RunCheckpointSchema,
  type RunEvent,
  RunEventSchema,
  type RunEventType,
  type RunGithubState,
  type RunnerKind,
  type RunProgressSnapshot,
  RunProgressSnapshotSchema,
  RunSchema,
  type RunSession,
  RunSessionSchema,
  type RunSessionStatus,
  type RunSessionTrigger,
  type RunStage,
  type RunStatus,
  type SessionManifest,
  SessionManifestSchema,
  type Spec,
  type VerificationContinuation,
  type VerificationStatus,
  type WorkspaceCompatibility,
  type WorkspaceSnapshot,
  WorkspaceSnapshotSchema,
} from './contracts.js';
import { createRunScopedId } from './ids.js';

export interface CreateRunInput {
  runId?: string;
  spec: Spec;
  plan: Plan;
  runner: RunnerKind;
  model: string;
  sandboxMode: Run['sandboxMode'];
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
