import { resolve } from 'node:path';
import { captureWorkspaceState, createArtifactStore } from '@gdh/artifact-store';
import {
  ContinuationContextSchema,
  createContinuityAssessmentRecord,
  createResumeEligibilityRecord,
  createResumePlanRecord,
  createRunEvent,
  createRunProgressSnapshotRecord,
  createWorkspaceSnapshotRecord,
  type ResumeEligibility,
  type Run,
  type RunCheckpoint,
  RunSessionSchema,
  type RunStage,
  type SessionManifest,
  updateRunResumeEligibility,
  updateRunSessionRecord,
  updateRunStage,
  updateRunStatus,
  updateSessionManifestRecord,
  type WorkspaceCompatibility,
  type WorkspaceSnapshot,
} from '@gdh/domain';
import { createIsoTimestamp } from '@gdh/shared';
import { readOptionalJsonArtifact } from '../../artifacts.js';
import {
  persistContinuityAssessment,
  persistProgressSnapshot,
  persistResumePlan,
  persistRunSession,
  persistRunStatus,
  persistSessionManifest,
  persistWorkspaceState,
  stageLabel,
} from './commit.js';
import {
  checkpointRelativePath,
  loadDurableRunState,
  progressLatestRelativePath,
  sessionManifestRelativePath,
  sessionRelativePath,
} from './context.js';
import type { LoadedDurableRunState, RunLifecycleInspection } from './types.js';

const activeRunStatuses = new Set<Run['status']>([
  'created',
  'planning',
  'running',
  'in_progress',
  'resuming',
  'verifying',
]);

export const gitHeadChangedContinuityReason =
  'Git HEAD changed since the last durable workspace snapshot.';

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

export function isTerminalStatus(status: Run['status']): boolean {
  return ['completed', 'failed', 'cancelled', 'abandoned'].includes(status);
}

export function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}

export function determineNextStage(state: {
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

export function requiredArtifactsForNextStage(
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

export function assessWorkspaceContinuity(input: {
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
    reasons.push(gitHeadChangedContinuityReason);
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

export function evaluateResumeEligibility(input: {
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
}) {
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

function buildResumePlan(input: { state: LoadedDurableRunState; eligibility: ResumeEligibility }) {
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

export async function prepareRunInspection(
  runId: string,
  repoRoot: string,
  options?: { emitStatusRequested?: boolean },
): Promise<RunLifecycleInspection> {
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
    type: import('@gdh/domain').RunEventType,
    payload: Record<string, unknown>,
  ) => {
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
    nextStage: eligibility.nextStage,
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
