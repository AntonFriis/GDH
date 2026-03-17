import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import {
  captureWorkspaceSnapshot,
  captureWorkspaceState,
  createArtifactStore,
  createDiffPatch,
  createRunRelativeDirectory,
  diffWorkspaceSnapshots,
  listArtifactReferencesFromRunDirectory,
  resolveRunDirectory,
} from '@gdh/artifact-store';
import {
  type ApprovalMode,
  type ApprovalPacket,
  ApprovalPacketSchema,
  type ApprovalResolution,
  ApprovalResolutionRecordSchema,
  type ArtifactReference,
  ChangedFileCaptureSchema,
  type ClaimVerificationSummary,
  type CommandCapture,
  CommandCaptureSchema,
  type ContinuationContext,
  ContinuationContextSchema,
  createContinuityAssessmentRecord,
  createPendingActionRecord,
  createPlanFromSpec,
  createResumeEligibilityRecord,
  createResumePlanRecord,
  createRunCheckpointRecord,
  createRunEvent,
  createRunProgressSnapshotRecord,
  createRunRecord,
  createRunSessionRecord,
  createSessionManifestRecord,
  createWorkspaceSnapshotRecord,
  ImpactPreviewSchema,
  normalizeMarkdownSpec,
  PlanSchema,
  PolicyAuditResultSchema,
  type PolicyDecision,
  PolicyEvaluationSchema,
  type ResumeEligibility,
  type Run,
  type RunCheckpoint,
  RunCheckpointSchema,
  type RunEventType,
  type RunnerKind,
  type RunnerResult,
  RunnerResultSchema,
  type RunProgressSnapshot,
  RunProgressSnapshotSchema,
  RunSchema,
  type RunSession,
  RunSessionSchema,
  type RunStage,
  type SessionManifest,
  SessionManifestSchema,
  SpecSchema,
  updateRunResumeEligibility,
  updateRunSessionRecord,
  updateRunStage,
  updateRunStatus,
  updateRunVerification,
  updateSessionManifestRecord,
  type VerificationCommandResult,
  type VerificationStatus,
  type WorkspaceCompatibility,
  type WorkspaceSnapshot,
} from '@gdh/domain';
import {
  createApprovalPacket,
  createApprovalResolutionRecord,
  createPolicyAudit,
  evaluatePolicy,
  generateImpactPreview,
  loadPolicyPackFromFile,
  renderApprovalPacketMarkdown,
} from '@gdh/policy-engine';
import { createReviewPacket, renderReviewPacketMarkdown } from '@gdh/review-packets';
import {
  createCodexCliRunner,
  createFakeRunner,
  defaultRunnerDefaults,
  type Runner,
} from '@gdh/runner-codex';
import { createIsoTimestamp, createRunId, findRepoRoot } from '@gdh/shared';
import {
  describeVerificationScope,
  loadVerificationConfig,
  runVerification,
} from '@gdh/verification';
import { Command } from 'commander';

const supportedRunnerValues = ['codex-cli', 'fake'] as const;
const supportedApprovalModeValues = ['interactive', 'fail'] as const;

export interface RunCommandOptions {
  approvalMode?: ApprovalMode;
  approvalResolver?: ApprovalResolver;
  cwd?: string;
  json?: boolean;
  policyPath?: string;
  runner?: (typeof supportedRunnerValues)[number];
}

export interface RunCommandSummary {
  approvalPacketPath?: string;
  approvalResolution?: ApprovalResolution;
  artifactCount: number;
  artifactsDirectory: string;
  changedFiles: string[];
  commandsExecuted: Array<{
    command: string;
    isPartial: boolean;
    provenance: string;
  }>;
  exitCode: number;
  policyAuditPath: string;
  policyDecision?: PolicyDecision;
  reviewPacketPath: string;
  runId: string;
  specTitle: string;
  status: Run['status'];
  summary: string;
  manifestPath?: string;
  currentStage?: RunStage;
  lastCompletedStage?: RunStage;
  nextStage?: RunStage;
  latestProgressSummary?: string;
  resumeEligible?: boolean;
  resumeSummary?: string;
  continuityStatus?: WorkspaceCompatibility;
  verificationResultPath?: string;
  verificationStatus: VerificationStatus;
}

export type ApprovalResolver = (packet: ApprovalPacket) => Promise<ApprovalResolution>;

interface LoadedRunContext {
  latestCheckpoint?: RunCheckpoint;
  latestProgress?: RunProgressSnapshot;
  manifest?: SessionManifest;
  approvalPacket?: ApprovalPacket;
  approvalResolution?: ApprovalResolution;
  changedFiles: ReturnType<typeof ChangedFileCaptureSchema.parse>;
  commandCapture: CommandCapture;
  diffPatch: string;
  plan: ReturnType<typeof PlanSchema.parse>;
  policyAudit?: ReturnType<typeof PolicyAuditResultSchema.parse>;
  policyDecision: ReturnType<typeof PolicyEvaluationSchema.parse>;
  run: Run;
  runnerResult: RunnerResult;
  spec: ReturnType<typeof SpecSchema.parse>;
}

interface LoadedDurableRunState {
  approvalPacket?: ApprovalPacket;
  approvalResolution?: ApprovalResolution;
  changedFiles?: ReturnType<typeof ChangedFileCaptureSchema.parse>;
  commandCapture?: CommandCapture;
  diffPatch?: string;
  latestCheckpoint?: RunCheckpoint;
  latestProgress?: RunProgressSnapshot;
  manifest: SessionManifest;
  plan?: ReturnType<typeof PlanSchema.parse>;
  policyAudit?: ReturnType<typeof PolicyAuditResultSchema.parse>;
  policyDecision?: ReturnType<typeof PolicyEvaluationSchema.parse>;
  run: Run;
  runnerResult?: RunnerResult;
  spec?: ReturnType<typeof SpecSchema.parse>;
}

const sessionManifestRelativePath = 'session.manifest.json';
const progressLatestRelativePath = 'progress.latest.json';
const checkpointDirectory = 'checkpoints';
const progressDirectory = 'progress';
const sessionsDirectory = 'sessions';
const continuityDirectory = 'continuity';
const resumeDirectory = 'resume';
const workspaceLatestRelativePath = 'workspace.latest.json';

const activeRunStatuses = new Set<Run['status']>([
  'created',
  'planning',
  'running',
  'in_progress',
  'resuming',
  'verifying',
]);

function assertSupportedRunner(
  value: string,
): asserts value is (typeof supportedRunnerValues)[number] {
  if (!supportedRunnerValues.includes(value as (typeof supportedRunnerValues)[number])) {
    throw new Error(
      `Unsupported runner "${value}". Expected one of: ${supportedRunnerValues.join(', ')}.`,
    );
  }
}

function assertSupportedApprovalMode(
  value: string,
): asserts value is (typeof supportedApprovalModeValues)[number] {
  if (
    !supportedApprovalModeValues.includes(value as (typeof supportedApprovalModeValues)[number])
  ) {
    throw new Error(
      `Unsupported approval mode "${value}". Expected one of: ${supportedApprovalModeValues.join(', ')}.`,
    );
  }
}

async function assertReadableFile(filePath: string): Promise<void> {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new Error(`File "${filePath}" does not exist or is not readable.`);
  }
}

async function readJsonArtifact<T>(
  filePath: string,
  parser: { parse(value: unknown): T },
  label: string,
): Promise<T> {
  try {
    return parser.parse(JSON.parse(await readFile(filePath, 'utf8')));
  } catch (error) {
    throw new Error(
      `Could not read ${label} from "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readOptionalJsonArtifact<T>(
  filePath: string,
  parser: { parse(value: unknown): T },
): Promise<T | undefined> {
  try {
    return parser.parse(JSON.parse(await readFile(filePath, 'utf8')));
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;

    if (fileError.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

async function readOptionalTextArtifact(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;

    if (fileError.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

async function readTextArtifact(filePath: string, label: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `Could not read ${label} from "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function createSkippedClaimVerificationSummary(reason: string): ClaimVerificationSummary {
  return {
    status: 'failed',
    summary: reason,
    totalClaims: 0,
    passedClaims: 0,
    failedClaims: 0,
    results: [],
  };
}

function checkpointRelativePath(checkpointId: string): string {
  return `${checkpointDirectory}/${checkpointId}.json`;
}

function progressRelativePath(progressId: string): string {
  return `${progressDirectory}/${progressId}.json`;
}

function sessionRelativePath(sessionId: string): string {
  return `${sessionsDirectory}/${sessionId}.json`;
}

function continuityRelativePath(assessmentId: string): string {
  return `${continuityDirectory}/${assessmentId}.json`;
}

function resumePlanRelativePath(planId: string): string {
  return `${resumeDirectory}/${planId}.json`;
}

function stageLabel(stage: RunStage | undefined): string {
  return stage ?? 'unknown';
}

function stageAfterCheckpoint(stage: RunStage | undefined): RunStage | undefined {
  switch (stage) {
    case 'spec_normalized':
      return 'plan_created';
    case 'plan_created':
      return 'policy_evaluated';
    case 'policy_evaluated':
      return 'awaiting_approval';
    case 'approval_resolved':
      return 'runner_started';
    case 'runner_completed':
      return 'verification_started';
    case 'verification_completed':
      return undefined;
    default:
      return stage;
  }
}

async function persistRunSession(
  artifactStore: ReturnType<typeof createArtifactStore>,
  session: RunSession,
): Promise<ArtifactReference> {
  return artifactStore.writeJsonArtifact(
    'run-session',
    sessionRelativePath(session.id),
    session,
    'Durable session record for a governed run invocation.',
  );
}

async function persistSessionManifest(
  artifactStore: ReturnType<typeof createArtifactStore>,
  manifest: SessionManifest,
): Promise<ArtifactReference> {
  return artifactStore.writeJsonArtifact(
    'session-manifest',
    sessionManifestRelativePath,
    manifest,
    'Durable run/session manifest for status inspection and resume.',
  );
}

async function persistRunCheckpoint(
  artifactStore: ReturnType<typeof createArtifactStore>,
  checkpoint: RunCheckpoint,
): Promise<ArtifactReference> {
  return artifactStore.writeJsonArtifact(
    'run-checkpoint',
    checkpointRelativePath(checkpoint.id),
    checkpoint,
    'Restart-safe checkpoint for the governed run lifecycle.',
  );
}

async function persistProgressSnapshot(
  artifactStore: ReturnType<typeof createArtifactStore>,
  progress: RunProgressSnapshot,
): Promise<{ latest: ArtifactReference; history: ArtifactReference }> {
  const history = await artifactStore.writeJsonArtifact(
    'progress-snapshot',
    progressRelativePath(progress.id),
    progress,
    'Durable progress snapshot for the governed run lifecycle.',
  );
  const latest = await artifactStore.writeJsonArtifact(
    'progress-latest',
    progressLatestRelativePath,
    progress,
    'Most recent durable progress snapshot for the run.',
  );

  return { history, latest };
}

async function persistWorkspaceState(
  artifactStore: ReturnType<typeof createArtifactStore>,
  snapshot: WorkspaceSnapshot,
): Promise<ArtifactReference> {
  return artifactStore.writeJsonArtifact(
    'workspace-snapshot',
    workspaceLatestRelativePath,
    snapshot,
    'Latest workspace continuity snapshot for this run.',
  );
}

async function persistContinuityAssessment(
  artifactStore: ReturnType<typeof createArtifactStore>,
  assessment: ReturnType<typeof createContinuityAssessmentRecord>,
): Promise<ArtifactReference> {
  return artifactStore.writeJsonArtifact(
    'continuity-assessment',
    continuityRelativePath(assessment.id),
    assessment,
    'Workspace continuity assessment for a resume or status inspection.',
  );
}

async function persistResumePlan(
  artifactStore: ReturnType<typeof createArtifactStore>,
  plan: ReturnType<typeof createResumePlanRecord>,
): Promise<ArtifactReference> {
  return artifactStore.writeJsonArtifact(
    'resume-plan',
    resumePlanRelativePath(plan.id),
    plan,
    'Deterministic resume plan for the next safe stage.',
  );
}

async function loadRunContext(repoRoot: string, runId: string): Promise<LoadedRunContext> {
  const runDirectory = resolveRunDirectory(repoRoot, runId);

  await assertReadableFile(resolve(runDirectory, 'run.json'));

  const run = await readJsonArtifact(resolve(runDirectory, 'run.json'), RunSchema, 'run record');
  const spec = await readJsonArtifact(
    resolve(runDirectory, 'spec.normalized.json'),
    SpecSchema,
    'normalized spec',
  );
  const plan = await readJsonArtifact(resolve(runDirectory, 'plan.json'), PlanSchema, 'plan');
  const runnerResult = await readJsonArtifact(
    resolve(runDirectory, 'runner.result.json'),
    RunnerResultSchema,
    'runner result',
  );
  const changedFiles = await readJsonArtifact(
    resolve(runDirectory, 'changed-files.json'),
    ChangedFileCaptureSchema,
    'changed files',
  );
  const manifest = await readOptionalJsonArtifact(
    resolve(runDirectory, sessionManifestRelativePath),
    SessionManifestSchema,
  );
  const latestProgress = await readOptionalJsonArtifact(
    resolve(runDirectory, progressLatestRelativePath),
    RunProgressSnapshotSchema,
  );
  const policyDecision = await readJsonArtifact(
    resolve(runDirectory, 'policy.decision.json'),
    PolicyEvaluationSchema,
    'policy decision',
  );
  const policyAudit = await readOptionalJsonArtifact(
    resolve(runDirectory, 'policy-audit.json'),
    PolicyAuditResultSchema,
  );
  const approvalPacket = await readOptionalJsonArtifact(
    resolve(runDirectory, 'approval-packet.json'),
    ApprovalPacketSchema,
  );
  const approvalResolutionRecord = await readOptionalJsonArtifact(
    resolve(runDirectory, 'approval-resolution.json'),
    ApprovalResolutionRecordSchema,
  );
  const commandCapture = await readJsonArtifact(
    resolve(runDirectory, 'commands-executed.json'),
    CommandCaptureSchema,
    'command capture',
  );
  const diffPatch = await readTextArtifact(resolve(runDirectory, 'diff.patch'), 'diff patch');
  const latestCheckpoint = manifest?.lastCheckpointId
    ? await readOptionalJsonArtifact(
        resolve(runDirectory, checkpointRelativePath(manifest.lastCheckpointId)),
        RunCheckpointSchema,
      )
    : undefined;

  return {
    latestCheckpoint,
    latestProgress,
    manifest,
    approvalPacket,
    approvalResolution: approvalResolutionRecord?.resolution,
    changedFiles,
    commandCapture,
    diffPatch,
    plan,
    policyAudit,
    policyDecision,
    run,
    runnerResult,
    spec,
  };
}

async function loadDurableRunState(
  repoRoot: string,
  runId: string,
): Promise<LoadedDurableRunState> {
  const runDirectory = resolveRunDirectory(repoRoot, runId);
  const run = await readJsonArtifact(resolve(runDirectory, 'run.json'), RunSchema, 'run record');
  const manifest = await readJsonArtifact(
    resolve(runDirectory, sessionManifestRelativePath),
    SessionManifestSchema,
    'session manifest',
  );

  const [
    spec,
    plan,
    policyDecision,
    approvalPacket,
    approvalResolutionRecord,
    runnerResult,
    changedFiles,
    policyAudit,
    commandCapture,
    latestProgress,
    latestCheckpoint,
    diffPatch,
  ] = await Promise.all([
    readOptionalJsonArtifact(resolve(runDirectory, 'spec.normalized.json'), SpecSchema),
    readOptionalJsonArtifact(resolve(runDirectory, 'plan.json'), PlanSchema),
    readOptionalJsonArtifact(resolve(runDirectory, 'policy.decision.json'), PolicyEvaluationSchema),
    readOptionalJsonArtifact(resolve(runDirectory, 'approval-packet.json'), ApprovalPacketSchema),
    readOptionalJsonArtifact(
      resolve(runDirectory, 'approval-resolution.json'),
      ApprovalResolutionRecordSchema,
    ),
    readOptionalJsonArtifact(resolve(runDirectory, 'runner.result.json'), RunnerResultSchema),
    readOptionalJsonArtifact(resolve(runDirectory, 'changed-files.json'), ChangedFileCaptureSchema),
    readOptionalJsonArtifact(resolve(runDirectory, 'policy-audit.json'), PolicyAuditResultSchema),
    readOptionalJsonArtifact(resolve(runDirectory, 'commands-executed.json'), CommandCaptureSchema),
    readOptionalJsonArtifact(
      resolve(runDirectory, progressLatestRelativePath),
      RunProgressSnapshotSchema,
    ),
    manifest.lastCheckpointId
      ? readOptionalJsonArtifact(
          resolve(runDirectory, checkpointRelativePath(manifest.lastCheckpointId)),
          RunCheckpointSchema,
        )
      : Promise.resolve(undefined),
    readOptionalTextArtifact(resolve(runDirectory, 'diff.patch')),
  ]);

  return {
    approvalPacket,
    approvalResolution: approvalResolutionRecord?.resolution,
    changedFiles,
    commandCapture,
    diffPatch,
    latestCheckpoint,
    latestProgress,
    manifest,
    plan,
    policyAudit,
    policyDecision,
    run,
    runnerResult,
    spec,
  };
}

function isTerminalStatus(status: Run['status']): boolean {
  return ['completed', 'failed', 'cancelled', 'abandoned'].includes(status);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}

function determineNextStage(state: {
  manifest: SessionManifest;
  latestCheckpoint?: RunCheckpoint;
  run: Run;
}): RunStage | undefined {
  if (state.manifest.pendingStage) {
    return state.manifest.pendingStage;
  }

  if (state.manifest.status === 'awaiting_approval') {
    return 'awaiting_approval';
  }

  if (state.latestCheckpoint) {
    return stageAfterCheckpoint(state.latestCheckpoint.stage);
  }

  if (state.run.currentStage === 'created') {
    return 'spec_normalized';
  }

  return stageAfterCheckpoint(state.run.currentStage);
}

function requiredArtifactsForNextStage(
  state: LoadedDurableRunState,
  nextStage: RunStage | undefined,
): string[] {
  const runDirectory = state.run.runDirectory;
  const baseArtifacts = [
    resolve(runDirectory, 'run.json'),
    resolve(runDirectory, sessionManifestRelativePath),
  ];

  switch (nextStage) {
    case 'spec_normalized':
      return baseArtifacts;
    case 'plan_created':
      return [...baseArtifacts, resolve(runDirectory, 'spec.normalized.json')];
    case 'policy_evaluated':
      return [
        ...baseArtifacts,
        resolve(runDirectory, 'spec.normalized.json'),
        resolve(runDirectory, 'plan.json'),
      ];
    case 'awaiting_approval':
      return [
        ...baseArtifacts,
        resolve(runDirectory, 'spec.normalized.json'),
        resolve(runDirectory, 'plan.json'),
        resolve(runDirectory, 'policy.decision.json'),
        resolve(runDirectory, 'approval-packet.json'),
      ];
    case 'approval_resolved':
      return [...baseArtifacts, resolve(runDirectory, 'policy.decision.json')];
    case 'runner_started':
      return [
        ...baseArtifacts,
        resolve(runDirectory, 'spec.normalized.json'),
        resolve(runDirectory, 'plan.json'),
        resolve(runDirectory, 'policy.decision.json'),
        ...(state.manifest.approvalState.required
          ? [resolve(runDirectory, 'approval-resolution.json')]
          : []),
      ];
    case 'verification_started':
      return [
        ...baseArtifacts,
        resolve(runDirectory, 'runner.result.json'),
        resolve(runDirectory, 'commands-executed.json'),
        resolve(runDirectory, 'changed-files.json'),
        resolve(runDirectory, 'diff.patch'),
        resolve(runDirectory, 'policy-audit.json'),
      ];
    case 'verification_completed':
      return [...baseArtifacts, resolve(runDirectory, 'verification.result.json')];
    default:
      return baseArtifacts;
  }
}

function assessWorkspaceContinuity(input: {
  runId: string;
  requiredArtifactPaths: string[];
  storedSnapshot?: WorkspaceSnapshot;
  currentSnapshot: WorkspaceSnapshot;
}): ReturnType<typeof createContinuityAssessmentRecord> {
  if (!input.storedSnapshot) {
    return createContinuityAssessmentRecord({
      runId: input.runId,
      status: 'warning',
      summary:
        'No stored workspace snapshot was available, so continuity could only be assessed partially.',
      reasons: ['The run does not yet have a persisted workspace continuity baseline.'],
      storedSnapshot: createWorkspaceSnapshotRecord({
        repoRoot: input.currentSnapshot.repoRoot,
        workingDirectory: input.currentSnapshot.workingDirectory,
        gitAvailable: false,
      }),
      currentSnapshot: input.currentSnapshot,
    });
  }

  const reasons: string[] = [];
  const missingArtifactPaths = input.requiredArtifactPaths.filter(
    (artifactPath) => !input.currentSnapshot.expectedArtifactPaths.includes(artifactPath),
  );
  const changedKnownRunFiles = input.storedSnapshot.knownRunChangedFiles.filter((filePath) =>
    input.currentSnapshot.changedFiles.includes(filePath),
  );

  let status: WorkspaceCompatibility = 'compatible';

  if (input.storedSnapshot.repoRoot !== input.currentSnapshot.repoRoot) {
    status = 'incompatible';
    reasons.push('The current repository root does not match the stored run manifest.');
  }

  if (
    input.storedSnapshot.gitAvailable &&
    input.currentSnapshot.gitAvailable &&
    input.storedSnapshot.gitHead &&
    input.currentSnapshot.gitHead &&
    input.storedSnapshot.gitHead !== input.currentSnapshot.gitHead
  ) {
    status = 'incompatible';
    reasons.push('Git HEAD changed since the last durable workspace snapshot.');
  }

  if (missingArtifactPaths.length > 0) {
    status = 'incompatible';
    reasons.push('One or more expected run artifacts are missing from the run directory.');
  }

  if (
    status !== 'incompatible' &&
    (!input.storedSnapshot.gitAvailable || !input.currentSnapshot.gitAvailable)
  ) {
    status = 'warning';
    reasons.push('Git metadata was unavailable for part of the continuity assessment.');
  }

  if (
    status === 'compatible' &&
    input.storedSnapshot.dirtyWorkingTree !== null &&
    input.currentSnapshot.dirtyWorkingTree !== null &&
    input.storedSnapshot.dirtyWorkingTree !== input.currentSnapshot.dirtyWorkingTree
  ) {
    status = 'warning';
    reasons.push('Dirty working tree state changed since the stored workspace snapshot.');
  }

  const currentChangeSet = new Set(input.currentSnapshot.changedFiles);
  const storedChangeSet = new Set(input.storedSnapshot.changedFiles);
  const driftedFiles = [...currentChangeSet].filter((filePath) => !storedChangeSet.has(filePath));

  if (status === 'compatible' && driftedFiles.length > 0) {
    status = 'warning';
    reasons.push('Additional working-tree file changes were detected since the last checkpoint.');
  }

  if (reasons.length === 0) {
    reasons.push('Stored workspace signals are consistent with the current repo state.');
  }

  return createContinuityAssessmentRecord({
    runId: input.runId,
    status,
    summary:
      status === 'compatible'
        ? 'Workspace continuity is compatible with the stored run manifest.'
        : status === 'warning'
          ? 'Workspace continuity has warnings but is still inspectable for resume planning.'
          : 'Workspace continuity is incompatible with the stored run manifest.',
    reasons,
    missingArtifactPaths,
    changedKnownRunFiles,
    storedSnapshot: input.storedSnapshot,
    currentSnapshot: input.currentSnapshot,
  });
}

function evaluateResumeEligibility(input: {
  state: LoadedDurableRunState;
  continuity: ReturnType<typeof createContinuityAssessmentRecord>;
}): ResumeEligibility {
  const nextStage = determineNextStage(input.state);
  const requiredArtifactPaths = requiredArtifactsForNextStage(input.state, nextStage);
  const reasons: string[] = [];

  if (input.continuity.status === 'incompatible') {
    reasons.push(...input.continuity.reasons);
  }

  if (['completed', 'abandoned', 'cancelled'].includes(input.state.manifest.status)) {
    reasons.push(`Run status "${input.state.manifest.status}" is terminal and cannot be resumed.`);
  }

  if (input.state.manifest.approvalState.status === 'denied') {
    reasons.push('Approval was denied for this run.');
  }

  if (!nextStage) {
    reasons.push('No next safe stage was available from the stored checkpoint state.');
  }

  if (
    input.state.latestCheckpoint &&
    !input.state.latestCheckpoint.restartable &&
    !input.state.latestCheckpoint.rerunStageOnResume
  ) {
    reasons.push('The latest checkpoint is not safe to resume or rerun from.');
  }

  if (input.continuity.missingArtifactPaths.length > 0) {
    reasons.push('One or more required checkpoint artifacts are missing.');
  }

  if (
    input.state.run.verificationStatus === 'failed' &&
    input.state.manifest.pendingStage !== 'verification_started'
  ) {
    reasons.push('The run already has a terminal failed verification result.');
  }

  const eligible = reasons.length === 0;

  return createResumeEligibilityRecord({
    eligible,
    nextStage,
    reasons,
    requiredArtifactPaths,
    summary: eligible
      ? `Run can resume from "${stageLabel(nextStage)}".`
      : 'Run cannot be resumed from the current durable state.',
  });
}

function buildContinuationContext(input: {
  manifest: SessionManifest;
  run: Run;
  requiredArtifactPaths: string[];
}): ContinuationContext {
  return ContinuationContextSchema.parse({
    runId: input.run.id,
    repoRoot: input.run.repoRoot,
    runDirectory: input.run.runDirectory,
    sessionManifestPath: resolve(input.run.runDirectory, sessionManifestRelativePath),
    progressPath: input.manifest.lastProgressSnapshotId
      ? resolve(input.run.runDirectory, progressLatestRelativePath)
      : undefined,
    lastCheckpointPath: input.manifest.lastCheckpointId
      ? resolve(input.run.runDirectory, checkpointRelativePath(input.manifest.lastCheckpointId))
      : undefined,
    lastCheckpointId: input.manifest.lastCheckpointId,
    pendingStage: input.manifest.pendingStage,
    requiredArtifactPaths: input.requiredArtifactPaths,
  });
}

function buildResumePlan(input: {
  state: LoadedDurableRunState;
  eligibility: ResumeEligibility;
}): ReturnType<typeof createResumePlanRecord> | undefined {
  if (!input.eligibility.eligible || !input.eligibility.nextStage) {
    return undefined;
  }

  const nextStage = input.eligibility.nextStage;

  return createResumePlanRecord({
    runId: input.state.run.id,
    fromStatus: input.state.manifest.status,
    nextStage,
    sourceCheckpointId: input.state.manifest.lastCheckpointId,
    lastSuccessfulStage: input.state.manifest.lastSuccessfulStage,
    rerunStages:
      nextStage === 'runner_started' || nextStage === 'verification_started' ? [nextStage] : [],
    actions:
      nextStage === 'awaiting_approval'
        ? ['Load the persisted approval packet and resolve the pending approval state.']
        : nextStage === 'verification_started'
          ? ['Re-enter deterministic verification from a clean verification boundary.']
          : [`Continue the governed run from "${stageLabel(nextStage)}".`],
    approvalStrategy:
      input.state.manifest.approvalState.status === 'pending'
        ? 'resolve_pending'
        : input.state.manifest.approvalState.status === 'approved'
          ? 'reuse_existing'
          : 'not_needed',
    verificationStrategy:
      nextStage === 'verification_started' ? 'rerun_verification' : 'not_needed',
    summary: `Resume from "${stageLabel(nextStage)}" using persisted checkpoint state.`,
  });
}

async function prepareRunInspection(
  runId: string,
  repoRoot: string,
  options?: { emitStatusRequested?: boolean },
): Promise<{
  artifactStore: ReturnType<typeof createArtifactStore>;
  continuity: ReturnType<typeof createContinuityAssessmentRecord>;
  eligibility: ResumeEligibility;
  latestCheckpoint?: RunCheckpoint;
  latestProgress?: RunProgressSnapshot;
  manifest: SessionManifest;
  resumePlan?: ReturnType<typeof createResumePlanRecord>;
  run: Run;
  spec?: ReturnType<typeof SpecSchema.parse>;
  state: LoadedDurableRunState;
}> {
  const artifactStore = createArtifactStore({ repoRoot, runId });

  await artifactStore.initialize();

  const initialState = await loadDurableRunState(repoRoot, runId);
  let run = initialState.run;
  let manifest = initialState.manifest;
  let session = manifest.currentSessionId
    ? await readOptionalJsonArtifact(
        resolve(run.runDirectory, sessionRelativePath(manifest.currentSessionId)),
        RunSessionSchema,
      )
    : undefined;

  const emitEvent = async (
    type: RunEventType,
    payload: Record<string, unknown>,
  ): Promise<ArtifactReference> => {
    return artifactStore.appendEvent(createRunEvent(run.id, type, payload));
  };

  if (options?.emitStatusRequested) {
    await emitEvent('status.requested', {
      currentStage: manifest.currentStage,
      status: manifest.status,
    });
  }

  if (activeRunStatuses.has(manifest.status)) {
    const interruptionSummary = `The previous session stopped before "${stageLabel(determineNextStage(initialState) ?? manifest.currentStage)}" completed.`;

    run = updateRunStatus(run, 'interrupted', interruptionSummary);
    run = updateRunStage(run, {
      currentStage: run.currentStage,
      pendingStage: determineNextStage(initialState),
      interruptionReason: interruptionSummary,
    });
    await persistRunStatus(artifactStore, run);

    if (session) {
      session = updateRunSessionRecord(
        session,
        {
          status: 'interrupted',
          summary: interruptionSummary,
          interruptionReason: interruptionSummary,
          endedAt: createIsoTimestamp(),
        },
        createIsoTimestamp(),
      );
      await persistRunSession(artifactStore, session);
    }

    const interruptionProgress = createRunProgressSnapshotRecord({
      runId: run.id,
      sessionId: session?.id ?? manifest.currentSessionId,
      stage: run.currentStage,
      status: 'interrupted',
      justCompleted: `Interruption was detected after "${stageLabel(run.lastSuccessfulStage)}".`,
      remaining: [`Resume from "${stageLabel(determineNextStage(initialState))}".`],
      blockers: ['The previous CLI invocation ended before the pending stage completed.'],
      currentRisks: ['Resume will rely on the stored checkpoint and current workspace continuity.'],
      approvedScope: initialState.policyDecision?.affectedPaths ?? [],
      verificationState: run.verificationStatus,
      artifactPaths: [],
      nextRecommendedStep: `Inspect the run with "gdh status ${run.id}" or continue with "gdh resume ${run.id}".`,
      summary: interruptionSummary,
    });
    const interruptionProgressArtifacts = await persistProgressSnapshot(
      artifactStore,
      interruptionProgress,
    );
    manifest = updateSessionManifestRecord(manifest, {
      status: 'interrupted',
      interruption: {
        detectedAt: createIsoTimestamp(),
        reason: 'previous_session_ended',
        summary: interruptionSummary,
      },
      lastProgressSnapshotId: interruptionProgress.id,
      summary: interruptionSummary,
    });
    await emitEvent('run.interrupted', {
      status: 'interrupted',
      summary: interruptionSummary,
    });
    manifest = updateSessionManifestRecord(manifest, {
      artifactPaths: {
        ...manifest.artifactPaths,
        progressLatest: interruptionProgressArtifacts.latest.path,
      },
    });
  }

  const requiredArtifactPaths = requiredArtifactsForNextStage(
    initialState,
    determineNextStage({
      manifest,
      latestCheckpoint: initialState.latestCheckpoint,
      run,
    }),
  );
  const currentWorkspaceSnapshot = await captureWorkspaceState(repoRoot, {
    expectedArtifactPaths: requiredArtifactPaths,
    knownRunChangedFiles:
      initialState.changedFiles?.files.map((file) => file.path) ??
      manifest.workspace.lastSnapshot?.knownRunChangedFiles ??
      [],
    workingDirectory: repoRoot,
  });
  const workspaceArtifact = await persistWorkspaceState(artifactStore, currentWorkspaceSnapshot);
  const continuity = assessWorkspaceContinuity({
    runId: run.id,
    requiredArtifactPaths,
    storedSnapshot: manifest.workspace.lastSnapshot,
    currentSnapshot: currentWorkspaceSnapshot,
  });
  const continuityArtifact = await persistContinuityAssessment(artifactStore, continuity);
  const eligibility = evaluateResumeEligibility({
    state: {
      ...initialState,
      manifest,
      run,
    },
    continuity,
  });
  const continuationContext = buildContinuationContext({
    manifest,
    run,
    requiredArtifactPaths: eligibility.requiredArtifactPaths,
  });
  const resumePlan = buildResumePlan({
    state: {
      ...initialState,
      manifest,
      run,
    },
    eligibility,
  });
  const resumePlanArtifact = resumePlan
    ? await persistResumePlan(artifactStore, resumePlan)
    : undefined;

  const nextStatus =
    manifest.status === 'awaiting_approval'
      ? 'awaiting_approval'
      : eligibility.eligible && !isTerminalStatus(run.status)
        ? 'resumable'
        : run.status;
  run = updateRunStatus(run, nextStatus, eligibility.summary);
  run = updateRunStage(run, {
    currentStage: run.currentStage,
    pendingStage: eligibility.nextStage,
    summary: eligibility.summary,
  });
  run = updateRunResumeEligibility(run, eligibility);
  await persistRunStatus(artifactStore, run);

  manifest = updateSessionManifestRecord(manifest, {
    status: nextStatus,
    resumeEligibility: eligibility,
    continuationContext,
    latestContinuityAssessmentPath: continuityArtifact.path,
    latestResumePlanPath: resumePlanArtifact?.path,
    artifactPaths: {
      ...manifest.artifactPaths,
      workspaceLatest: workspaceArtifact.path,
      continuityLatest: continuityArtifact.path,
      ...(resumePlanArtifact ? { resumePlanLatest: resumePlanArtifact.path } : {}),
    },
    summary: eligibility.summary,
  });
  await persistSessionManifest(artifactStore, manifest);

  if (nextStatus === 'resumable') {
    await emitEvent('run.marked_resumable', {
      nextStage: eligibility.nextStage,
      summary: eligibility.summary,
    });
  }

  return {
    artifactStore,
    continuity,
    eligibility,
    latestCheckpoint: initialState.latestCheckpoint,
    latestProgress: initialState.latestProgress,
    manifest,
    resumePlan,
    run,
    spec: initialState.spec,
    state: {
      ...initialState,
      manifest,
      run,
    },
  };
}

function createRunner(kind: (typeof supportedRunnerValues)[number]): Runner {
  return kind === 'fake' ? createFakeRunner() : createCodexCliRunner();
}

function createEmptyCommandCapture(note: string): CommandCapture {
  return CommandCaptureSchema.parse({
    commands: [],
    completeness: 'complete',
    notes: [note],
    source: 'governed_cli',
  });
}

function createSkippedRunnerResult(summary: string): RunnerResult {
  return RunnerResultSchema.parse({
    artifactsProduced: [],
    commandCapture: createEmptyCommandCapture(
      'The write-capable runner did not execute because the policy gate stopped the run first.',
    ),
    durationMs: 0,
    exitCode: 0,
    limitations: [
      'Execution did not start because the policy gate stopped or paused the run before write-capable execution.',
    ],
    metadata: {
      executed: false,
    },
    prompt: '',
    reportedChangedFiles: [],
    reportedChangedFilesCompleteness: 'complete',
    reportedChangedFilesNotes: ['No changed files were reported because execution never started.'],
    status: 'blocked',
    stderr: '',
    stdout: '',
    summary,
  });
}

function eventTypeForRunnerStatus(status: RunnerResult['status']): RunEventType {
  return status === 'completed' ? 'runner.completed' : 'runner.failed';
}

function eventTypeForFinalRunStatus(status: Run['status']): RunEventType | null {
  if (status === 'completed') {
    return 'run.completed';
  }

  if (status === 'failed' || status === 'cancelled' || status === 'abandoned') {
    return 'run.failed';
  }

  return null;
}

function exitCodeForRunStatus(status: Run['status']): number {
  if (status === 'completed') {
    return 0;
  }

  if (status === 'awaiting_approval') {
    return 2;
  }

  if (status === 'resumable') {
    return 3;
  }

  return 1;
}

function formatTerminalSummary(summary: RunCommandSummary): string {
  return [
    `Run ${summary.status}: ${summary.runId}`,
    `Spec: ${summary.specTitle}`,
    `Summary: ${summary.summary}`,
    `Policy decision: ${summary.policyDecision ?? 'not_evaluated'}`,
    `Verification status: ${summary.verificationStatus}`,
    `Approval resolution: ${summary.approvalResolution ?? 'not_required'}`,
    summary.currentStage ? `Current stage: ${summary.currentStage}` : 'Current stage: unknown',
    summary.lastCompletedStage
      ? `Last completed stage: ${summary.lastCompletedStage}`
      : 'Last completed stage: none',
    summary.nextStage ? `Next stage: ${summary.nextStage}` : 'Next stage: none',
    summary.resumeSummary
      ? `Resume: ${summary.resumeSummary}`
      : `Resume eligible: ${summary.resumeEligible ? 'yes' : 'no'}`,
    `Artifacts: ${summary.artifactsDirectory}`,
    summary.manifestPath ? `Manifest: ${summary.manifestPath}` : 'Manifest: none',
    `Review packet: ${summary.reviewPacketPath}`,
    `Policy audit: ${summary.policyAuditPath}`,
    summary.verificationResultPath
      ? `Verification result: ${summary.verificationResultPath}`
      : 'Verification result: none',
    summary.approvalPacketPath
      ? `Approval packet: ${summary.approvalPacketPath}`
      : 'Approval packet: none',
    `Changed files: ${summary.changedFiles.length > 0 ? summary.changedFiles.join(', ') : 'none'}`,
    `Commands captured: ${
      summary.commandsExecuted.length > 0
        ? summary.commandsExecuted
            .map((command) => `${command.command} [${command.provenance}]`)
            .join(', ')
        : 'none'
    }`,
  ].join('\n');
}

function defaultApprovalMode(): ApprovalMode {
  return process.stdin.isTTY && process.stdout.isTTY ? 'interactive' : 'fail';
}

function formatApprovalPromptSummary(packet: ApprovalPacket): string {
  return [
    `Approval required for run ${packet.runId}`,
    `Approval ID: ${packet.id}`,
    `Spec: ${packet.specTitle}`,
    `Summary: ${packet.decisionSummary}`,
    `Affected paths: ${packet.affectedPaths.length > 0 ? packet.affectedPaths.join(', ') : 'none'}`,
    `Predicted commands: ${
      packet.predictedCommands.length > 0 ? packet.predictedCommands.join(', ') : 'none'
    }`,
    `Why: ${
      packet.whyApprovalIsRequired.length > 0
        ? packet.whyApprovalIsRequired.join(' | ')
        : 'No explicit reason recorded.'
    }`,
  ].join('\n');
}

async function promptForApproval(packet: ApprovalPacket): Promise<ApprovalResolution> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log(formatApprovalPromptSummary(packet));

    while (true) {
      const answer = (await readline.question('Approve this run? [approve/deny]: '))
        .trim()
        .toLowerCase();

      if (['a', 'approve', 'approved', 'y', 'yes'].includes(answer)) {
        return 'approved';
      }

      if (['d', 'deny', 'denied', 'n', 'no'].includes(answer)) {
        return 'denied';
      }
    }
  } finally {
    readline.close();
  }
}

async function persistRunStatus(
  artifactStore: ReturnType<typeof createArtifactStore>,
  run: Run,
): Promise<ArtifactReference> {
  return artifactStore.writeRun(run);
}

export async function runSpecFile(
  specFile: string,
  options: RunCommandOptions = {},
): Promise<RunCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const runnerKind = options.runner ?? 'codex-cli';
  const approvalMode = options.approvalMode ?? defaultApprovalMode();

  assertSupportedRunner(runnerKind);
  assertSupportedApprovalMode(approvalMode);

  const repoRoot = await findRepoRoot(cwd);
  const absoluteSpecPath = resolve(cwd, specFile);
  const absolutePolicyPath = resolve(
    cwd,
    options.policyPath ?? resolve(repoRoot, 'policies/default.policy.yaml'),
  );

  await assertReadableFile(absoluteSpecPath);
  await assertReadableFile(absolutePolicyPath);

  const sourceContent = await readFile(absoluteSpecPath, 'utf8');
  const normalizedSpec = normalizeMarkdownSpec({
    content: sourceContent,
    repoRoot,
    sourcePath: absoluteSpecPath,
  });
  const plan = createPlanFromSpec(normalizedSpec);
  const { pack: policyPack, path: loadedPolicyPath } =
    await loadPolicyPackFromFile(absolutePolicyPath);
  const verificationConfig = await loadVerificationConfig(repoRoot);
  const runId = createRunId(normalizedSpec.title);
  const artifactStore = createArtifactStore({
    repoRoot,
    runId,
  });

  await artifactStore.initialize();

  const excludedRunPrefix = createRunRelativeDirectory(repoRoot, artifactStore.runDirectory);
  const beforeSnapshot = await captureWorkspaceSnapshot(repoRoot, {
    excludePrefixes: [excludedRunPrefix],
  });
  let run = createRunRecord({
    approvalMode,
    approvalPolicy: policyPack.defaults.approvalPolicy,
    createdAt: createIsoTimestamp(),
    model: defaultRunnerDefaults.model,
    networkAccess: policyPack.defaults.networkAccess,
    plan,
    policyPackName: policyPack.name,
    policyPackPath: loadedPolicyPath,
    policyPackVersion: policyPack.version,
    repoRoot,
    runDirectory: artifactStore.runDirectory,
    runId,
    runner: runnerKind as RunnerKind,
    sandboxMode: policyPack.defaults.sandboxMode,
    spec: normalizedSpec,
  });
  let session = createRunSessionRecord({
    runId,
    trigger: 'run',
    startStage: 'created',
    summary: 'Governed run session created.',
  });
  run = updateRunStage(run, {
    currentStage: 'created',
    pendingStage: 'spec_normalized',
    sessionId: session.id,
    summary: 'Governed run created and waiting to persist normalized artifacts.',
  });
  const initialWorkspaceSnapshot = await captureWorkspaceState(repoRoot, {
    expectedArtifactPaths: [
      artifactStore.resolveArtifactPath('run.json'),
      artifactStore.resolveArtifactPath(sessionManifestRelativePath),
    ],
    knownRunChangedFiles: [],
    workingDirectory: cwd,
  });
  let manifest = createSessionManifestRecord({
    run,
    currentSession: session,
    approvalState: {
      required: false,
      status: 'not_required',
      artifactPaths: [],
    },
    artifactPaths: {
      run: artifactStore.resolveArtifactPath('run.json'),
      sessionManifest: artifactStore.resolveArtifactPath(sessionManifestRelativePath),
    },
    pendingActions: [],
    resumeEligibility: createResumeEligibilityRecord({
      eligible: false,
      reasons: ['The run is still in progress and cannot be resumed yet.'],
      requiredArtifactPaths: [],
      summary: 'Resume is not available while the initial run invocation is still active.',
    }),
    summary: run.summary ?? 'Governed run created.',
    workspaceLastSnapshot: initialWorkspaceSnapshot,
  });

  const emitEvent = async (
    type: RunEventType,
    payload: Record<string, unknown>,
  ): Promise<ArtifactReference> => {
    return artifactStore.appendEvent(createRunEvent(run.id, type, payload));
  };

  await persistRunStatus(artifactStore, run);
  await persistRunSession(artifactStore, session);
  await persistWorkspaceState(artifactStore, initialWorkspaceSnapshot);
  const manifestArtifact = await persistSessionManifest(artifactStore, manifest);
  run = RunSchema.parse({
    ...run,
    sessionManifestPath: manifestArtifact.path,
  });
  manifest = updateSessionManifestRecord(manifest, {
    artifactPaths: {
      ...manifest.artifactPaths,
      sessionManifest: manifestArtifact.path,
    },
  });
  await persistRunStatus(artifactStore, run);
  await persistSessionManifest(artifactStore, manifest);
  await emitEvent('run.created', {
    approvalMode,
    manifestPath: manifestArtifact.path,
    planId: plan.id,
    policyPackName: policyPack.name,
    policyPackPath: loadedPolicyPath,
    policyPackVersion: policyPack.version,
    runDirectory: artifactStore.runDirectory,
    runner: run.runner,
    sessionId: session.id,
    specId: normalizedSpec.id,
  });
  await emitEvent('session.started', {
    sessionId: session.id,
    stage: session.startStage,
    trigger: session.trigger,
  });

  const normalizedSpecArtifact = await artifactStore.writeJsonArtifact(
    'normalized-spec',
    'spec.normalized.json',
    normalizedSpec,
    'Normalized markdown spec for this run.',
  );
  await emitEvent('spec.normalized', {
    artifactPath: normalizedSpecArtifact.path,
    inferredFields: normalizedSpec.inferredFields,
    normalizationNotes: normalizedSpec.normalizationNotes,
  });
  const specCheckpoint = createRunCheckpointRecord({
    runId: run.id,
    sessionId: session.id,
    stage: 'spec_normalized',
    status: 'planning',
    requiredArtifactPaths: [artifactStore.resolveArtifactPath('run.json')],
    outputArtifactPaths: [normalizedSpecArtifact.path],
    restartable: true,
    rerunStageOnResume: false,
    resumeInstructions: ['Load the persisted normalized spec and continue with plan generation.'],
    lastSuccessfulStep: 'spec.normalized',
    pendingStep: 'plan.created',
    summary: 'Spec normalization completed and is safe to resume from plan generation.',
  });
  const specCheckpointArtifact = await persistRunCheckpoint(artifactStore, specCheckpoint);
  const specProgress = createRunProgressSnapshotRecord({
    runId: run.id,
    sessionId: session.id,
    stage: 'spec_normalized',
    status: 'planning',
    justCompleted: 'Normalized the source spec into the durable Spec artifact.',
    remaining: ['Generate the deterministic plan.', 'Evaluate policy before execution.'],
    currentRisks: normalizedSpec.riskHints,
    approvedScope: [],
    verificationState: 'not_run',
    artifactPaths: [normalizedSpecArtifact.path, specCheckpointArtifact.path],
    nextRecommendedStep: 'Create the governed plan and persist the next checkpoint.',
    summary: 'Spec normalization completed.',
  });
  const specProgressArtifacts = await persistProgressSnapshot(artifactStore, specProgress);
  session = updateRunSessionRecord(session, {
    currentStage: 'spec_normalized',
    lastProgressSnapshotId: specProgress.id,
    outputArtifactPaths: uniqueStrings([
      ...session.outputArtifactPaths,
      normalizedSpecArtifact.path,
      specCheckpointArtifact.path,
      specProgressArtifacts.history.path,
      specProgressArtifacts.latest.path,
    ]),
    summary: 'Spec normalization completed.',
  });
  await persistRunSession(artifactStore, session);

  run = updateRunStatus(run, 'planning');
  run = updateRunStage(run, {
    currentStage: 'spec_normalized',
    lastSuccessfulStage: 'spec_normalized',
    pendingStage: 'plan_created',
    lastCheckpointId: specCheckpoint.id,
    lastProgressSnapshotId: specProgress.id,
    sessionId: session.id,
    summary: 'Spec normalization completed.',
  });
  await persistRunStatus(artifactStore, run);
  manifest = updateSessionManifestRecord(manifest, {
    currentStage: 'spec_normalized',
    lastSuccessfulStage: 'spec_normalized',
    lastSuccessfulStep: 'spec.normalized',
    pendingStage: 'plan_created',
    pendingStep: 'plan.created',
    lastCheckpointId: specCheckpoint.id,
    lastProgressSnapshotId: specProgress.id,
    artifactPaths: {
      ...manifest.artifactPaths,
      normalizedSpec: normalizedSpecArtifact.path,
      progressLatest: specProgressArtifacts.latest.path,
      lastCheckpoint: specCheckpointArtifact.path,
    },
    summary: 'Spec normalization completed.',
  });
  await persistSessionManifest(artifactStore, manifest);

  const planArtifact = await artifactStore.writeJsonArtifact(
    'plan',
    'plan.json',
    plan,
    'Deterministic governed-run plan.',
  );
  await emitEvent('plan.created', {
    artifactPath: planArtifact.path,
    doneConditions: plan.doneConditions,
    taskUnitCount: plan.taskUnits.length,
  });
  const planCheckpoint = createRunCheckpointRecord({
    runId: run.id,
    sessionId: session.id,
    stage: 'plan_created',
    status: 'planning',
    requiredArtifactPaths: [normalizedSpecArtifact.path],
    outputArtifactPaths: [planArtifact.path],
    restartable: true,
    rerunStageOnResume: false,
    resumeInstructions: ['Load the persisted plan and continue with policy evaluation.'],
    lastSuccessfulStep: 'plan.created',
    pendingStep: 'policy.evaluated',
    summary: 'Plan generation completed and is safe to resume from policy evaluation.',
  });
  const planCheckpointArtifact = await persistRunCheckpoint(artifactStore, planCheckpoint);
  const planProgress = createRunProgressSnapshotRecord({
    runId: run.id,
    sessionId: session.id,
    stage: 'plan_created',
    status: 'planning',
    justCompleted: 'Created the deterministic governed-run plan.',
    remaining: ['Generate impact preview.', 'Evaluate policy and approval requirements.'],
    currentRisks: normalizedSpec.riskHints,
    approvedScope: [],
    verificationState: 'not_run',
    artifactPaths: [planArtifact.path, planCheckpointArtifact.path],
    nextRecommendedStep: 'Evaluate the planned scope against the selected policy pack.',
    summary: 'Plan generation completed.',
  });
  const planProgressArtifacts = await persistProgressSnapshot(artifactStore, planProgress);
  session = updateRunSessionRecord(session, {
    currentStage: 'plan_created',
    lastProgressSnapshotId: planProgress.id,
    outputArtifactPaths: uniqueStrings([
      ...session.outputArtifactPaths,
      planArtifact.path,
      planCheckpointArtifact.path,
      planProgressArtifacts.history.path,
      planProgressArtifacts.latest.path,
    ]),
    summary: 'Plan generation completed.',
  });
  await persistRunSession(artifactStore, session);
  run = updateRunStage(run, {
    currentStage: 'plan_created',
    lastSuccessfulStage: 'plan_created',
    pendingStage: 'policy_evaluated',
    lastCheckpointId: planCheckpoint.id,
    lastProgressSnapshotId: planProgress.id,
    sessionId: session.id,
    summary: 'Plan generation completed.',
  });
  await persistRunStatus(artifactStore, run);
  manifest = updateSessionManifestRecord(manifest, {
    currentStage: 'plan_created',
    lastSuccessfulStage: 'plan_created',
    lastSuccessfulStep: 'plan.created',
    pendingStage: 'policy_evaluated',
    pendingStep: 'policy.evaluated',
    lastCheckpointId: planCheckpoint.id,
    lastProgressSnapshotId: planProgress.id,
    artifactPaths: {
      ...manifest.artifactPaths,
      plan: planArtifact.path,
      progressLatest: planProgressArtifacts.latest.path,
      lastCheckpoint: planCheckpointArtifact.path,
    },
    summary: 'Plan generation completed.',
  });
  await persistSessionManifest(artifactStore, manifest);

  const impactPreview = generateImpactPreview({
    networkAccess: policyPack.defaults.networkAccess,
    plan,
    runId,
    sandboxMode: policyPack.defaults.sandboxMode,
    spec: normalizedSpec,
  });
  const impactPreviewArtifact = await artifactStore.writeJsonArtifact(
    'impact-preview',
    'impact-preview.json',
    impactPreview,
    'Read-only impact preview generated before write-capable execution.',
  );
  await emitEvent('impact_preview.created', {
    actionKinds: impactPreview.actionKinds,
    artifactPath: impactPreviewArtifact.path,
    requestedNetworkAccess: impactPreview.requestedNetworkAccess,
    requestedSandboxMode: impactPreview.requestedSandboxMode,
  });

  const policyInputArtifact = await artifactStore.writeJsonArtifact(
    'policy-input',
    'policy.input.json',
    {
      approvalMode,
      impactPreview,
      policyPack: {
        defaults: policyPack.defaults,
        name: policyPack.name,
        path: loadedPolicyPath,
        version: policyPack.version,
      },
      specId: normalizedSpec.id,
    },
    'Policy evaluation input snapshot.',
  );
  const policyDecision = evaluatePolicy({
    approvalMode,
    impactPreview,
    policyPack,
    policyPackPath: loadedPolicyPath,
    spec: normalizedSpec,
  });
  run = updateRunStatus(run, 'running', policyDecision.reasons[0]?.summary ?? undefined);
  await persistRunStatus(artifactStore, run);

  const policyDecisionArtifact = await artifactStore.writeJsonArtifact(
    'policy-decision',
    'policy.decision.json',
    policyDecision,
    'Structured policy decision for the impact preview.',
  );
  await emitEvent('policy.evaluated', {
    artifactPath: policyDecisionArtifact.path,
    decision: policyDecision.decision,
    matchedRuleIds: policyDecision.matchedRules.map((rule) => rule.ruleId),
  });
  const policyCheckpoint = createRunCheckpointRecord({
    runId: run.id,
    sessionId: session.id,
    stage: 'policy_evaluated',
    status: policyDecision.decision === 'prompt' ? 'awaiting_approval' : 'in_progress',
    requiredArtifactPaths: [
      planArtifact.path,
      impactPreviewArtifact.path,
      policyInputArtifact.path,
    ],
    outputArtifactPaths: [policyDecisionArtifact.path],
    restartable: true,
    rerunStageOnResume: false,
    resumeInstructions:
      policyDecision.decision === 'prompt'
        ? ['Load the persisted approval packet and continue through approval resolution.']
        : ['Continue to runner execution using the persisted policy decision.'],
    lastSuccessfulStep: 'policy.evaluated',
    pendingStep: policyDecision.decision === 'prompt' ? 'approval.requested' : 'runner.started',
    summary:
      policyDecision.decision === 'prompt'
        ? 'Policy evaluation completed and is paused at the approval boundary.'
        : 'Policy evaluation completed and execution may proceed.',
  });
  const policyCheckpointArtifact = await persistRunCheckpoint(artifactStore, policyCheckpoint);
  const policyProgress = createRunProgressSnapshotRecord({
    runId: run.id,
    sessionId: session.id,
    stage: 'policy_evaluated',
    status: policyDecision.decision === 'prompt' ? 'awaiting_approval' : 'in_progress',
    justCompleted: 'Evaluated the predicted scope against the selected policy pack.',
    remaining:
      policyDecision.decision === 'prompt'
        ? ['Resolve the approval request.', 'Execute the approved runner stage.']
        : [
            'Execute the write-capable runner.',
            'Capture execution artifacts and verification evidence.',
          ],
    blockers:
      policyDecision.decision === 'prompt'
        ? ['Human approval is required before write-capable execution may continue.']
        : [],
    currentRisks: policyDecision.uncertaintyNotes,
    approvedScope: policyDecision.affectedPaths,
    verificationState: 'not_run',
    artifactPaths: [policyDecisionArtifact.path, policyCheckpointArtifact.path],
    nextRecommendedStep:
      policyDecision.decision === 'prompt'
        ? 'Resolve the approval packet or resume later from the paused approval boundary.'
        : 'Start the write-capable runner within the governed scope.',
    summary:
      policyDecision.decision === 'prompt'
        ? 'Policy evaluation completed and approval is required.'
        : 'Policy evaluation completed and execution may proceed.',
  });
  const policyProgressArtifacts = await persistProgressSnapshot(artifactStore, policyProgress);
  session = updateRunSessionRecord(session, {
    currentStage: 'policy_evaluated',
    lastProgressSnapshotId: policyProgress.id,
    outputArtifactPaths: uniqueStrings([
      ...session.outputArtifactPaths,
      impactPreviewArtifact.path,
      policyInputArtifact.path,
      policyDecisionArtifact.path,
      policyCheckpointArtifact.path,
      policyProgressArtifacts.history.path,
      policyProgressArtifacts.latest.path,
    ]),
    summary: policyProgress.summary,
  });
  await persistRunSession(artifactStore, session);
  run = updateRunStage(run, {
    currentStage: 'policy_evaluated',
    lastSuccessfulStage: 'policy_evaluated',
    pendingStage: policyDecision.decision === 'prompt' ? 'awaiting_approval' : 'runner_started',
    lastCheckpointId: policyCheckpoint.id,
    lastProgressSnapshotId: policyProgress.id,
    sessionId: session.id,
    summary: policyProgress.summary,
  });
  await persistRunStatus(artifactStore, run);
  manifest = updateSessionManifestRecord(manifest, {
    currentStage: 'policy_evaluated',
    lastSuccessfulStage: 'policy_evaluated',
    lastSuccessfulStep: 'policy.evaluated',
    pendingStage: policyDecision.decision === 'prompt' ? 'awaiting_approval' : 'runner_started',
    pendingStep: policyDecision.decision === 'prompt' ? 'approval.requested' : 'runner.started',
    policyDecision: {
      artifactPath: policyDecisionArtifact.path,
      decision: policyDecision.decision,
      requiredApprovalMode: policyDecision.requiredApprovalMode,
      summary:
        policyDecision.reasons[0]?.summary ?? 'Policy evaluation completed without a summary.',
    },
    lastCheckpointId: policyCheckpoint.id,
    lastProgressSnapshotId: policyProgress.id,
    artifactPaths: {
      ...manifest.artifactPaths,
      impactPreview: impactPreviewArtifact.path,
      policyInput: policyInputArtifact.path,
      policyDecision: policyDecisionArtifact.path,
      progressLatest: policyProgressArtifacts.latest.path,
      lastCheckpoint: policyCheckpointArtifact.path,
    },
    summary: policyProgress.summary,
  });
  await persistSessionManifest(artifactStore, manifest);

  let approvalPacket: ApprovalPacket | undefined;
  let approvalPacketArtifact: ArtifactReference | undefined;
  let approvalPacketMarkdownArtifact: ArtifactReference | undefined;
  let approvalResolution: ApprovalResolution | undefined;
  let runnerResult: RunnerResult | undefined;
  let executedRunner = false;

  if (policyDecision.decision === 'prompt') {
    approvalPacket = createApprovalPacket({
      artifactPaths: [
        normalizedSpecArtifact.path,
        planArtifact.path,
        impactPreviewArtifact.path,
        policyInputArtifact.path,
        policyDecisionArtifact.path,
      ],
      impactPreview,
      policyDecision,
      runId: run.id,
      spec: normalizedSpec,
    });
    const approvalMarkdown = renderApprovalPacketMarkdown(approvalPacket);

    approvalPacketArtifact = await artifactStore.writeJsonArtifact(
      'approval-packet',
      'approval-packet.json',
      approvalPacket,
      'Machine-readable approval packet for a prompted run.',
    );
    approvalPacketMarkdownArtifact = await artifactStore.writeTextArtifact(
      'approval-packet-markdown',
      'approval-packet.md',
      approvalMarkdown,
      'markdown',
      'Human-readable approval packet for a prompted run.',
    );

    run = updateRunStatus(run, 'awaiting_approval', approvalPacket.decisionSummary);
    run = updateRunStage(run, {
      currentStage: 'awaiting_approval',
      pendingStage: 'awaiting_approval',
      summary: approvalPacket.decisionSummary,
      sessionId: session.id,
    });
    await persistRunStatus(artifactStore, run);
    await emitEvent('approval.requested', {
      approvalPacketId: approvalPacket.id,
      artifactPaths: [approvalPacketArtifact.path, approvalPacketMarkdownArtifact.path],
      decision: policyDecision.decision,
    });
    const approvalPendingProgress = createRunProgressSnapshotRecord({
      runId: run.id,
      sessionId: session.id,
      stage: 'awaiting_approval',
      status: 'awaiting_approval',
      justCompleted: 'Persisted the approval packet required for this run.',
      remaining: [
        'Resolve the approval request.',
        'Resume runner execution if approval is granted.',
      ],
      blockers: ['Human approval is required before write-capable execution may continue.'],
      currentRisks: approvalPacket.riskSummary,
      approvedScope: policyDecision.affectedPaths,
      verificationState: 'not_run',
      artifactPaths: [approvalPacketArtifact.path, approvalPacketMarkdownArtifact.path],
      nextRecommendedStep: `Inspect the approval packet and continue with "gdh resume ${run.id}" once a human is ready to resolve it.`,
      summary: approvalPacket.decisionSummary,
    });
    const approvalPendingProgressArtifacts = await persistProgressSnapshot(
      artifactStore,
      approvalPendingProgress,
    );
    session = updateRunSessionRecord(session, {
      currentStage: 'awaiting_approval',
      lastProgressSnapshotId: approvalPendingProgress.id,
      outputArtifactPaths: uniqueStrings([
        ...session.outputArtifactPaths,
        approvalPacketArtifact.path,
        approvalPacketMarkdownArtifact.path,
        approvalPendingProgressArtifacts.history.path,
        approvalPendingProgressArtifacts.latest.path,
      ]),
      summary: approvalPacket.decisionSummary,
    });
    await persistRunSession(artifactStore, session);
    manifest = updateSessionManifestRecord(manifest, {
      status: 'awaiting_approval',
      currentStage: 'awaiting_approval',
      pendingStage: 'awaiting_approval',
      pendingStep: 'approval.requested',
      approvalState: {
        required: true,
        status: 'pending',
        approvalPacketId: approvalPacket.id,
        artifactPaths: [approvalPacketArtifact.path, approvalPacketMarkdownArtifact.path],
      },
      pendingActions: [
        createPendingActionRecord({
          runId: run.id,
          kind: 'approval',
          title: 'Resolve approval request',
          summary: approvalPacket.decisionSummary,
          artifactPaths: [approvalPacketArtifact.path, approvalPacketMarkdownArtifact.path],
        }),
      ],
      lastProgressSnapshotId: approvalPendingProgress.id,
      artifactPaths: {
        ...manifest.artifactPaths,
        approvalPacket: approvalPacketArtifact.path,
        approvalPacketMarkdown: approvalPacketMarkdownArtifact.path,
        progressLatest: approvalPendingProgressArtifacts.latest.path,
      },
      summary: approvalPacket.decisionSummary,
    });
    await persistSessionManifest(artifactStore, manifest);

    if (approvalMode === 'interactive') {
      const resolveApproval = options.approvalResolver ?? promptForApproval;

      approvalResolution = await resolveApproval(approvalPacket);

      const approvalResolutionRecord = createApprovalResolutionRecord({
        approvalPacketId: approvalPacket.id,
        notes:
          approvalResolution === 'approved'
            ? ['Approval granted from the interactive CLI flow.']
            : ['Approval denied from the interactive CLI flow.'],
        resolution: approvalResolution,
        runId: run.id,
      });
      await artifactStore.writeJsonArtifact(
        'approval-resolution',
        'approval-resolution.json',
        approvalResolutionRecord,
        'Recorded approval resolution for this run.',
      );
      const approvalResolutionArtifact = artifactStore.resolveArtifactPath(
        'approval-resolution.json',
      );

      if (approvalResolution === 'approved') {
        run = updateRunStatus(
          run,
          'in_progress',
          'Approval granted; write-capable execution may proceed.',
        );
        run = updateRunStage(run, {
          currentStage: 'approval_resolved',
          lastSuccessfulStage: 'approval_resolved',
          pendingStage: 'runner_started',
          summary: 'Approval granted; write-capable execution may proceed.',
          sessionId: session.id,
        });
        await persistRunStatus(artifactStore, run);
        await emitEvent('approval.granted', {
          approvalPacketId: approvalPacket.id,
          resolution: approvalResolution,
        });
        const approvalCheckpoint = createRunCheckpointRecord({
          runId: run.id,
          sessionId: session.id,
          stage: 'approval_resolved',
          status: 'in_progress',
          requiredArtifactPaths: [approvalPacketArtifact.path, approvalPacketMarkdownArtifact.path],
          outputArtifactPaths: [approvalResolutionArtifact],
          restartable: true,
          rerunStageOnResume: false,
          resumeInstructions: ['Reuse the approved resolution and continue with runner execution.'],
          lastSuccessfulStep: 'approval.granted',
          pendingStep: 'runner.started',
          summary: 'Approval was granted and execution may proceed.',
        });
        const approvalCheckpointArtifact = await persistRunCheckpoint(
          artifactStore,
          approvalCheckpoint,
        );
        const approvalProgress = createRunProgressSnapshotRecord({
          runId: run.id,
          sessionId: session.id,
          stage: 'approval_resolved',
          status: 'in_progress',
          justCompleted: 'Resolved the required approval as approved.',
          remaining: [
            'Run the write-capable runner.',
            'Capture execution artifacts and verification evidence.',
          ],
          currentRisks: [],
          approvedScope: policyDecision.affectedPaths,
          verificationState: 'not_run',
          artifactPaths: [approvalResolutionArtifact, approvalCheckpointArtifact.path],
          nextRecommendedStep: 'Start the write-capable runner.',
          summary: 'Approval granted; execution may proceed.',
        });
        const approvalProgressArtifacts = await persistProgressSnapshot(
          artifactStore,
          approvalProgress,
        );
        session = updateRunSessionRecord(session, {
          currentStage: 'approval_resolved',
          lastProgressSnapshotId: approvalProgress.id,
          outputArtifactPaths: uniqueStrings([
            ...session.outputArtifactPaths,
            approvalResolutionArtifact,
            approvalCheckpointArtifact.path,
            approvalProgressArtifacts.history.path,
            approvalProgressArtifacts.latest.path,
          ]),
          summary: 'Approval granted; execution may proceed.',
        });
        await persistRunSession(artifactStore, session);
        manifest = updateSessionManifestRecord(manifest, {
          status: 'in_progress',
          currentStage: 'approval_resolved',
          lastSuccessfulStage: 'approval_resolved',
          lastSuccessfulStep: 'approval.granted',
          pendingStage: 'runner_started',
          pendingStep: 'runner.started',
          approvalState: {
            required: true,
            status: 'approved',
            approvalPacketId: approvalPacket.id,
            artifactPaths: [
              approvalPacketArtifact.path,
              approvalPacketMarkdownArtifact.path,
              approvalResolutionArtifact,
            ],
          },
          pendingActions: [],
          lastCheckpointId: approvalCheckpoint.id,
          lastProgressSnapshotId: approvalProgress.id,
          artifactPaths: {
            ...manifest.artifactPaths,
            approvalResolution: approvalResolutionArtifact,
            progressLatest: approvalProgressArtifacts.latest.path,
            lastCheckpoint: approvalCheckpointArtifact.path,
          },
          summary: 'Approval granted; execution may proceed.',
        });
        await persistSessionManifest(artifactStore, manifest);
      } else {
        run = updateRunStatus(
          run,
          'abandoned',
          'Approval denied; the run stopped before execution.',
        );
        run = updateRunStage(run, {
          currentStage: 'approval_resolved',
          lastSuccessfulStage: 'approval_resolved',
          pendingStage: undefined,
          summary: 'Approval denied; the run stopped before execution.',
          sessionId: session.id,
        });
        await persistRunStatus(artifactStore, run);
        await emitEvent('approval.denied', {
          approvalPacketId: approvalPacket.id,
          resolution: approvalResolution,
        });
        session = updateRunSessionRecord(session, {
          status: 'completed',
          currentStage: 'approval_resolved',
          summary: 'Approval denied; the run was abandoned before execution.',
        });
        await persistRunSession(artifactStore, session);
        manifest = updateSessionManifestRecord(manifest, {
          status: 'abandoned',
          currentStage: 'approval_resolved',
          lastSuccessfulStage: 'approval_resolved',
          lastSuccessfulStep: 'approval.denied',
          pendingStage: undefined,
          pendingStep: undefined,
          approvalState: {
            required: true,
            status: 'denied',
            approvalPacketId: approvalPacket.id,
            artifactPaths: [
              approvalPacketArtifact.path,
              approvalPacketMarkdownArtifact.path,
              approvalResolutionArtifact,
            ],
          },
          pendingActions: [],
          summary: 'Approval denied; the run was abandoned before execution.',
        });
        await persistSessionManifest(artifactStore, manifest);
        runnerResult = createSkippedRunnerResult(
          `Approval "${approvalPacket.id}" was denied; the governed run stopped before execution.`,
        );
      }
    } else {
      runnerResult = createSkippedRunnerResult(
        `Approval "${approvalPacket.id}" is required. Re-run with --approval-mode interactive to review it.`,
      );
    }
  } else if (policyDecision.decision === 'forbid') {
    run = updateRunStatus(
      run,
      'failed',
      policyDecision.reasons[0]?.summary ?? 'Policy pack forbids this run from executing.',
    );
    run = updateRunStage(run, {
      currentStage: 'policy_evaluated',
      lastSuccessfulStage: 'policy_evaluated',
      pendingStage: undefined,
      summary: policyDecision.reasons[0]?.summary ?? 'Policy pack forbids this run from executing.',
      sessionId: session.id,
    });
    await persistRunStatus(artifactStore, run);
    await emitEvent('policy.blocked', {
      decision: policyDecision.decision,
      matchedRuleIds: policyDecision.matchedRules.map((rule) => rule.ruleId),
    });
    session = updateRunSessionRecord(session, {
      status: 'completed',
      currentStage: 'policy_evaluated',
      summary: policyDecision.reasons[0]?.summary ?? 'Policy pack forbids this run from executing.',
    });
    await persistRunSession(artifactStore, session);
    manifest = updateSessionManifestRecord(manifest, {
      status: 'failed',
      currentStage: 'policy_evaluated',
      pendingStage: undefined,
      pendingStep: undefined,
      pendingActions: [],
      summary: policyDecision.reasons[0]?.summary ?? 'Policy pack forbids this run from executing.',
    });
    await persistSessionManifest(artifactStore, manifest);
    runnerResult = createSkippedRunnerResult(
      policyDecision.reasons[0]?.summary ?? 'Policy pack forbids this run from executing.',
    );
  }

  if (!runnerResult && (policyDecision.decision === 'allow' || approvalResolution === 'approved')) {
    const runner = createRunner(runnerKind);

    executedRunner = true;
    run = updateRunStatus(run, 'in_progress', 'Write-capable runner is starting.');
    run = updateRunStage(run, {
      currentStage: 'runner_started',
      pendingStage: 'runner_completed',
      summary: 'Write-capable runner is starting.',
      sessionId: session.id,
    });
    await persistRunStatus(artifactStore, run);
    const runnerStartedProgress = createRunProgressSnapshotRecord({
      runId: run.id,
      sessionId: session.id,
      stage: 'runner_started',
      status: 'in_progress',
      justCompleted: 'Prepared the run context for write-capable execution.',
      remaining: [
        'Complete runner execution.',
        'Capture diff, policy audit, and verification evidence.',
      ],
      currentRisks: policyDecision.uncertaintyNotes,
      approvedScope: policyDecision.affectedPaths,
      verificationState: 'not_run',
      artifactPaths: [],
      nextRecommendedStep: 'Wait for the runner to finish and persist the execution artifacts.',
      summary: 'Write-capable runner is starting.',
    });
    const runnerStartedProgressArtifacts = await persistProgressSnapshot(
      artifactStore,
      runnerStartedProgress,
    );
    session = updateRunSessionRecord(session, {
      currentStage: 'runner_started',
      lastProgressSnapshotId: runnerStartedProgress.id,
      outputArtifactPaths: uniqueStrings([
        ...session.outputArtifactPaths,
        runnerStartedProgressArtifacts.history.path,
        runnerStartedProgressArtifacts.latest.path,
      ]),
      summary: 'Write-capable runner is starting.',
    });
    await persistRunSession(artifactStore, session);
    manifest = updateSessionManifestRecord(manifest, {
      status: 'in_progress',
      currentStage: 'runner_started',
      pendingStage: 'runner_completed',
      pendingStep: 'runner.completed',
      lastProgressSnapshotId: runnerStartedProgress.id,
      artifactPaths: {
        ...manifest.artifactPaths,
        progressLatest: runnerStartedProgressArtifacts.latest.path,
      },
      summary: 'Write-capable runner is starting.',
    });
    await persistSessionManifest(artifactStore, manifest);
    await emitEvent('runner.started', {
      approvalPolicy: run.approvalPolicy,
      model: run.model,
      networkAccess: run.networkAccess,
      runner: runner.kind,
      sandboxMode: run.sandboxMode,
    });

    runnerResult = await (async () => {
      try {
        return await runner.execute({
          approvalPacket,
          impactPreview,
          plan,
          policyDecision,
          priorArtifacts: artifactStore.listArtifacts(),
          repoRoot,
          run,
          runDirectory: artifactStore.runDirectory,
          spec: normalizedSpec,
          verificationRequirements: describeVerificationScope(verificationConfig.commands),
        });
      } catch (error) {
        return RunnerResultSchema.parse({
          artifactsProduced: [],
          commandCapture: createEmptyCommandCapture(
            'The runner threw before a structured command capture was available.',
          ),
          durationMs: 0,
          exitCode: -1,
          limitations: ['The runner threw before returning a structured result.'],
          metadata: {},
          prompt: '',
          reportedChangedFiles: [],
          reportedChangedFilesCompleteness: 'unknown',
          reportedChangedFilesNotes: ['The runner failed before reporting changed files.'],
          status: 'failed',
          stderr: error instanceof Error ? (error.stack ?? error.message) : String(error),
          stdout: '',
          summary: error instanceof Error ? error.message : 'Runner execution failed unexpectedly.',
        });
      }
    })();

    const runnerPromptArtifact = await artifactStore.writeTextArtifact(
      'runner-prompt',
      'runner.prompt.md',
      runnerResult.prompt,
      'markdown',
      'Prompt prepared for the write-capable runner.',
    );
    const stdoutArtifact = await artifactStore.writeTextArtifact(
      'runner-stdout',
      'runner.stdout.log',
      runnerResult.stdout,
      'text',
      'Raw runner stdout.',
    );
    const stderrArtifact = await artifactStore.writeTextArtifact(
      'runner-stderr',
      'runner.stderr.log',
      runnerResult.stderr,
      'text',
      'Raw runner stderr.',
    );
    const commandCaptureArtifact = await artifactStore.writeJsonArtifact(
      'commands-executed',
      'commands-executed.json',
      runnerResult.commandCapture,
      'Captured executed commands with provenance and completeness.',
    );
    const runnerResultArtifact = await artifactStore.writeJsonArtifact(
      'runner-result',
      'runner.result.json',
      runnerResult,
      'Structured runner result with logs and metadata.',
    );

    await emitEvent(eventTypeForRunnerStatus(runnerResult.status), {
      artifactPaths: [
        runnerPromptArtifact.path,
        stdoutArtifact.path,
        stderrArtifact.path,
        commandCaptureArtifact.path,
        runnerResultArtifact.path,
      ],
      durationMs: runnerResult.durationMs,
      exitCode: runnerResult.exitCode,
      status: runnerResult.status,
    });
    const runnerCheckpoint = createRunCheckpointRecord({
      runId: run.id,
      sessionId: session.id,
      stage: 'runner_completed',
      status: runnerResult.status === 'completed' ? 'verifying' : 'interrupted',
      requiredArtifactPaths: [
        policyDecisionArtifact.path,
        ...(approvalPacketArtifact ? [approvalPacketArtifact.path] : []),
      ],
      outputArtifactPaths: [
        runnerPromptArtifact.path,
        stdoutArtifact.path,
        stderrArtifact.path,
        commandCaptureArtifact.path,
        runnerResultArtifact.path,
      ],
      restartable: runnerResult.status === 'completed',
      rerunStageOnResume: runnerResult.status !== 'completed',
      resumeInstructions:
        runnerResult.status === 'completed'
          ? ['Reuse the persisted execution artifacts and continue with verification.']
          : ['Investigate the partial execution state before rerunning the runner stage.'],
      lastSuccessfulStep: 'runner.completed',
      pendingStep: runnerResult.status === 'completed' ? 'verification.started' : 'runner.started',
      summary:
        runnerResult.status === 'completed'
          ? 'Runner execution completed and is safe to resume from verification.'
          : 'Runner execution did not finish cleanly.',
    });
    const runnerCheckpointArtifact = await persistRunCheckpoint(artifactStore, runnerCheckpoint);
    const runnerProgress = createRunProgressSnapshotRecord({
      runId: run.id,
      sessionId: session.id,
      stage: 'runner_completed',
      status: runnerResult.status === 'completed' ? 'verifying' : 'interrupted',
      justCompleted:
        runnerResult.status === 'completed'
          ? 'Finished write-capable execution and captured the runner artifacts.'
          : 'Captured the failed runner result and logs.',
      remaining:
        runnerResult.status === 'completed'
          ? ['Capture changed files and diff.', 'Run deterministic verification.']
          : [
              'Inspect the runner failure and decide whether the runner stage can be retried safely.',
            ],
      blockers:
        runnerResult.status === 'completed'
          ? []
          : ['Runner execution did not complete successfully.'],
      currentRisks: runnerResult.limitations,
      approvedScope: policyDecision.affectedPaths,
      verificationState: 'not_run',
      artifactPaths: [
        runnerPromptArtifact.path,
        stdoutArtifact.path,
        stderrArtifact.path,
        commandCaptureArtifact.path,
        runnerResultArtifact.path,
        runnerCheckpointArtifact.path,
      ],
      nextRecommendedStep:
        runnerResult.status === 'completed'
          ? 'Capture the diff and start deterministic verification.'
          : 'Inspect the failed runner execution before attempting to continue.',
      summary:
        runnerResult.status === 'completed'
          ? 'Runner execution completed.'
          : 'Runner execution failed or stopped unexpectedly.',
    });
    const runnerProgressArtifacts = await persistProgressSnapshot(artifactStore, runnerProgress);
    session = updateRunSessionRecord(session, {
      currentStage: 'runner_completed',
      lastProgressSnapshotId: runnerProgress.id,
      outputArtifactPaths: uniqueStrings([
        ...session.outputArtifactPaths,
        runnerPromptArtifact.path,
        stdoutArtifact.path,
        stderrArtifact.path,
        commandCaptureArtifact.path,
        runnerResultArtifact.path,
        runnerCheckpointArtifact.path,
        runnerProgressArtifacts.history.path,
        runnerProgressArtifacts.latest.path,
      ]),
      summary: runnerProgress.summary,
    });
    await persistRunSession(artifactStore, session);
    manifest = updateSessionManifestRecord(manifest, {
      status: runnerResult.status === 'completed' ? 'verifying' : 'interrupted',
      currentStage: 'runner_completed',
      lastSuccessfulStage:
        runnerResult.status === 'completed' ? 'runner_completed' : manifest.lastSuccessfulStage,
      lastSuccessfulStep:
        runnerResult.status === 'completed' ? 'runner.completed' : manifest.lastSuccessfulStep,
      pendingStage: runnerResult.status === 'completed' ? 'verification_started' : 'runner_started',
      pendingStep: runnerResult.status === 'completed' ? 'verification.started' : 'runner.started',
      lastCheckpointId: runnerCheckpoint.id,
      lastProgressSnapshotId: runnerProgress.id,
      pendingActions:
        runnerResult.status === 'completed'
          ? []
          : [
              createPendingActionRecord({
                runId: run.id,
                kind: 'rerun_stage',
                title: 'Review runner failure',
                summary: runnerResult.summary,
                artifactPaths: [stderrArtifact.path, runnerResultArtifact.path],
              }),
            ],
      artifactPaths: {
        ...manifest.artifactPaths,
        runnerPrompt: runnerPromptArtifact.path,
        runnerStdout: stdoutArtifact.path,
        runnerStderr: stderrArtifact.path,
        commandCapture: commandCaptureArtifact.path,
        runnerResult: runnerResultArtifact.path,
        progressLatest: runnerProgressArtifacts.latest.path,
        lastCheckpoint: runnerCheckpointArtifact.path,
      },
      summary: runnerProgress.summary,
    });
    await persistSessionManifest(artifactStore, manifest);

    run = updateRunStatus(
      run,
      runnerResult.status === 'completed' ? 'verifying' : 'interrupted',
      runnerResult.summary,
    );
    run = updateRunStage(run, {
      currentStage: 'runner_completed',
      lastSuccessfulStage:
        runnerResult.status === 'completed' ? 'runner_completed' : run.lastSuccessfulStage,
      pendingStage: runnerResult.status === 'completed' ? 'verification_started' : 'runner_started',
      lastCheckpointId: runnerCheckpoint.id,
      lastProgressSnapshotId: runnerProgress.id,
      summary: runnerResult.summary,
      sessionId: session.id,
    });
    await persistRunStatus(artifactStore, run);
  }

  if (!runnerResult) {
    runnerResult = createSkippedRunnerResult(
      'The governed run stopped before write-capable execution.',
    );
  }

  if (!executedRunner) {
    await artifactStore.writeJsonArtifact(
      'commands-executed',
      'commands-executed.json',
      runnerResult.commandCapture,
      'Captured executed commands with provenance and completeness.',
    );
    await artifactStore.writeJsonArtifact(
      'runner-result',
      'runner.result.json',
      runnerResult,
      'Structured synthetic runner result for a blocked or pending run.',
    );
  }

  const afterSnapshot = await captureWorkspaceSnapshot(repoRoot, {
    excludePrefixes: [excludedRunPrefix],
  });
  const changedFiles = diffWorkspaceSnapshots(beforeSnapshot, afterSnapshot);
  const diffPatch = await createDiffPatch(beforeSnapshot, afterSnapshot, changedFiles);
  const changedFilesArtifact = await artifactStore.writeJsonArtifact(
    'changed-files',
    'changed-files.json',
    changedFiles,
    'Changed files derived from before/after workspace snapshots.',
  );
  const diffArtifact = await artifactStore.writeTextArtifact(
    'diff',
    'diff.patch',
    diffPatch,
    'patch',
    'Patch derived from workspace snapshot differences.',
  );
  await emitEvent('diff.captured', {
    artifactPath: changedFilesArtifact.path,
    changedFiles: changedFiles.files.map((file) => ({
      path: file.path,
      status: file.status,
    })),
    diffPath: diffArtifact.path,
  });

  const policyAudit = createPolicyAudit({
    approvalResolution,
    changedFiles,
    commandCapture: runnerResult.commandCapture,
    impactPreview,
    policyDecision,
    policyPack,
    spec: normalizedSpec,
  });
  const policyAuditArtifact = await artifactStore.writeJsonArtifact(
    'policy-audit',
    'policy-audit.json',
    policyAudit,
    'Post-run policy audit based on actual changed files and captured commands.',
  );
  const postExecutionWorkspaceSnapshot = await captureWorkspaceState(repoRoot, {
    expectedArtifactPaths: uniqueStrings([
      artifactStore.resolveArtifactPath('run.json'),
      artifactStore.resolveArtifactPath(sessionManifestRelativePath),
      resolve(artifactStore.runDirectory, 'runner.result.json'),
      resolve(artifactStore.runDirectory, 'commands-executed.json'),
      changedFilesArtifact.path,
      diffArtifact.path,
      policyAuditArtifact.path,
    ]),
    knownRunChangedFiles: changedFiles.files.map((file) => file.path),
    workingDirectory: cwd,
  });
  const postExecutionWorkspaceArtifact = await persistWorkspaceState(
    artifactStore,
    postExecutionWorkspaceSnapshot,
  );

  if (executedRunner) {
    const executionCheckpoint = createRunCheckpointRecord({
      runId: run.id,
      sessionId: session.id,
      stage: 'runner_completed',
      status: runnerResult?.status === 'completed' ? 'verifying' : 'interrupted',
      requiredArtifactPaths: [
        policyDecisionArtifact.path,
        ...(approvalPacketArtifact ? [approvalPacketArtifact.path] : []),
      ],
      outputArtifactPaths: uniqueStrings([
        resolve(artifactStore.runDirectory, 'runner.result.json'),
        resolve(artifactStore.runDirectory, 'commands-executed.json'),
        changedFilesArtifact.path,
        diffArtifact.path,
        policyAuditArtifact.path,
        postExecutionWorkspaceArtifact.path,
      ]),
      restartable: runnerResult?.status === 'completed',
      rerunStageOnResume: runnerResult?.status !== 'completed',
      resumeInstructions:
        runnerResult?.status === 'completed'
          ? ['Reuse the persisted execution evidence and continue with verification.']
          : [
              'Investigate the partial execution workspace state before rerunning the runner stage.',
            ],
      lastSuccessfulStep:
        runnerResult?.status === 'completed' ? 'runner.completed' : 'runner.failed',
      pendingStep: runnerResult?.status === 'completed' ? 'verification.started' : 'runner.started',
      summary:
        runnerResult?.status === 'completed'
          ? 'Execution artifacts are durable and verification can resume safely.'
          : 'Execution stopped before a restart-safe verification boundary was reached.',
    });
    const executionCheckpointArtifact = await persistRunCheckpoint(
      artifactStore,
      executionCheckpoint,
    );
    run = updateRunStage(run, {
      currentStage: 'runner_completed',
      lastSuccessfulStage:
        runnerResult?.status === 'completed' ? 'runner_completed' : run.lastSuccessfulStage,
      pendingStage:
        runnerResult?.status === 'completed' ? 'verification_started' : 'runner_started',
      lastCheckpointId: executionCheckpoint.id,
      summary: executionCheckpoint.summary,
      sessionId: session.id,
    });
    await persistRunStatus(artifactStore, run);
    manifest = updateSessionManifestRecord(manifest, {
      currentStage: 'runner_completed',
      lastSuccessfulStage:
        runnerResult?.status === 'completed' ? 'runner_completed' : manifest.lastSuccessfulStage,
      lastSuccessfulStep:
        runnerResult?.status === 'completed' ? 'runner.completed' : manifest.lastSuccessfulStep,
      pendingStage:
        runnerResult?.status === 'completed' ? 'verification_started' : 'runner_started',
      pendingStep: runnerResult?.status === 'completed' ? 'verification.started' : 'runner.started',
      lastCheckpointId: executionCheckpoint.id,
      workspace: {
        ...manifest.workspace,
        lastSnapshot: postExecutionWorkspaceSnapshot,
      },
      artifactPaths: {
        ...manifest.artifactPaths,
        changedFiles: changedFilesArtifact.path,
        diff: diffArtifact.path,
        policyAudit: policyAuditArtifact.path,
        workspaceLatest: postExecutionWorkspaceArtifact.path,
        lastCheckpoint: executionCheckpointArtifact.path,
      },
      summary: executionCheckpoint.summary,
    });
    await persistSessionManifest(artifactStore, manifest);
  } else {
    manifest = updateSessionManifestRecord(manifest, {
      workspace: {
        ...manifest.workspace,
        lastSnapshot: postExecutionWorkspaceSnapshot,
      },
      artifactPaths: {
        ...manifest.artifactPaths,
        changedFiles: changedFilesArtifact.path,
        diff: diffArtifact.path,
        policyAudit: policyAuditArtifact.path,
        workspaceLatest: postExecutionWorkspaceArtifact.path,
      },
    });
    await persistSessionManifest(artifactStore, manifest);
  }

  let reviewPacketMarkdownArtifact: ArtifactReference;
  let verificationResultPath: string | undefined;
  let verificationStatus: VerificationStatus = 'not_run';

  if (executedRunner) {
    const verificationStartedProgress = createRunProgressSnapshotRecord({
      runId: run.id,
      sessionId: session.id,
      stage: 'verification_started',
      status: 'verifying',
      justCompleted: 'Captured execution artifacts and prepared deterministic verification.',
      remaining: [
        'Run configured verification commands.',
        'Aggregate verification result and final review packet.',
      ],
      currentRisks: policyAudit.notes,
      approvedScope: policyDecision.affectedPaths,
      verificationState: 'not_run',
      artifactPaths: [changedFilesArtifact.path, diffArtifact.path, policyAuditArtifact.path],
      nextRecommendedStep:
        'Run deterministic verification from the persisted post-execution boundary.',
      summary: 'Deterministic verification is starting.',
    });
    const verificationStartedProgressArtifacts = await persistProgressSnapshot(
      artifactStore,
      verificationStartedProgress,
    );
    run = updateRunStatus(run, 'verifying', 'Deterministic verification is starting.');
    run = updateRunStage(run, {
      currentStage: 'verification_started',
      pendingStage: 'verification_completed',
      lastProgressSnapshotId: verificationStartedProgress.id,
      summary: 'Deterministic verification is starting.',
      sessionId: session.id,
    });
    await persistRunStatus(artifactStore, run);
    session = updateRunSessionRecord(session, {
      currentStage: 'verification_started',
      lastProgressSnapshotId: verificationStartedProgress.id,
      outputArtifactPaths: uniqueStrings([
        ...session.outputArtifactPaths,
        verificationStartedProgressArtifacts.history.path,
        verificationStartedProgressArtifacts.latest.path,
      ]),
      summary: 'Deterministic verification is starting.',
    });
    await persistRunSession(artifactStore, session);
    manifest = updateSessionManifestRecord(manifest, {
      status: 'verifying',
      currentStage: 'verification_started',
      pendingStage: 'verification_completed',
      pendingStep: 'verification.completed',
      lastProgressSnapshotId: verificationStartedProgress.id,
      artifactPaths: {
        ...manifest.artifactPaths,
        progressLatest: verificationStartedProgressArtifacts.latest.path,
      },
      summary: 'Deterministic verification is starting.',
    });
    await persistSessionManifest(artifactStore, manifest);
    const verificationOutput = await runVerification({
      approvalPacket,
      approvalResolution,
      artifactStore,
      changedFiles,
      commandCapture: runnerResult.commandCapture,
      diffPatch,
      emitEvent,
      plan,
      policyAudit,
      policyDecision,
      repoRoot,
      run,
      runnerResult,
      spec: normalizedSpec,
    });

    verificationStatus = verificationOutput.verificationResult.status;
    verificationResultPath = resolve(artifactStore.runDirectory, 'verification.result.json');
    run = updateRunStatus(
      run,
      verificationOutput.verificationResult.completionDecision.finalStatus,
      verificationOutput.verificationResult.summary,
    );
    run = updateRunVerification(run, {
      status: verificationStatus,
      resultPath: verificationResultPath,
      verifiedAt: verificationOutput.verificationResult.createdAt,
      summary: verificationOutput.verificationResult.summary,
    });
    run = updateRunStage(run, {
      currentStage: 'verification_completed',
      lastSuccessfulStage: 'verification_completed',
      pendingStage: undefined,
      summary: verificationOutput.verificationResult.summary,
      sessionId: session.id,
    });
    await persistRunStatus(artifactStore, run);
    const verificationCheckpoint = createRunCheckpointRecord({
      runId: run.id,
      sessionId: session.id,
      stage: 'verification_completed',
      status: run.status,
      requiredArtifactPaths: [
        changedFilesArtifact.path,
        diffArtifact.path,
        policyAuditArtifact.path,
      ],
      outputArtifactPaths: uniqueStrings([
        verificationResultPath,
        resolve(artifactStore.runDirectory, 'review-packet.json'),
        resolve(artifactStore.runDirectory, 'review-packet.md'),
      ]),
      restartable: true,
      rerunStageOnResume: false,
      resumeInstructions: [
        'Inspection can rely on the persisted verification result and review packet.',
      ],
      lastSuccessfulStep: 'verification.completed',
      pendingStep: 'run.completed',
      summary: verificationOutput.verificationResult.summary,
    });
    const verificationCheckpointArtifact = await persistRunCheckpoint(
      artifactStore,
      verificationCheckpoint,
    );
    const verificationProgress = createRunProgressSnapshotRecord({
      runId: run.id,
      sessionId: session.id,
      stage: 'verification_completed',
      status: run.status,
      justCompleted: 'Finished deterministic verification and wrote the final review packet.',
      remaining: run.status === 'completed' ? [] : ['Inspect the failed verification evidence.'],
      blockers:
        run.status === 'completed'
          ? []
          : verificationOutput.verificationResult.completionDecision.blockingReasons,
      currentRisks: verificationOutput.reviewPacket.limitations,
      approvedScope: policyDecision.affectedPaths,
      verificationState: verificationOutput.verificationResult.status,
      artifactPaths: uniqueStrings([
        verificationResultPath,
        resolve(artifactStore.runDirectory, 'review-packet.json'),
        resolve(artifactStore.runDirectory, 'review-packet.md'),
        verificationCheckpointArtifact.path,
      ]),
      nextRecommendedStep:
        run.status === 'completed'
          ? 'Inspect the completed run with "gdh status <run-id>" if needed.'
          : 'Inspect the verification result and decide whether manual fixes are needed.',
      summary: verificationOutput.verificationResult.summary,
    });
    const verificationProgressArtifacts = await persistProgressSnapshot(
      artifactStore,
      verificationProgress,
    );
    session = updateRunSessionRecord(session, {
      status: run.status === 'completed' ? 'completed' : 'failed',
      currentStage: 'verification_completed',
      lastProgressSnapshotId: verificationProgress.id,
      outputArtifactPaths: uniqueStrings([
        ...session.outputArtifactPaths,
        verificationCheckpointArtifact.path,
        verificationProgressArtifacts.history.path,
        verificationProgressArtifacts.latest.path,
        verificationResultPath,
        resolve(artifactStore.runDirectory, 'review-packet.json'),
        resolve(artifactStore.runDirectory, 'review-packet.md'),
      ]),
      summary: verificationOutput.verificationResult.summary,
      endedAt: createIsoTimestamp(),
    });
    await persistRunSession(artifactStore, session);
    manifest = updateSessionManifestRecord(manifest, {
      status: run.status,
      currentStage: 'verification_completed',
      lastSuccessfulStage: 'verification_completed',
      lastSuccessfulStep: 'verification.completed',
      pendingStage: undefined,
      pendingStep: undefined,
      verificationState: {
        status: verificationOutput.verificationResult.status,
        summary: verificationOutput.verificationResult.summary,
        resultPath: verificationResultPath,
        lastVerifiedAt: verificationOutput.verificationResult.createdAt,
      },
      pendingActions:
        run.status === 'completed'
          ? []
          : [
              createPendingActionRecord({
                runId: run.id,
                kind: 'verification',
                title: 'Inspect failed verification result',
                summary: verificationOutput.verificationResult.summary,
                artifactPaths: [verificationResultPath],
              }),
            ],
      lastCheckpointId: verificationCheckpoint.id,
      lastProgressSnapshotId: verificationProgress.id,
      artifactPaths: {
        ...manifest.artifactPaths,
        verificationResult: verificationResultPath,
        reviewPacketJson: resolve(artifactStore.runDirectory, 'review-packet.json'),
        reviewPacketMarkdown: resolve(artifactStore.runDirectory, 'review-packet.md'),
        progressLatest: verificationProgressArtifacts.latest.path,
        lastCheckpoint: verificationCheckpointArtifact.path,
      },
      summary: verificationOutput.verificationResult.summary,
    });
    await persistSessionManifest(artifactStore, manifest);

    reviewPacketMarkdownArtifact = {
      id: 'review-packet-markdown',
      runId: run.id,
      kind: 'review-packet-markdown',
      path: resolve(artifactStore.runDirectory, 'review-packet.md'),
      format: 'markdown',
      createdAt: verificationOutput.reviewPacket.createdAt,
      summary: 'Human-readable review packet.',
    };
  } else {
    const skippedReviewPacket = createReviewPacket({
      approvalPacket,
      approvalResolution,
      artifacts: artifactStore.listArtifacts(),
      changedFiles,
      claimVerification: createSkippedClaimVerificationSummary(
        'Claim verification did not run because the governed run stopped before write-capable execution.',
      ),
      plan,
      policyAudit,
      policyDecision,
      run,
      runCompletion: {
        finalStatus: 'failed',
        canComplete: false,
        summary:
          'Verification did not run because the governed run stopped before write-capable execution.',
        blockingCheckIds: ['pre_execution_gate'],
        blockingReasons: [run.summary ?? runnerResult.summary],
      },
      runStatus: run.status,
      runnerResult,
      spec: normalizedSpec,
      verificationCommands: [] as VerificationCommandResult[],
      verificationStatus: 'not_run',
      verificationSummary:
        'Verification did not run because the governed run stopped before write-capable execution.',
    });
    const reviewPacketMarkdown = renderReviewPacketMarkdown(skippedReviewPacket);
    await artifactStore.writeJsonArtifact(
      'review-packet-json',
      'review-packet.json',
      skippedReviewPacket,
      'Structured review packet.',
    );
    reviewPacketMarkdownArtifact = await artifactStore.writeTextArtifact(
      'review-packet-markdown',
      'review-packet.md',
      reviewPacketMarkdown,
      'markdown',
      'Human-readable review packet.',
    );
    await emitEvent('review_packet.generated', {
      artifactPaths: [
        resolve(artifactStore.runDirectory, 'review-packet.json'),
        reviewPacketMarkdownArtifact.path,
      ],
      verificationStatus,
    });
    session = updateRunSessionRecord(session, {
      status: run.status === 'failed' || run.status === 'abandoned' ? 'failed' : 'completed',
      lastProgressSnapshotId: run.lastProgressSnapshotId,
      outputArtifactPaths: uniqueStrings([
        ...session.outputArtifactPaths,
        resolve(artifactStore.runDirectory, 'review-packet.json'),
        reviewPacketMarkdownArtifact.path,
      ]),
      summary: run.summary ?? runnerResult.summary,
      endedAt: createIsoTimestamp(),
    });
    await persistRunSession(artifactStore, session);
    manifest = updateSessionManifestRecord(manifest, {
      status: run.status,
      artifactPaths: {
        ...manifest.artifactPaths,
        reviewPacketJson: resolve(artifactStore.runDirectory, 'review-packet.json'),
        reviewPacketMarkdown: reviewPacketMarkdownArtifact.path,
      },
      summary: run.summary ?? runnerResult.summary,
    });
    await persistSessionManifest(artifactStore, manifest);
  }

  const finalEventType = eventTypeForFinalRunStatus(run.status);

  if (finalEventType) {
    await emitEvent(finalEventType, {
      reviewPacketPath: reviewPacketMarkdownArtifact.path,
      status: run.status,
      summary: run.summary,
    });
  }

  const finalResumeEligibility =
    run.status === 'awaiting_approval'
      ? createResumeEligibilityRecord({
          eligible: true,
          nextStage: 'awaiting_approval',
          reasons: [],
          requiredArtifactPaths: [
            resolve(artifactStore.runDirectory, 'approval-packet.json'),
            resolve(artifactStore.runDirectory, 'policy.decision.json'),
          ],
          summary: `Run can resume from "${run.status}" once a human resolves the approval request.`,
        })
      : createResumeEligibilityRecord({
          eligible: false,
          reasons: [`Run status "${run.status}" is not currently resumable from this invocation.`],
          summary: `Run status "${run.status}" is not currently resumable from this invocation.`,
        });
  run = updateRunResumeEligibility(run, finalResumeEligibility);
  await persistRunStatus(artifactStore, run);
  manifest = updateSessionManifestRecord(manifest, {
    status: run.status,
    resumeEligibility: finalResumeEligibility,
  });
  await persistSessionManifest(artifactStore, manifest);

  const artifacts = await listArtifactReferencesFromRunDirectory(run.id, run.runDirectory);

  return {
    approvalPacketPath: approvalPacketMarkdownArtifact?.path,
    approvalResolution,
    artifactCount: artifacts.length,
    artifactsDirectory: artifactStore.runDirectory,
    changedFiles: changedFiles.files.map((file) => file.path),
    commandsExecuted: runnerResult.commandCapture.commands.map((command) => ({
      command: command.command,
      isPartial: command.isPartial,
      provenance: command.provenance,
    })),
    exitCode: exitCodeForRunStatus(run.status),
    currentStage: run.currentStage,
    lastCompletedStage: run.lastSuccessfulStage,
    latestProgressSummary: manifest.summary,
    manifestPath: resolve(artifactStore.runDirectory, sessionManifestRelativePath),
    nextStage: manifest.pendingStage,
    policyAuditPath: policyAuditArtifact.path,
    policyDecision: policyDecision.decision,
    reviewPacketPath: reviewPacketMarkdownArtifact.path,
    resumeEligible: finalResumeEligibility.eligible,
    resumeSummary: finalResumeEligibility.summary,
    runId: run.id,
    specTitle: normalizedSpec.title,
    status: run.status,
    summary: run.summary ?? runnerResult.summary,
    verificationResultPath,
    verificationStatus,
  };
}

export async function statusRunId(
  runId: string,
  options: { cwd?: string } = {},
): Promise<RunCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const inspection = await prepareRunInspection(runId, repoRoot, {
    emitStatusRequested: true,
  });
  const artifacts = await listArtifactReferencesFromRunDirectory(
    inspection.run.id,
    inspection.run.runDirectory,
  );

  return {
    approvalPacketPath: inspection.state.approvalPacket
      ? resolve(inspection.run.runDirectory, 'approval-packet.md')
      : undefined,
    approvalResolution: inspection.state.approvalResolution,
    artifactCount: artifacts.length,
    artifactsDirectory: inspection.run.runDirectory,
    changedFiles:
      inspection.state.changedFiles?.files.map((file) => file.path) ??
      inspection.manifest.workspace.lastSnapshot?.knownRunChangedFiles ??
      [],
    commandsExecuted:
      inspection.state.commandCapture?.commands.map((command) => ({
        command: command.command,
        isPartial: command.isPartial,
        provenance: command.provenance,
      })) ?? [],
    continuityStatus: inspection.continuity.status,
    currentStage: inspection.run.currentStage,
    exitCode: inspection.eligibility.eligible ? 0 : exitCodeForRunStatus(inspection.run.status),
    lastCompletedStage: inspection.run.lastSuccessfulStage,
    latestProgressSummary: inspection.latestProgress?.summary ?? inspection.manifest.summary,
    manifestPath: resolve(inspection.run.runDirectory, sessionManifestRelativePath),
    nextStage: inspection.manifest.pendingStage ?? inspection.eligibility.nextStage,
    policyAuditPath: inspection.manifest.artifactPaths.policyAudit ?? 'not yet generated',
    policyDecision:
      inspection.state.policyDecision?.decision ?? inspection.manifest.policyDecision?.decision,
    reviewPacketPath: inspection.manifest.artifactPaths.reviewPacketMarkdown ?? 'not yet generated',
    resumeEligible: inspection.eligibility.eligible,
    resumeSummary: inspection.eligibility.summary,
    runId: inspection.run.id,
    specTitle: inspection.spec?.title ?? basename(inspection.run.sourceSpecPath),
    status: inspection.run.status,
    summary: inspection.manifest.summary,
    verificationResultPath: inspection.run.verificationResultPath,
    verificationStatus: inspection.run.verificationStatus,
  };
}

export async function verifyRunId(
  runId: string,
  options: { cwd?: string } = {},
): Promise<RunCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const loaded = await loadRunContext(repoRoot, runId);
  const artifactStore = createArtifactStore({
    repoRoot,
    runId,
  });

  await artifactStore.initialize();

  let run = updateRunStatus(
    loaded.run,
    'verifying',
    'Running deterministic verification for an existing governed run.',
  );

  const emitEvent = async (
    type: RunEventType,
    payload: Record<string, unknown>,
  ): Promise<ArtifactReference> => {
    return artifactStore.appendEvent(createRunEvent(run.id, type, payload));
  };

  await persistRunStatus(artifactStore, run);

  const verificationOutput = await runVerification({
    approvalPacket: loaded.approvalPacket,
    approvalResolution: loaded.approvalResolution,
    artifactStore,
    changedFiles: loaded.changedFiles,
    commandCapture: loaded.commandCapture,
    diffPatch: loaded.diffPatch,
    emitEvent,
    plan: loaded.plan,
    policyAudit: loaded.policyAudit,
    policyDecision: loaded.policyDecision,
    repoRoot,
    run,
    runnerResult: loaded.runnerResult,
    spec: loaded.spec,
  });
  const previousStatus = loaded.run.status;
  const verificationResultPath = resolve(run.runDirectory, 'verification.result.json');

  run = updateRunStatus(
    run,
    verificationOutput.verificationResult.completionDecision.finalStatus,
    verificationOutput.verificationResult.summary,
  );
  run = updateRunVerification(run, {
    status: verificationOutput.verificationResult.status,
    resultPath: verificationResultPath,
    verifiedAt: verificationOutput.verificationResult.createdAt,
    summary: verificationOutput.verificationResult.summary,
  });
  run = updateRunStage(run, {
    currentStage: 'verification_completed',
    lastSuccessfulStage: 'verification_completed',
    pendingStage: undefined,
    summary: verificationOutput.verificationResult.summary,
  });
  await persistRunStatus(artifactStore, run);

  if (loaded.manifest) {
    const manifest = updateSessionManifestRecord(loaded.manifest, {
      status: run.status,
      currentStage: 'verification_completed',
      lastSuccessfulStage: 'verification_completed',
      pendingStage: undefined,
      pendingStep: undefined,
      verificationState: {
        status: verificationOutput.verificationResult.status,
        summary: verificationOutput.verificationResult.summary,
        resultPath: verificationResultPath,
        lastVerifiedAt: verificationOutput.verificationResult.createdAt,
      },
      summary: verificationOutput.verificationResult.summary,
    });
    await persistSessionManifest(artifactStore, manifest);
  }

  const finalEventType = eventTypeForFinalRunStatus(run.status);

  if (finalEventType && previousStatus !== run.status) {
    await emitEvent(finalEventType, {
      reviewPacketPath: resolve(run.runDirectory, 'review-packet.md'),
      status: run.status,
      summary: run.summary,
    });
  }

  const artifacts = await listArtifactReferencesFromRunDirectory(run.id, run.runDirectory);

  return {
    approvalPacketPath: loaded.approvalPacket
      ? resolve(run.runDirectory, 'approval-packet.md')
      : undefined,
    approvalResolution: loaded.approvalResolution,
    artifactCount: artifacts.length,
    artifactsDirectory: run.runDirectory,
    changedFiles: loaded.changedFiles.files.map((file) => file.path),
    commandsExecuted: loaded.commandCapture.commands.map((command) => ({
      command: command.command,
      isPartial: command.isPartial,
      provenance: command.provenance,
    })),
    exitCode: verificationOutput.verificationResult.completionDecision.canComplete ? 0 : 1,
    policyAuditPath: resolve(run.runDirectory, 'policy-audit.json'),
    policyDecision: loaded.policyDecision.decision,
    reviewPacketPath: resolve(run.runDirectory, 'review-packet.md'),
    runId: run.id,
    specTitle: loaded.spec.title,
    status: run.status,
    summary: verificationOutput.verificationResult.summary,
    verificationResultPath,
    verificationStatus: verificationOutput.verificationResult.status,
  };
}

export async function resumeRunId(
  runId: string,
  options: { approvalResolver?: ApprovalResolver; cwd?: string } = {},
): Promise<RunCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const inspection = await prepareRunInspection(runId, repoRoot);

  if (!inspection.eligibility.eligible || !inspection.eligibility.nextStage) {
    throw new Error(inspection.eligibility.summary);
  }

  const artifactStore = inspection.artifactStore;
  let run = inspection.run;
  let manifest = inspection.manifest;
  let spec = inspection.state.spec;
  let plan = inspection.state.plan;
  let policyDecision = inspection.state.policyDecision;
  let approvalPacket = inspection.state.approvalPacket;
  let approvalResolution = inspection.state.approvalResolution;
  let runnerResult = inspection.state.runnerResult;
  let changedFiles = inspection.state.changedFiles;
  let commandCapture = inspection.state.commandCapture;
  let diffPatch = inspection.state.diffPatch;
  let policyAudit = inspection.state.policyAudit;
  let impactPreview = await readOptionalJsonArtifact(
    resolve(run.runDirectory, 'impact-preview.json'),
    ImpactPreviewSchema,
  );
  const verificationConfig = await loadVerificationConfig(repoRoot);
  const session = createRunSessionRecord({
    runId: run.id,
    trigger: 'resume',
    startStage: inspection.eligibility.nextStage,
    startedFromCheckpointId: manifest.lastCheckpointId,
    summary: inspection.resumePlan?.summary ?? inspection.eligibility.summary,
  });
  const emitEvent = async (
    type: RunEventType,
    payload: Record<string, unknown>,
  ): Promise<ArtifactReference> => {
    return artifactStore.appendEvent(createRunEvent(run.id, type, payload));
  };

  run = updateRunStatus(
    run,
    'resuming',
    inspection.resumePlan?.summary ?? inspection.eligibility.summary,
  );
  run = updateRunStage(run, {
    currentStage: inspection.eligibility.nextStage,
    pendingStage: inspection.eligibility.nextStage,
    sessionId: session.id,
    summary: inspection.resumePlan?.summary ?? inspection.eligibility.summary,
  });
  await persistRunStatus(artifactStore, run);
  await persistRunSession(artifactStore, session);
  manifest = updateSessionManifestRecord(manifest, {
    currentSessionId: session.id,
    sessionIds: [...manifest.sessionIds, session.id],
    status: 'resuming',
    currentStage: inspection.eligibility.nextStage,
    pendingStage: inspection.eligibility.nextStage,
    summary: inspection.resumePlan?.summary ?? inspection.eligibility.summary,
  });
  await persistSessionManifest(artifactStore, manifest);
  await emitEvent('resume.requested', {
    checkpointId: manifest.lastCheckpointId,
    nextStage: inspection.eligibility.nextStage,
  });
  await emitEvent('session.started', {
    sessionId: session.id,
    stage: session.startStage,
    trigger: session.trigger,
  });
  await emitEvent('resume.started', {
    checkpointId: manifest.lastCheckpointId,
    nextStage: inspection.eligibility.nextStage,
  });
  const resumeStartProgress = createRunProgressSnapshotRecord({
    runId: run.id,
    sessionId: session.id,
    stage: inspection.eligibility.nextStage,
    status: 'resuming',
    justCompleted: `Validated continuity and loaded checkpoint "${manifest.lastCheckpointId ?? 'none'}".`,
    remaining: [`Continue from "${inspection.eligibility.nextStage}".`],
    currentRisks: inspection.continuity.reasons,
    approvedScope: policyDecision?.affectedPaths ?? [],
    verificationState: run.verificationStatus,
    artifactPaths: uniqueStrings([
      inspection.manifest.latestContinuityAssessmentPath,
      inspection.manifest.latestResumePlanPath,
    ]),
    nextRecommendedStep: `Resume the governed run from "${inspection.eligibility.nextStage}".`,
    summary: inspection.resumePlan?.summary ?? inspection.eligibility.summary,
  });
  const resumeStartArtifacts = await persistProgressSnapshot(artifactStore, resumeStartProgress);
  await persistRunSession(
    artifactStore,
    updateRunSessionRecord(session, {
      lastProgressSnapshotId: resumeStartProgress.id,
      outputArtifactPaths: [resumeStartArtifacts.history.path, resumeStartArtifacts.latest.path],
      summary: inspection.resumePlan?.summary ?? inspection.eligibility.summary,
    }),
  );
  manifest = updateSessionManifestRecord(manifest, {
    lastProgressSnapshotId: resumeStartProgress.id,
    artifactPaths: {
      ...manifest.artifactPaths,
      progressLatest: resumeStartArtifacts.latest.path,
    },
  });
  await persistSessionManifest(artifactStore, manifest);

  let nextStage: RunStage | undefined = inspection.eligibility.nextStage;

  while (nextStage) {
    if (nextStage === 'spec_normalized') {
      const sourceContent = await readFile(run.sourceSpecPath, 'utf8');
      spec = normalizeMarkdownSpec({
        content: sourceContent,
        repoRoot,
        sourcePath: run.sourceSpecPath,
      });
      const specArtifact = await artifactStore.writeJsonArtifact(
        'normalized-spec',
        'spec.normalized.json',
        spec,
        'Normalized markdown spec for this resumed run.',
      );
      await emitEvent('spec.normalized', {
        artifactPath: specArtifact.path,
        resumed: true,
      });
      nextStage = 'plan_created';
      continue;
    }

    if (nextStage === 'plan_created') {
      if (!spec) {
        throw new Error('Cannot resume planning because the normalized spec artifact is missing.');
      }

      plan = createPlanFromSpec(spec);
      const planArtifact = await artifactStore.writeJsonArtifact(
        'plan',
        'plan.json',
        plan,
        'Deterministic governed-run plan regenerated during resume.',
      );
      await emitEvent('plan.created', {
        artifactPath: planArtifact.path,
        resumed: true,
      });
      nextStage = 'policy_evaluated';
      continue;
    }

    if (nextStage === 'policy_evaluated') {
      if (!spec || !plan) {
        throw new Error(
          'Cannot resume policy evaluation because the spec or plan artifact is missing.',
        );
      }

      const { pack: policyPack, path: loadedPolicyPath } = await loadPolicyPackFromFile(
        run.policyPackPath,
      );
      impactPreview = generateImpactPreview({
        networkAccess: policyPack.defaults.networkAccess,
        plan,
        runId: run.id,
        sandboxMode: policyPack.defaults.sandboxMode,
        spec,
      });
      await artifactStore.writeJsonArtifact(
        'impact-preview',
        'impact-preview.json',
        impactPreview,
        'Impact preview regenerated during resume.',
      );
      await artifactStore.writeJsonArtifact(
        'policy-input',
        'policy.input.json',
        {
          approvalMode: run.approvalMode,
          impactPreview,
          policyPack: {
            defaults: policyPack.defaults,
            name: policyPack.name,
            path: loadedPolicyPath,
            version: policyPack.version,
          },
          specId: spec.id,
        },
        'Policy input regenerated during resume.',
      );
      policyDecision = evaluatePolicy({
        approvalMode: run.approvalMode,
        impactPreview,
        policyPack,
        policyPackPath: loadedPolicyPath,
        spec,
      });
      const policyDecisionArtifact = await artifactStore.writeJsonArtifact(
        'policy-decision',
        'policy.decision.json',
        policyDecision,
        'Policy decision regenerated during resume.',
      );
      await emitEvent('policy.evaluated', {
        artifactPath: policyDecisionArtifact.path,
        decision: policyDecision.decision,
        resumed: true,
      });

      if (policyDecision.decision === 'forbid') {
        run = updateRunStatus(
          run,
          'failed',
          policyDecision.reasons[0]?.summary ?? 'Policy pack forbids this run from executing.',
        );
        await persistRunStatus(artifactStore, run);
        manifest = updateSessionManifestRecord(manifest, {
          status: 'failed',
          summary: run.summary ?? 'Policy pack forbids this run from executing.',
        });
        await persistSessionManifest(artifactStore, manifest);
        await emitEvent('resume.failed', {
          reason: run.summary,
        });
        return statusRunId(runId, { cwd: repoRoot });
      }

      if (policyDecision.decision === 'prompt') {
        approvalPacket = createApprovalPacket({
          artifactPaths: [
            resolve(run.runDirectory, 'spec.normalized.json'),
            resolve(run.runDirectory, 'plan.json'),
            resolve(run.runDirectory, 'impact-preview.json'),
            resolve(run.runDirectory, 'policy.input.json'),
            resolve(run.runDirectory, 'policy.decision.json'),
          ],
          impactPreview,
          policyDecision,
          runId: run.id,
          spec,
        });
        await artifactStore.writeJsonArtifact(
          'approval-packet',
          'approval-packet.json',
          approvalPacket,
          'Approval packet regenerated during resume.',
        );
        await artifactStore.writeTextArtifact(
          'approval-packet-markdown',
          'approval-packet.md',
          renderApprovalPacketMarkdown(approvalPacket),
          'markdown',
          'Human-readable approval packet regenerated during resume.',
        );
        nextStage = 'awaiting_approval';
        continue;
      }

      nextStage = 'runner_started';
      continue;
    }

    if (nextStage === 'awaiting_approval') {
      if (!approvalPacket) {
        approvalPacket = await readJsonArtifact(
          resolve(run.runDirectory, 'approval-packet.json'),
          ApprovalPacketSchema,
          'approval packet',
        );
      }

      const resolveApproval =
        options.approvalResolver ??
        (process.stdin.isTTY && process.stdout.isTTY ? promptForApproval : undefined);

      if (!resolveApproval) {
        run = updateRunStatus(run, 'awaiting_approval', approvalPacket.decisionSummary);
        await persistRunStatus(artifactStore, run);
        manifest = updateSessionManifestRecord(manifest, {
          status: 'awaiting_approval',
          summary: approvalPacket.decisionSummary,
          approvalState: {
            required: true,
            status: 'pending',
            approvalPacketId: approvalPacket.id,
            artifactPaths: [
              resolve(run.runDirectory, 'approval-packet.json'),
              resolve(run.runDirectory, 'approval-packet.md'),
            ],
          },
        });
        await persistSessionManifest(artifactStore, manifest);
        await emitEvent('resume.completed', {
          status: 'awaiting_approval',
          summary: approvalPacket.decisionSummary,
        });
        return statusRunId(runId, { cwd: repoRoot });
      }

      approvalResolution = await resolveApproval(approvalPacket);
      const approvalResolutionRecord = createApprovalResolutionRecord({
        approvalPacketId: approvalPacket.id,
        notes:
          approvalResolution === 'approved'
            ? ['Approval granted from the resume flow.']
            : ['Approval denied from the resume flow.'],
        resolution: approvalResolution,
        runId: run.id,
      });
      await artifactStore.writeJsonArtifact(
        'approval-resolution',
        'approval-resolution.json',
        approvalResolutionRecord,
        'Recorded approval resolution for the resumed run.',
      );

      if (approvalResolution !== 'approved') {
        run = updateRunStatus(run, 'abandoned', 'Approval denied during resume.');
        await persistRunStatus(artifactStore, run);
        manifest = updateSessionManifestRecord(manifest, {
          status: 'abandoned',
          approvalState: {
            required: true,
            status: 'denied',
            approvalPacketId: approvalPacket.id,
            artifactPaths: [
              resolve(run.runDirectory, 'approval-packet.json'),
              resolve(run.runDirectory, 'approval-packet.md'),
              resolve(run.runDirectory, 'approval-resolution.json'),
            ],
          },
          pendingActions: [],
          summary: 'Approval denied during resume.',
        });
        await persistSessionManifest(artifactStore, manifest);
        await emitEvent('approval.denied', {
          approvalPacketId: approvalPacket.id,
          resolution: approvalResolution,
        });
        await emitEvent('resume.failed', {
          reason: 'Approval denied during resume.',
        });
        return statusRunId(runId, { cwd: repoRoot });
      }

      await emitEvent('approval.granted', {
        approvalPacketId: approvalPacket.id,
        resolution: approvalResolution,
      });
      nextStage = 'runner_started';
      continue;
    }

    if (nextStage === 'runner_started') {
      if (!spec || !plan || !policyDecision || !impactPreview) {
        throw new Error(
          'Cannot resume runner execution because required planning artifacts are missing.',
        );
      }

      const excludedRunPrefix = createRunRelativeDirectory(repoRoot, artifactStore.runDirectory);
      const beforeSnapshot = await captureWorkspaceSnapshot(repoRoot, {
        excludePrefixes: [excludedRunPrefix],
      });
      const runner = createRunner(run.runner === 'fake' ? 'fake' : 'codex-cli');

      run = updateRunStatus(run, 'in_progress', 'Resumed run is executing the runner stage.');
      run = updateRunStage(run, {
        currentStage: 'runner_started',
        pendingStage: 'runner_completed',
        sessionId: session.id,
        summary: 'Resumed run is executing the runner stage.',
      });
      await persistRunStatus(artifactStore, run);
      await emitEvent('runner.started', {
        resumed: true,
        runner: runner.kind,
      });

      runnerResult = await runner.execute({
        approvalPacket,
        impactPreview,
        plan,
        policyDecision,
        priorArtifacts: artifactStore.listArtifacts(),
        repoRoot,
        run,
        runDirectory: artifactStore.runDirectory,
        spec,
        verificationRequirements: describeVerificationScope(verificationConfig.commands),
      });

      await artifactStore.writeTextArtifact(
        'runner-prompt',
        'runner.prompt.md',
        runnerResult.prompt,
        'markdown',
        'Prompt prepared for the write-capable runner during resume.',
      );
      await artifactStore.writeTextArtifact(
        'runner-stdout',
        'runner.stdout.log',
        runnerResult.stdout,
        'text',
        'Raw runner stdout from resume.',
      );
      await artifactStore.writeTextArtifact(
        'runner-stderr',
        'runner.stderr.log',
        runnerResult.stderr,
        'text',
        'Raw runner stderr from resume.',
      );
      await artifactStore.writeJsonArtifact(
        'commands-executed',
        'commands-executed.json',
        runnerResult.commandCapture,
        'Captured executed commands from the resumed runner stage.',
      );
      await artifactStore.writeJsonArtifact(
        'runner-result',
        'runner.result.json',
        runnerResult,
        'Structured runner result from the resumed runner stage.',
      );

      const afterSnapshot = await captureWorkspaceSnapshot(repoRoot, {
        excludePrefixes: [excludedRunPrefix],
      });
      changedFiles = diffWorkspaceSnapshots(beforeSnapshot, afterSnapshot);
      diffPatch = await createDiffPatch(beforeSnapshot, afterSnapshot, changedFiles);
      await artifactStore.writeJsonArtifact(
        'changed-files',
        'changed-files.json',
        changedFiles,
        'Changed files captured during resume.',
      );
      await artifactStore.writeTextArtifact(
        'diff',
        'diff.patch',
        diffPatch,
        'patch',
        'Patch captured during resume.',
      );
      const { pack: policyPack } = await loadPolicyPackFromFile(run.policyPackPath);
      policyAudit = createPolicyAudit({
        approvalResolution,
        changedFiles,
        commandCapture: runnerResult.commandCapture,
        impactPreview,
        policyDecision,
        policyPack,
        spec,
      });
      await artifactStore.writeJsonArtifact(
        'policy-audit',
        'policy-audit.json',
        policyAudit,
        'Policy audit captured during resume.',
      );

      if (runnerResult.status !== 'completed') {
        run = updateRunStatus(run, 'interrupted', runnerResult.summary);
        await persistRunStatus(artifactStore, run);
        manifest = updateSessionManifestRecord(manifest, {
          status: 'interrupted',
          summary: runnerResult.summary,
        });
        await persistSessionManifest(artifactStore, manifest);
        await emitEvent('resume.failed', {
          reason: runnerResult.summary,
        });
        return statusRunId(runId, { cwd: repoRoot });
      }

      commandCapture = runnerResult.commandCapture;
      nextStage = 'verification_started';
      continue;
    }

    if (nextStage === 'verification_started') {
      if (
        !spec ||
        !plan ||
        !policyDecision ||
        !runnerResult ||
        !changedFiles ||
        !commandCapture ||
        diffPatch === undefined
      ) {
        throw new Error('Cannot resume verification because execution artifacts are missing.');
      }

      run = updateRunStatus(run, 'verifying', 'Running deterministic verification during resume.');
      run = updateRunStage(run, {
        currentStage: 'verification_started',
        pendingStage: 'verification_completed',
        sessionId: session.id,
        summary: 'Running deterministic verification during resume.',
      });
      await persistRunStatus(artifactStore, run);

      const verificationOutput = await runVerification({
        approvalPacket,
        approvalResolution,
        artifactStore,
        changedFiles,
        commandCapture,
        diffPatch,
        emitEvent,
        plan,
        policyAudit,
        policyDecision,
        repoRoot,
        run,
        runnerResult,
        spec,
      });
      const verificationResultPath = resolve(run.runDirectory, 'verification.result.json');

      run = updateRunStatus(
        run,
        verificationOutput.verificationResult.completionDecision.finalStatus,
        verificationOutput.verificationResult.summary,
      );
      run = updateRunVerification(run, {
        status: verificationOutput.verificationResult.status,
        resultPath: verificationResultPath,
        verifiedAt: verificationOutput.verificationResult.createdAt,
        summary: verificationOutput.verificationResult.summary,
      });
      run = updateRunStage(run, {
        currentStage: 'verification_completed',
        lastSuccessfulStage: 'verification_completed',
        pendingStage: undefined,
        sessionId: session.id,
        summary: verificationOutput.verificationResult.summary,
      });
      await persistRunStatus(artifactStore, run);
      manifest = updateSessionManifestRecord(manifest, {
        status: run.status,
        currentStage: 'verification_completed',
        lastSuccessfulStage: 'verification_completed',
        pendingStage: undefined,
        pendingStep: undefined,
        verificationState: {
          status: verificationOutput.verificationResult.status,
          summary: verificationOutput.verificationResult.summary,
          resultPath: verificationResultPath,
          lastVerifiedAt: verificationOutput.verificationResult.createdAt,
        },
        summary: verificationOutput.verificationResult.summary,
      });
      await persistSessionManifest(artifactStore, manifest);
      nextStage = undefined;
      break;
    }

    throw new Error(`Resume stage "${nextStage}" is not implemented safely yet.`);
  }

  await emitEvent('resume.completed', {
    status: run.status,
    summary: run.summary,
  });
  return statusRunId(runId, { cwd: repoRoot });
}

export function createProgram(): Command {
  const program = new Command();

  program.name('gdh').description('Governed delivery control plane CLI').version('0.2.0');

  program
    .command('run')
    .description('Normalize a spec and start a governed run')
    .argument('<spec-file>', 'Path to a local spec file')
    .option('--runner <runner>', 'Runner implementation to use', 'codex-cli')
    .option(
      '--approval-mode <mode>',
      'Approval handling mode (interactive or fail)',
      defaultApprovalMode(),
    )
    .option(
      '--policy <policy-file>',
      'Policy pack to evaluate before write-capable execution',
      'policies/default.policy.yaml',
    )
    .option('--json', 'Emit the final summary as JSON')
    .action(
      async (
        specFile: string,
        commandOptions: {
          approvalMode?: string;
          json?: boolean;
          policy?: string;
          runner?: string;
        },
      ) => {
        try {
          const runner = commandOptions.runner ?? 'codex-cli';
          const approvalMode = commandOptions.approvalMode ?? defaultApprovalMode();

          assertSupportedRunner(runner);
          assertSupportedApprovalMode(approvalMode);

          const summary = await runSpecFile(specFile, {
            approvalMode,
            cwd: process.cwd(),
            json: commandOptions.json,
            policyPath: commandOptions.policy,
            runner,
          });

          if (commandOptions.json) {
            console.log(JSON.stringify(summary, null, 2));
          } else {
            console.log(formatTerminalSummary(summary));
          }

          process.exitCode = summary.exitCode;
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      },
    );

  program
    .command('resume')
    .description('Resume a governed run')
    .argument('<run-id>', 'Run identifier')
    .option('--json', 'Emit the resume summary as JSON')
    .action(async (runId: string, commandOptions: { json?: boolean }) => {
      try {
        const summary = await resumeRunId(runId, {
          cwd: process.cwd(),
        });

        if (commandOptions.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(formatTerminalSummary(summary));
        }

        process.exitCode = summary.exitCode;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  program
    .command('status')
    .description('Inspect the durable state of a governed run')
    .argument('<run-id>', 'Run identifier')
    .option('--json', 'Emit the status summary as JSON')
    .action(async (runId: string, commandOptions: { json?: boolean }) => {
      try {
        const summary = await statusRunId(runId, {
          cwd: process.cwd(),
        });

        if (commandOptions.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(formatTerminalSummary(summary));
        }

        process.exitCode = summary.exitCode;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  program
    .command('approve')
    .description('Approve or reject a pending approval packet')
    .argument('<approval-id>', 'Approval packet identifier')
    .option('--yes', 'Approve the packet')
    .option('--no', 'Reject the packet')
    .action((approvalId: string) => {
      console.log(
        `Approvals are session-local in Phase 2. Re-run the owning spec with --approval-mode interactive to resolve "${approvalId}".`,
      );
      process.exitCode = 1;
    });

  program
    .command('verify')
    .description('Run verification for a governed run')
    .argument('<run-id>', 'Run identifier')
    .option('--json', 'Emit the final summary as JSON')
    .action(async (runId: string, commandOptions: { json?: boolean }) => {
      try {
        const summary = await verifyRunId(runId, {
          cwd: process.cwd(),
        });

        if (commandOptions.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(formatTerminalSummary(summary));
        }

        process.exitCode = summary.exitCode;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  program
    .command('report')
    .description('Generate a review packet')
    .argument('<run-id>', 'Run identifier')
    .action((runId: string) => {
      console.log(`Report regeneration is not implemented yet for run "${runId}".`);
      process.exitCode = 1;
    });

  program
    .command('benchmark')
    .description('Run a benchmark suite')
    .argument('<suite>', 'Benchmark suite name')
    .action((suite: string) => {
      console.log(`Benchmark is not implemented yet for suite "${suite}".`);
      process.exitCode = 1;
    });

  const githubCommand = program.command('github').description('GitHub integration commands');

  githubCommand
    .command('draft-pr')
    .description('Open a draft pull request for a completed run')
    .argument('<run-id>', 'Run identifier')
    .action((runId: string) => {
      console.log(`GitHub draft PR flow is not implemented yet for run "${runId}".`);
      process.exitCode = 1;
    });

  return program;
}

export async function run(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

const entrypoint = process.argv[1];

if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void run();
}
