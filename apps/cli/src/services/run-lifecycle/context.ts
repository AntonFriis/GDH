import { resolve } from 'node:path';
import { resolveRunDirectory } from '@gdh/artifact-store';
import {
  ApprovalPacketSchema,
  ApprovalResolutionRecordSchema,
  ChangedFileCaptureSchema,
  CommandCaptureSchema,
  PlanSchema,
  PolicyAuditResultSchema,
  PolicyEvaluationSchema,
  ReviewPacketSchema,
  RunCheckpointSchema,
  RunnerResultSchema,
  RunProgressSnapshotSchema,
  RunSchema,
  SessionManifestSchema,
  SpecSchema,
} from '@gdh/domain';
import {
  assertReadableFile,
  readJsonArtifact,
  readOptionalJsonArtifact,
  readOptionalTextArtifact,
  readTextArtifact,
} from '../../artifacts.js';
import type { LoadedDurableRunState, LoadedRunContext } from './types.js';

export const sessionManifestRelativePath = 'session.manifest.json';
export const progressLatestRelativePath = 'progress.latest.json';
export const checkpointDirectory = 'checkpoints';
export const progressDirectory = 'progress';
export const sessionsDirectory = 'sessions';
export const continuityDirectory = 'continuity';
export const resumeDirectory = 'resume';
export const workspaceLatestRelativePath = 'workspace.latest.json';

export function checkpointRelativePath(checkpointId: string): string {
  return `${checkpointDirectory}/${checkpointId}.json`;
}

export function progressRelativePath(progressId: string): string {
  return `${progressDirectory}/${progressId}.json`;
}

export function sessionRelativePath(sessionId: string): string {
  return `${sessionsDirectory}/${sessionId}.json`;
}

export function continuityRelativePath(assessmentId: string): string {
  return `${continuityDirectory}/${assessmentId}.json`;
}

export function resumePlanRelativePath(planId: string): string {
  return `${resumeDirectory}/${planId}.json`;
}

export async function loadRunContext(repoRoot: string, runId: string): Promise<LoadedRunContext> {
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

export async function loadReviewPacket(repoRoot: string, runId: string) {
  const runDirectory = resolveRunDirectory(repoRoot, runId);

  return readJsonArtifact(
    resolve(runDirectory, 'review-packet.json'),
    ReviewPacketSchema,
    'review packet',
  );
}

export async function loadDurableRunState(
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
