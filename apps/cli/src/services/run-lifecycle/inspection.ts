import { resolve } from 'node:path';
import {
  captureWorkspaceSnapshot,
  captureWorkspaceState,
  createArtifactStore,
  createRunRelativeDirectory,
  diffWorkspaceSnapshotArtifact,
} from '@gdh/artifact-store';
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
  runnerEntrySnapshotRelativePath,
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

function runnerCompletionArtifactPaths(runDirectory: string): string[] {
  return [
    resolve(runDirectory, 'runner.result.json'),
    resolve(runDirectory, 'commands-executed.json'),
    resolve(runDirectory, 'changed-files.json'),
    resolve(runDirectory, 'diff.patch'),
    resolve(runDirectory, 'policy-audit.json'),
  ];
}

function hasCompletedRunnerArtifacts(state: {
  changedFiles?: LoadedDurableRunState['changedFiles'];
  commandCapture?: LoadedDurableRunState['commandCapture'];
  diffPatch?: LoadedDurableRunState['diffPatch'];
  policyAudit?: LoadedDurableRunState['policyAudit'];
  runnerResult?: LoadedDurableRunState['runnerResult'];
}): boolean {
  return Boolean(
    state.runnerResult &&
      state.commandCapture &&
      state.changedFiles &&
      state.diffPatch !== undefined &&
      state.policyAudit,
  );
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

export function isTerminalStatus(status: Run['status']): boolean {
  return ['completed', 'failed', 'cancelled', 'abandoned'].includes(status);
}

export function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}

function pendingStepForStage(stage: RunStage | undefined): string | undefined {
  switch (stage) {
    case 'spec_normalized':
      return 'spec.normalized';
    case 'plan_created':
      return 'plan.created';
    case 'policy_evaluated':
      return 'policy.evaluated';
    case 'awaiting_approval':
      return 'approval.requested';
    case 'approval_resolved':
      return 'approval.resolved';
    case 'runner_started':
      return 'runner.started';
    case 'runner_completed':
      return 'runner.completed';
    case 'verification_started':
      return 'verification.started';
    case 'verification_completed':
      return 'verification.completed';
    default:
      return undefined;
  }
}

export function determineNextStage(state: {
  changedFiles?: LoadedDurableRunState['changedFiles'];
  commandCapture?: LoadedDurableRunState['commandCapture'];
  diffPatch?: LoadedDurableRunState['diffPatch'];
  manifest: SessionManifest;
  latestCheckpoint?: RunCheckpoint;
  policyAudit?: LoadedDurableRunState['policyAudit'];
  run: Run;
  runnerResult?: LoadedDurableRunState['runnerResult'];
}): RunStage | undefined {
  if (
    state.manifest.currentStage === 'runner_started' ||
    state.run.currentStage === 'runner_started'
  ) {
    return 'runner_started';
  }

  if (
    (state.manifest.currentStage === 'runner_completed' ||
      state.run.currentStage === 'runner_completed' ||
      state.manifest.pendingStage === 'verification_started') &&
    !hasCompletedRunnerArtifacts(state)
  ) {
    return undefined;
  }

  if (state.manifest.pendingStage === 'runner_completed' && !hasCompletedRunnerArtifacts(state)) {
    return 'runner_started';
  }

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
  const runnerEntrySnapshotRequired =
    Boolean(state.runnerEntrySnapshot) || Boolean(state.manifest.artifactPaths.runnerEntrySnapshot);
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
        ...(runnerEntrySnapshotRequired
          ? [resolve(runDirectory, runnerEntrySnapshotRelativePath)]
          : []),
        ...(state.manifest.approvalState.required
          ? [resolve(runDirectory, 'approval-resolution.json')]
          : []),
      ];
    case 'runner_completed':
      return [...baseArtifacts, ...runnerCompletionArtifactPaths(runDirectory)];
    case 'verification_started':
      return [...baseArtifacts, ...runnerCompletionArtifactPaths(runDirectory)];
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
  let latestProgress = initialState.latestProgress;
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

  let interruptedPartialChangedFiles = initialState.partialChangedFiles;
  let interruptedPartialChangedFilesArtifactPath: string | undefined;

  if (activeRunStatuses.has(manifest.status)) {
    interruptedPartialChangedFiles =
      !initialState.changedFiles &&
      initialState.runnerEntrySnapshot &&
      (manifest.currentStage === 'runner_started' || run.currentStage === 'runner_started')
        ? diffWorkspaceSnapshotArtifact(
            initialState.runnerEntrySnapshot,
            await captureWorkspaceSnapshot(repoRoot, {
              excludePrefixes: [createRunRelativeDirectory(repoRoot, run.runDirectory)],
            }),
          )
        : undefined;
    const nextInterruptedStage =
      determineNextStage({
        ...initialState,
        manifest,
        run,
      }) ?? manifest.currentStage;
    const interruptionSummary = `The previous session stopped before "${stageLabel(nextInterruptedStage)}" completed.`;
    const interruptionSummaryWithPartialEvidence =
      interruptedPartialChangedFiles && interruptedPartialChangedFiles.files.length > 0
        ? `${interruptionSummary} Partial changed files were captured from the interrupted runner workspace.`
        : interruptionSummary;

    run = updateRunStatus(run, 'interrupted', interruptionSummaryWithPartialEvidence);
    run = updateRunStage(run, {
      currentStage: run.currentStage,
      pendingStage:
        determineNextStage({
          ...initialState,
          manifest,
          run,
        }) ?? run.currentStage,
      interruptionReason: interruptionSummaryWithPartialEvidence,
    });
    await persistRunStatus(artifactStore, run);

    if (session) {
      session = updateRunSessionRecord(
        session,
        {
          status: 'interrupted',
          summary: interruptionSummaryWithPartialEvidence,
          interruptionReason: interruptionSummaryWithPartialEvidence,
          endedAt: createIsoTimestamp(),
        },
        createIsoTimestamp(),
      );
      await persistRunSession(artifactStore, session);
    }

    if (interruptedPartialChangedFiles) {
      const partialChangedFilesArtifact = await artifactStore.writeJsonArtifact(
        'changed-files-partial',
        'changed-files.partial.json',
        interruptedPartialChangedFiles,
        'Partial changed-file evidence derived from the persisted runner-entry snapshot after an interrupted runner stage.',
      );
      interruptedPartialChangedFilesArtifactPath = partialChangedFilesArtifact.path;
    }

    const interruptionProgress = createRunProgressSnapshotRecord({
      runId: run.id,
      sessionId: session?.id ?? manifest.currentSessionId,
      stage: run.currentStage,
      status: 'interrupted',
      justCompleted: `Interruption was detected after "${stageLabel(run.lastSuccessfulStage)}".`,
      remaining: [
        `Resume from "${stageLabel(
          determineNextStage({
            ...initialState,
            manifest,
            run,
          }) ?? run.currentStage,
        )}".`,
      ],
      blockers: ['The previous CLI invocation ended before the pending stage completed.'],
      currentRisks: uniqueStrings([
        'Resume will rely on the stored checkpoint and current workspace continuity.',
        interruptedPartialChangedFiles && interruptedPartialChangedFiles.files.length > 0
          ? `Partial changed-file evidence was captured for ${interruptedPartialChangedFiles.files.length} path(s).`
          : undefined,
      ]),
      approvedScope: initialState.policyDecision?.affectedPaths ?? [],
      verificationState: run.verificationStatus,
      artifactPaths: interruptedPartialChangedFilesArtifactPath
        ? [interruptedPartialChangedFilesArtifactPath]
        : [],
      nextRecommendedStep: `Inspect the run with "gdh status ${run.id}" or continue with "gdh resume ${run.id}".`,
      summary: interruptionSummaryWithPartialEvidence,
    });
    const interruptionProgressArtifacts = await persistProgressSnapshot(
      artifactStore,
      interruptionProgress,
    );
    latestProgress = interruptionProgress;
    manifest = updateSessionManifestRecord(manifest, {
      status: 'interrupted',
      currentStage: run.currentStage,
      pendingStage: nextInterruptedStage,
      pendingStep: pendingStepForStage(nextInterruptedStage),
      interruption: {
        detectedAt: createIsoTimestamp(),
        reason: 'previous_session_ended',
        summary: interruptionSummaryWithPartialEvidence,
      },
      lastProgressSnapshotId: interruptionProgress.id,
      summary: interruptionSummaryWithPartialEvidence,
    });
    await emitEvent('run.interrupted', {
      status: 'interrupted',
      summary: interruptionSummaryWithPartialEvidence,
    });
    manifest = updateSessionManifestRecord(manifest, {
      artifactPaths: {
        ...manifest.artifactPaths,
        ...(interruptedPartialChangedFilesArtifactPath
          ? { partialChangedFiles: interruptedPartialChangedFilesArtifactPath }
          : {}),
        progressLatest: interruptionProgressArtifacts.latest.path,
      },
    });
  }

  const requiredArtifactPaths = requiredArtifactsForNextStage(
    {
      ...initialState,
      changedFiles: initialState.changedFiles ?? interruptedPartialChangedFiles,
      manifest,
      run,
    },
    determineNextStage({
      manifest,
      latestCheckpoint: initialState.latestCheckpoint,
      run,
      changedFiles: initialState.changedFiles ?? interruptedPartialChangedFiles,
      commandCapture: initialState.commandCapture,
      diffPatch: initialState.diffPatch,
      policyAudit: initialState.policyAudit,
      runnerResult: initialState.runnerResult,
    }),
  );
  const currentWorkspaceSnapshot = await captureWorkspaceState(repoRoot, {
    expectedArtifactPaths: requiredArtifactPaths,
    knownRunChangedFiles:
      initialState.changedFiles?.files.map((file) => file.path) ??
      interruptedPartialChangedFiles?.files.map((file) => file.path) ??
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
  let eligibility = evaluateResumeEligibility({
    state: {
      ...initialState,
      changedFiles: initialState.changedFiles ?? interruptedPartialChangedFiles,
      manifest,
      run,
    },
    continuity,
  });
  if (
    interruptedPartialChangedFiles &&
    interruptedPartialChangedFiles.files.length > 0 &&
    eligibility.nextStage === 'runner_started'
  ) {
    eligibility = createResumeEligibilityRecord({
      ...eligibility,
      summary: `${eligibility.summary} Partial changed files were captured for inspection.`,
    });
  }
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
    currentStage: run.currentStage,
    pendingStage: eligibility.nextStage,
    pendingStep: pendingStepForStage(eligibility.nextStage),
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
    latestProgress,
    manifest,
    nextStage: eligibility.nextStage,
    resumePlan,
    run,
    spec: initialState.spec,
    state: {
      ...initialState,
      changedFiles: initialState.changedFiles ?? interruptedPartialChangedFiles,
      manifest,
      partialChangedFiles: interruptedPartialChangedFiles,
      run,
    },
  };
}
