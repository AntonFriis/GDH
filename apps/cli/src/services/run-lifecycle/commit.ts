import {
  createRunEvent,
  type Run,
  type RunCheckpoint,
  type RunEventType,
  type RunGithubState,
  type RunProgressSnapshot,
  type RunSession,
  type SessionManifest,
  updateRunGithubState,
  updateSessionManifestRecord,
  type WorkspaceSnapshot,
} from '@gdh/domain';
import {
  checkpointRelativePath,
  continuityRelativePath,
  progressLatestRelativePath,
  progressRelativePath,
  resumePlanRelativePath,
  sessionManifestRelativePath,
  sessionRelativePath,
  workspaceLatestRelativePath,
} from './context.js';
import type { ArtifactStore } from './types.js';

export async function persistRunSession(artifactStore: ArtifactStore, session: RunSession) {
  return artifactStore.writeJsonArtifact(
    'run-session',
    sessionRelativePath(session.id),
    session,
    'Durable session record for a governed run invocation.',
  );
}

export async function persistSessionManifest(
  artifactStore: ArtifactStore,
  manifest: SessionManifest,
) {
  return artifactStore.writeJsonArtifact(
    'session-manifest',
    sessionManifestRelativePath,
    manifest,
    'Durable run/session manifest for status inspection and resume.',
  );
}

export async function persistGithubState(
  artifactStore: ArtifactStore,
  run: Run,
  manifest: SessionManifest,
  github: RunGithubState,
): Promise<{ manifest: SessionManifest; run: Run }> {
  const updatedRun = updateRunGithubState(run, github);
  await persistRunStatus(artifactStore, updatedRun);
  const updatedManifest = updateSessionManifestRecord(manifest, {
    github,
  });
  await persistSessionManifest(artifactStore, updatedManifest);

  return {
    manifest: updatedManifest,
    run: updatedRun,
  };
}

export async function persistRunCheckpoint(
  artifactStore: ArtifactStore,
  checkpoint: RunCheckpoint,
) {
  return artifactStore.writeJsonArtifact(
    'run-checkpoint',
    checkpointRelativePath(checkpoint.id),
    checkpoint,
    'Restart-safe checkpoint for the governed run lifecycle.',
  );
}

export async function persistProgressSnapshot(
  artifactStore: ArtifactStore,
  progress: RunProgressSnapshot,
) {
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

export async function persistWorkspaceState(
  artifactStore: ArtifactStore,
  snapshot: WorkspaceSnapshot,
) {
  return artifactStore.writeJsonArtifact(
    'workspace-snapshot',
    workspaceLatestRelativePath,
    snapshot,
    'Latest workspace continuity snapshot for this run.',
  );
}

export async function persistContinuityAssessment(
  artifactStore: ArtifactStore,
  assessment: ReturnType<typeof import('@gdh/domain').createContinuityAssessmentRecord>,
) {
  return artifactStore.writeJsonArtifact(
    'continuity-assessment',
    continuityRelativePath(assessment.id),
    assessment,
    'Workspace continuity assessment for a resume or status inspection.',
  );
}

export async function persistResumePlan(
  artifactStore: ArtifactStore,
  plan: ReturnType<typeof import('@gdh/domain').createResumePlanRecord>,
) {
  return artifactStore.writeJsonArtifact(
    'resume-plan',
    resumePlanRelativePath(plan.id),
    plan,
    'Deterministic resume plan for the next safe stage.',
  );
}

export async function persistRunStatus(artifactStore: ArtifactStore, run: Run) {
  return artifactStore.writeRun(run);
}

export function stageLabel(stage: import('@gdh/domain').RunStage | undefined): string {
  return stage ?? 'unknown';
}

export async function appendRunEvent(
  artifactStore: ArtifactStore,
  runId: string,
  type: RunEventType,
  payload: Record<string, unknown>,
) {
  return artifactStore.appendEvent(createRunEvent(runId, type, payload));
}
