import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createArtifactStore, listArtifactReferencesFromRunDirectory } from '@gdh/artifact-store';
import {
  createPlanFromSpec,
  createRunProgressSnapshotRecord,
  createRunSessionRecord,
  ImpactPreviewSchema,
  IssueIngestionResultSchema,
  normalizeGithubIssueSpec,
  normalizeMarkdownSpec,
  updateRunSessionRecord,
  updateRunStage,
  updateRunStatus,
  updateSessionManifestRecord,
} from '@gdh/domain';
import { parseGithubIssueReference } from '@gdh/github-adapter';
import { loadPolicyPackFromFile } from '@gdh/policy-engine';
import { createIsoTimestamp, createRunId, findRepoRoot } from '@gdh/shared';
import { loadVerificationConfig } from '@gdh/verification';
import { assertReadableFile, readOptionalJsonArtifact } from '../../artifacts.js';
import { resolveGithubClient } from '../../github.js';
import { defaultApprovalMode, exitCodeForRunStatus } from '../../summaries.js';
import type { RunCommandSummary } from '../../types.js';
import {
  persistProgressSnapshot,
  persistRunSession,
  persistRunStatus,
  persistSessionManifest,
} from './commit.js';
import { loadRunContext } from './context.js';
import { prepareRunInspection } from './inspection.js';
import {
  advanceLifecycle,
  createFreshRunContext,
  finalizeFreshRun,
  rerunVerificationForExistingRun,
} from './transition-engine.js';
import type {
  LoadedPlan,
  LoadedSpec,
  RunLifecycleExecutionContext,
  RunLifecycleInspection,
  RunLifecycleService,
  RunLifecycleServiceDeps,
  RunResumeOptions,
  RunStatusOptions,
  StartRunInput,
} from './types.js';

function summarizeInspection(
  inspection: RunLifecycleInspection,
  artifactCount: number,
): RunCommandSummary {
  return {
    approvalPacketPath: inspection.state.approvalPacket
      ? resolve(inspection.run.runDirectory, 'approval-packet.md')
      : undefined,
    approvalResolution: inspection.state.approvalResolution,
    artifactCount,
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
    manifestPath: resolve(inspection.run.runDirectory, 'session.manifest.json'),
    nextStage: inspection.manifest.pendingStage ?? inspection.eligibility.nextStage,
    policyAuditPath: inspection.manifest.artifactPaths.policyAudit ?? 'not yet generated',
    policyDecision:
      inspection.state.policyDecision?.decision ?? inspection.manifest.policyDecision?.decision,
    reviewPacketPath: inspection.manifest.artifactPaths.reviewPacketMarkdown ?? 'not yet generated',
    resumeEligible: inspection.eligibility.eligible,
    resumeSummary: inspection.eligibility.summary,
    runId: inspection.run.id,
    specTitle: inspection.spec?.title ?? inspection.run.sourceSpecPath,
    status: inspection.run.status,
    summary: inspection.manifest.summary,
    verificationResultPath: inspection.run.verificationResultPath,
    verificationStatus: inspection.run.verificationStatus,
  };
}

export function createRunLifecycleService(deps: RunLifecycleServiceDeps = {}): RunLifecycleService {
  const findRepoRootFn = deps.findRepoRootFn ?? findRepoRoot;

  return {
    async run(input: StartRunInput): Promise<RunCommandSummary> {
      const repoRoot = await findRepoRootFn(input.cwd);
      const runnerKind = input.runner ?? 'codex-cli';
      const approvalMode = input.approvalMode ?? defaultApprovalMode();
      const absolutePolicyPath = resolve(
        input.cwd,
        input.policyPath ?? resolve(repoRoot, 'policies/default.policy.yaml'),
      );

      await assertReadableFile(absolutePolicyPath);

      let artifactStore: ReturnType<typeof createArtifactStore>;
      let githubIssue: RunLifecycleExecutionContext['githubIssue'];
      let githubState: RunLifecycleExecutionContext['githubState'];
      let issueIngestionResult: RunLifecycleExecutionContext['issueIngestionResult'];
      let normalizedSpec: LoadedSpec;
      let plan: LoadedPlan;
      let runId: string;
      const createRunIdFn = deps.createRunIdFn ?? createRunId;

      if (input.source.kind === 'github_issue') {
        const { adapter } = await resolveGithubClient(repoRoot, {
          githubAdapter: input.githubAdapter,
          githubConfig: input.githubConfig,
        });
        const ingestedIssue = await adapter.fetchIssue(parseGithubIssueReference(input.source.ref));

        githubIssue = ingestedIssue;
        runId = createRunIdFn(ingestedIssue.title);
        artifactStore = (deps.createArtifactStoreFn ?? createArtifactStore)({
          repoRoot,
          runId,
        });
        const sourcePath = artifactStore.resolveArtifactPath('github/issue.source.md');

        normalizedSpec = normalizeGithubIssueSpec({
          issue: ingestedIssue,
          repoRoot,
          sourcePath,
        });
        plan = createPlanFromSpec(normalizedSpec);
        issueIngestionResult = IssueIngestionResultSchema.parse({
          issue: ingestedIssue,
          spec: normalizedSpec,
          sourceSnapshotPath: sourcePath,
          createdAt: createIsoTimestamp(),
          summary: `GitHub issue ${ingestedIssue.repo.fullName}#${ingestedIssue.issueNumber} was normalized into a governed run spec.`,
        });
        githubState = {
          issue: ingestedIssue,
          issueIngestionPath: artifactStore.resolveArtifactPath('github/issue.ingestion.json'),
          iterationRequestPaths: [],
          updatedAt: createIsoTimestamp(),
        };
      } else {
        const absoluteSpecPath = resolve(input.cwd, input.source.path);

        await assertReadableFile(absoluteSpecPath);

        const sourceContent = await readFile(absoluteSpecPath, 'utf8');

        normalizedSpec = normalizeMarkdownSpec({
          content: sourceContent,
          repoRoot,
          sourcePath: absoluteSpecPath,
        });
        plan = createPlanFromSpec(normalizedSpec);
        runId = createRunIdFn(normalizedSpec.title);
        artifactStore = (deps.createArtifactStoreFn ?? createArtifactStore)({
          repoRoot,
          runId,
        });
      }

      const loadedPolicyPack = await loadPolicyPackFromFile(absolutePolicyPath);
      const verificationConfig = await loadVerificationConfig(repoRoot);

      await artifactStore.initialize();

      const context = await createFreshRunContext({
        approvalMode,
        approvalResolver: input.approvalResolver,
        artifactStore,
        cwd: input.cwd,
        githubIssue,
        githubState,
        issueIngestionResult,
        loadedPolicyPack,
        loadedPolicyPath: loadedPolicyPack.path,
        plan,
        repoRoot,
        runId,
        runnerKind,
        spec: normalizedSpec,
        verificationConfig,
      });

      await advanceLifecycle(context, 'spec_normalized');

      return finalizeFreshRun(context);
    },

    async status(runId: string, options: RunStatusOptions): Promise<RunLifecycleInspection> {
      const repoRoot = await findRepoRootFn(options.cwd);
      return prepareRunInspection(runId, repoRoot, {
        emitStatusRequested: options.emitStatusRequested,
      });
    },

    async resume(runId: string, options: RunResumeOptions): Promise<RunCommandSummary> {
      const repoRoot = await findRepoRootFn(options.cwd);
      const inspection = await prepareRunInspection(runId, repoRoot);

      if (!inspection.eligibility.eligible || !inspection.eligibility.nextStage) {
        throw new Error(inspection.eligibility.summary);
      }

      const loadedPolicyPack = await loadPolicyPackFromFile(inspection.run.policyPackPath);
      const verificationConfig = await loadVerificationConfig(repoRoot);
      const impactPreview = await readOptionalJsonArtifact(
        resolve(inspection.run.runDirectory, 'impact-preview.json'),
        ImpactPreviewSchema,
      );
      const session = createRunSessionRecord({
        runId: inspection.run.id,
        trigger: 'resume',
        startStage: inspection.eligibility.nextStage,
        startedFromCheckpointId: inspection.manifest.lastCheckpointId,
        summary: inspection.resumePlan?.summary ?? inspection.eligibility.summary,
      });
      const emitEvent = async (
        type: import('@gdh/domain').RunEventType,
        payload: Record<string, unknown>,
      ) =>
        inspection.artifactStore.appendEvent(
          (await import('@gdh/domain')).createRunEvent(inspection.run.id, type, payload),
        );

      let run = updateRunStatus(
        inspection.run,
        'resuming',
        inspection.resumePlan?.summary ?? inspection.eligibility.summary,
      );
      run = updateRunStage(run, {
        currentStage: inspection.eligibility.nextStage,
        pendingStage: inspection.eligibility.nextStage,
        sessionId: session.id,
        summary: inspection.resumePlan?.summary ?? inspection.eligibility.summary,
      });
      await persistRunStatus(inspection.artifactStore, run);
      await persistRunSession(inspection.artifactStore, session);
      let manifest = updateSessionManifestRecord(inspection.manifest, {
        currentSessionId: session.id,
        sessionIds: [...inspection.manifest.sessionIds, session.id],
        status: 'resuming',
        currentStage: inspection.eligibility.nextStage,
        pendingStage: inspection.eligibility.nextStage,
        summary: inspection.resumePlan?.summary ?? inspection.eligibility.summary,
      });
      await persistSessionManifest(inspection.artifactStore, manifest);
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
        approvedScope: inspection.state.policyDecision?.affectedPaths ?? [],
        verificationState: run.verificationStatus,
        artifactPaths: [
          inspection.manifest.latestContinuityAssessmentPath,
          inspection.manifest.latestResumePlanPath,
        ].filter(Boolean) as string[],
        nextRecommendedStep: `Resume the governed run from "${inspection.eligibility.nextStage}".`,
        summary: inspection.resumePlan?.summary ?? inspection.eligibility.summary,
      });
      const resumeStartArtifacts = await persistProgressSnapshot(
        inspection.artifactStore,
        resumeStartProgress,
      );
      await persistRunSession(
        inspection.artifactStore,
        updateRunSessionRecord(session, {
          lastProgressSnapshotId: resumeStartProgress.id,
          outputArtifactPaths: [
            resumeStartArtifacts.history.path,
            resumeStartArtifacts.latest.path,
          ],
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
      await persistSessionManifest(inspection.artifactStore, manifest);

      const context = {
        approvalMode: run.approvalMode,
        approvalPacket: inspection.state.approvalPacket,
        approvalResolver: options.approvalResolver,
        approvalResolution: inspection.state.approvalResolution,
        artifactStore: inspection.artifactStore,
        changedFiles: inspection.state.changedFiles,
        commandCapture: inspection.state.commandCapture,
        cwd: options.cwd,
        diffPatch: inspection.state.diffPatch,
        emitEvent,
        executedRunner: false,
        impactPreview,
        loadedPolicyPack,
        loadedPolicyPath: loadedPolicyPack.path,
        manifest,
        mode: 'resume' as const,
        plan: inspection.state.plan,
        policyAudit: inspection.state.policyAudit,
        policyDecision: inspection.state.policyDecision,
        repoRoot,
        run,
        runnerKind: run.runner,
        runnerResult: inspection.state.runnerResult,
        session,
        spec: inspection.state.spec,
        verificationConfig,
      };

      await advanceLifecycle(context, inspection.eligibility.nextStage);
      await emitEvent('resume.completed', {
        status: context.run.status,
        summary: context.run.summary,
      });

      const postResumeInspection = await prepareRunInspection(runId, repoRoot, {
        emitStatusRequested: true,
      });
      const artifacts = await listArtifactReferencesFromRunDirectory(
        postResumeInspection.run.id,
        postResumeInspection.run.runDirectory,
      );

      return summarizeInspection(postResumeInspection, artifacts.length);
    },
  };
}

export async function verifyRunLifecycle(
  runId: string,
  options: { cwd?: string } = {},
  deps: RunLifecycleServiceDeps = {},
): Promise<RunCommandSummary> {
  const findRepoRootFn = deps.findRepoRootFn ?? findRepoRoot;
  const repoRoot = await findRepoRootFn(options.cwd ?? process.cwd());
  const loaded = await loadRunContext(repoRoot, runId);
  const artifactStore = (deps.createArtifactStoreFn ?? createArtifactStore)({
    repoRoot,
    runId,
  });

  await artifactStore.initialize();

  return rerunVerificationForExistingRun({
    artifactStore,
    loaded,
    repoRoot,
  });
}

export { summarizeInspection };
