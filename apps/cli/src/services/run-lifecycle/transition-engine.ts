import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  captureWorkspaceSnapshot,
  captureWorkspaceState,
  createDiffPatch,
  createRunRelativeDirectory,
  createWorkspaceContentSnapshotArtifact,
} from '@gdh/artifact-store';
import {
  ApprovalPacketSchema,
  type ClaimVerificationSummary,
  createPendingActionRecord,
  createPlanFromSpec,
  createResumeEligibilityRecord,
  createRunCheckpointRecord,
  createRunEvent,
  createRunProgressSnapshotRecord,
  createRunRecord,
  createRunSessionRecord,
  createSessionManifestRecord,
  normalizeGithubIssueSpec,
  normalizeMarkdownSpec,
  type RunEventType,
  type RunGithubState,
  type RunnerKind,
  type RunnerResult,
  RunnerResultSchema,
  updateRunResumeEligibility,
  updateRunSessionRecord,
  updateRunStage,
  updateRunStatus,
  updateRunVerification,
  updateSessionManifestRecord,
  type VerificationCommandResult,
} from '@gdh/domain';
import {
  createApprovalPacket,
  createApprovalResolutionRecord,
  createPolicyAudit,
  evaluatePolicy,
  generateImpactPreview,
  loadImpactPreviewHeuristics,
  renderApprovalPacketMarkdown,
} from '@gdh/policy-engine';
import { createReviewPacket, renderReviewPacketMarkdown } from '@gdh/review-packets';
import {
  createCodexCliRunner,
  createFakeRunner,
  defaultRunnerDefaults,
  type Runner,
  type RunnerProgressEvent,
} from '@gdh/runner-codex';
import { createIsoTimestamp } from '@gdh/shared';
import { describeVerificationScope, runVerification } from '@gdh/verification';
import { readJsonArtifact } from '../../artifacts.js';
import { renderGithubIssueSourceMarkdown, updateGithubState } from '../../github.js';
import {
  createEmptyCommandCapture,
  createSkippedRunnerResult,
  eventTypeForFinalRunStatus,
  eventTypeForRunnerStatus,
  exitCodeForRunStatus,
} from '../../summaries.js';
import type { RunCommandSummary } from '../../types.js';
import {
  persistGithubState,
  persistProgressSnapshot,
  persistRunCheckpoint,
  persistRunSession,
  persistRunStatus,
  persistSessionManifest,
  persistWorkspaceState,
} from './commit.js';
import {
  progressLatestRelativePath,
  runnerEntrySnapshotRelativePath,
  sessionManifestRelativePath,
} from './context.js';
import { uniqueStrings } from './inspection.js';
import type { RunLifecycleExecutionContext } from './types.js';

function createRunner(kind: RunnerKind): Runner {
  return kind === 'fake' ? createFakeRunner() : createCodexCliRunner();
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

function createStructuredRunnerFailureResult(error: unknown): RunnerResult {
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

function truncateRunnerProgressText(
  value: string | undefined,
  maxLength = 140,
): string | undefined {
  const trimmed = value?.replace(/\s+/gu, ' ').trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function extractRunnerMessageText(rawText: string | undefined): string | undefined {
  const trimmed = rawText?.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as { summary?: string; text?: string };

    return parsed.summary?.trim() || parsed.text?.trim() || truncateRunnerProgressText(trimmed);
  } catch {
    return truncateRunnerProgressText(trimmed);
  }
}

async function handleSpecNormalized(
  context: RunLifecycleExecutionContext,
): Promise<import('@gdh/domain').RunStage> {
  if (context.mode === 'resume') {
    if (context.run.github?.issue) {
      context.spec = normalizeGithubIssueSpec({
        issue: context.run.github.issue,
        repoRoot: context.repoRoot,
        sourcePath: context.run.sourceSpecPath,
      });
    } else {
      const sourceContent = await readFile(context.run.sourceSpecPath, 'utf8');
      context.spec = normalizeMarkdownSpec({
        content: sourceContent,
        repoRoot: context.repoRoot,
        sourcePath: context.run.sourceSpecPath,
      });
    }

    const specArtifact = await context.artifactStore.writeJsonArtifact(
      'normalized-spec',
      'spec.normalized.json',
      context.spec,
      'Normalized markdown spec for this resumed run.',
    );
    await context.emitEvent('spec.normalized', {
      artifactPath: specArtifact.path,
      resumed: true,
    });

    return 'plan_created';
  }

  if (!context.spec) {
    throw new Error('Cannot persist spec normalization because the normalized spec is missing.');
  }

  const normalizedSpecArtifact = await context.artifactStore.writeJsonArtifact(
    'normalized-spec',
    'spec.normalized.json',
    context.spec,
    'Normalized markdown spec for this run.',
  );
  await context.emitEvent('spec.normalized', {
    artifactPath: normalizedSpecArtifact.path,
    inferredFields: context.spec.inferredFields,
    normalizationNotes: context.spec.normalizationNotes,
  });
  const specCheckpoint = createRunCheckpointRecord({
    runId: context.run.id,
    sessionId: context.session.id,
    stage: 'spec_normalized',
    status: 'planning',
    requiredArtifactPaths: [context.artifactStore.resolveArtifactPath('run.json')],
    outputArtifactPaths: [normalizedSpecArtifact.path],
    restartable: true,
    rerunStageOnResume: false,
    resumeInstructions: ['Load the persisted normalized spec and continue with plan generation.'],
    lastSuccessfulStep: 'spec.normalized',
    pendingStep: 'plan.created',
    summary: 'Spec normalization completed and is safe to resume from plan generation.',
  });
  const specCheckpointArtifact = await persistRunCheckpoint(context.artifactStore, specCheckpoint);
  const specProgress = createRunProgressSnapshotRecord({
    runId: context.run.id,
    sessionId: context.session.id,
    stage: 'spec_normalized',
    status: 'planning',
    justCompleted: 'Normalized the source spec into the durable Spec artifact.',
    remaining: ['Generate the deterministic plan.', 'Evaluate policy before execution.'],
    currentRisks: context.spec.riskHints,
    approvedScope: [],
    verificationState: 'not_run',
    artifactPaths: [normalizedSpecArtifact.path, specCheckpointArtifact.path],
    nextRecommendedStep: 'Create the governed plan and persist the next checkpoint.',
    summary: 'Spec normalization completed.',
  });
  const specProgressArtifacts = await persistProgressSnapshot(context.artifactStore, specProgress);
  context.session = updateRunSessionRecord(context.session, {
    currentStage: 'spec_normalized',
    lastProgressSnapshotId: specProgress.id,
    outputArtifactPaths: uniqueStrings([
      ...context.session.outputArtifactPaths,
      normalizedSpecArtifact.path,
      specCheckpointArtifact.path,
      specProgressArtifacts.history.path,
      specProgressArtifacts.latest.path,
    ]),
    summary: 'Spec normalization completed.',
  });
  await persistRunSession(context.artifactStore, context.session);

  context.run = updateRunStatus(context.run, 'planning');
  context.run = updateRunStage(context.run, {
    currentStage: 'spec_normalized',
    lastSuccessfulStage: 'spec_normalized',
    pendingStage: 'plan_created',
    lastCheckpointId: specCheckpoint.id,
    lastProgressSnapshotId: specProgress.id,
    sessionId: context.session.id,
    summary: 'Spec normalization completed.',
  });
  await persistRunStatus(context.artifactStore, context.run);
  context.manifest = updateSessionManifestRecord(context.manifest, {
    currentStage: 'spec_normalized',
    lastSuccessfulStage: 'spec_normalized',
    lastSuccessfulStep: 'spec.normalized',
    pendingStage: 'plan_created',
    pendingStep: 'plan.created',
    lastCheckpointId: specCheckpoint.id,
    lastProgressSnapshotId: specProgress.id,
    artifactPaths: {
      ...context.manifest.artifactPaths,
      normalizedSpec: normalizedSpecArtifact.path,
      progressLatest: specProgressArtifacts.latest.path,
      lastCheckpoint: specCheckpointArtifact.path,
    },
    summary: 'Spec normalization completed.',
  });
  await persistSessionManifest(context.artifactStore, context.manifest);

  return 'plan_created';
}

async function handlePlanCreated(
  context: RunLifecycleExecutionContext,
): Promise<import('@gdh/domain').RunStage> {
  if (context.mode === 'resume') {
    if (!context.spec) {
      throw new Error('Cannot resume planning because the normalized spec artifact is missing.');
    }

    context.plan = createPlanFromSpec(context.spec);
    const planArtifact = await context.artifactStore.writeJsonArtifact(
      'plan',
      'plan.json',
      context.plan,
      'Deterministic governed-run plan regenerated during resume.',
    );
    await context.emitEvent('plan.created', {
      artifactPath: planArtifact.path,
      resumed: true,
    });

    return 'policy_evaluated';
  }

  if (!context.plan || !context.spec) {
    throw new Error('Cannot persist the plan because the plan or spec is missing.');
  }

  const planArtifact = await context.artifactStore.writeJsonArtifact(
    'plan',
    'plan.json',
    context.plan,
    'Deterministic governed-run plan.',
  );
  await context.emitEvent('plan.created', {
    artifactPath: planArtifact.path,
    doneConditions: context.plan.doneConditions,
    taskUnitCount: context.plan.taskUnits.length,
  });
  const planCheckpoint = createRunCheckpointRecord({
    runId: context.run.id,
    sessionId: context.session.id,
    stage: 'plan_created',
    status: 'planning',
    requiredArtifactPaths: [resolve(context.run.runDirectory, 'spec.normalized.json')],
    outputArtifactPaths: [planArtifact.path],
    restartable: true,
    rerunStageOnResume: false,
    resumeInstructions: ['Load the persisted plan and continue with policy evaluation.'],
    lastSuccessfulStep: 'plan.created',
    pendingStep: 'policy.evaluated',
    summary: 'Plan generation completed and is safe to resume from policy evaluation.',
  });
  const planCheckpointArtifact = await persistRunCheckpoint(context.artifactStore, planCheckpoint);
  const planProgress = createRunProgressSnapshotRecord({
    runId: context.run.id,
    sessionId: context.session.id,
    stage: 'plan_created',
    status: 'planning',
    justCompleted: 'Created the deterministic governed-run plan.',
    remaining: ['Generate impact preview.', 'Evaluate policy and approval requirements.'],
    currentRisks: context.spec.riskHints,
    approvedScope: [],
    verificationState: 'not_run',
    artifactPaths: [planArtifact.path, planCheckpointArtifact.path],
    nextRecommendedStep: 'Evaluate the planned scope against the selected policy pack.',
    summary: 'Plan generation completed.',
  });
  const planProgressArtifacts = await persistProgressSnapshot(context.artifactStore, planProgress);
  context.session = updateRunSessionRecord(context.session, {
    currentStage: 'plan_created',
    lastProgressSnapshotId: planProgress.id,
    outputArtifactPaths: uniqueStrings([
      ...context.session.outputArtifactPaths,
      planArtifact.path,
      planCheckpointArtifact.path,
      planProgressArtifacts.history.path,
      planProgressArtifacts.latest.path,
    ]),
    summary: 'Plan generation completed.',
  });
  await persistRunSession(context.artifactStore, context.session);
  context.run = updateRunStage(context.run, {
    currentStage: 'plan_created',
    lastSuccessfulStage: 'plan_created',
    pendingStage: 'policy_evaluated',
    lastCheckpointId: planCheckpoint.id,
    lastProgressSnapshotId: planProgress.id,
    sessionId: context.session.id,
    summary: 'Plan generation completed.',
  });
  await persistRunStatus(context.artifactStore, context.run);
  context.manifest = updateSessionManifestRecord(context.manifest, {
    currentStage: 'plan_created',
    lastSuccessfulStage: 'plan_created',
    lastSuccessfulStep: 'plan.created',
    pendingStage: 'policy_evaluated',
    pendingStep: 'policy.evaluated',
    lastCheckpointId: planCheckpoint.id,
    lastProgressSnapshotId: planProgress.id,
    artifactPaths: {
      ...context.manifest.artifactPaths,
      plan: planArtifact.path,
      progressLatest: planProgressArtifacts.latest.path,
      lastCheckpoint: planCheckpointArtifact.path,
    },
    summary: 'Plan generation completed.',
  });
  await persistSessionManifest(context.artifactStore, context.manifest);

  return 'policy_evaluated';
}

async function handlePolicyEvaluated(
  context: RunLifecycleExecutionContext,
): Promise<import('@gdh/domain').RunStage | undefined> {
  if (!context.spec || !context.plan) {
    throw new Error('Cannot evaluate policy because the spec or plan is missing.');
  }

  const impactPreviewHeuristics = await loadImpactPreviewHeuristics(context.run.repoRoot);
  context.impactPreview = generateImpactPreview({
    heuristics: impactPreviewHeuristics,
    networkAccess: context.loadedPolicyPack.pack.defaults.networkAccess,
    plan: context.plan,
    runId: context.run.id,
    sandboxMode: context.loadedPolicyPack.pack.defaults.sandboxMode,
    spec: context.spec,
  });
  const impactPreviewArtifact = await context.artifactStore.writeJsonArtifact(
    'impact-preview',
    'impact-preview.json',
    context.impactPreview,
    context.mode === 'resume'
      ? 'Impact preview regenerated during resume.'
      : 'Read-only impact preview generated before write-capable execution.',
  );
  await context.emitEvent('impact_preview.created', {
    actionKinds: context.impactPreview.actionKinds,
    artifactPath: impactPreviewArtifact.path,
    requestedNetworkAccess: context.impactPreview.requestedNetworkAccess,
    requestedSandboxMode: context.impactPreview.requestedSandboxMode,
  });

  const policyInputArtifact = await context.artifactStore.writeJsonArtifact(
    'policy-input',
    'policy.input.json',
    {
      approvalMode: context.approvalMode,
      impactPreview: context.impactPreview,
      policyPack: {
        defaults: context.loadedPolicyPack.pack.defaults,
        name: context.loadedPolicyPack.pack.name,
        path: context.loadedPolicyPath,
        version: context.loadedPolicyPack.pack.version,
      },
      specId: context.spec.id,
    },
    context.mode === 'resume'
      ? 'Policy input regenerated during resume.'
      : 'Policy evaluation input snapshot.',
  );

  context.policyDecision = evaluatePolicy({
    approvalMode: context.approvalMode,
    impactPreview: context.impactPreview,
    policyPack: context.loadedPolicyPack.pack,
    policyPackPath: context.loadedPolicyPath,
    spec: context.spec,
  });
  const policyDecisionArtifact = await context.artifactStore.writeJsonArtifact(
    'policy-decision',
    'policy.decision.json',
    context.policyDecision,
    context.mode === 'resume'
      ? 'Policy decision regenerated during resume.'
      : 'Structured policy decision for the impact preview.',
  );
  await context.emitEvent('policy.evaluated', {
    artifactPath: policyDecisionArtifact.path,
    decision: context.policyDecision.decision,
    ...(context.mode === 'resume'
      ? { resumed: true }
      : { matchedRuleIds: context.policyDecision.matchedRules.map((rule) => rule.ruleId) }),
  });

  if (context.mode === 'fresh') {
    context.run = updateRunStatus(
      context.run,
      'running',
      context.policyDecision.reasons[0]?.summary ?? undefined,
    );
    await persistRunStatus(context.artifactStore, context.run);

    const policyCheckpoint = createRunCheckpointRecord({
      runId: context.run.id,
      sessionId: context.session.id,
      stage: 'policy_evaluated',
      status: context.policyDecision.decision === 'prompt' ? 'awaiting_approval' : 'in_progress',
      requiredArtifactPaths: [
        resolve(context.run.runDirectory, 'plan.json'),
        impactPreviewArtifact.path,
        policyInputArtifact.path,
      ],
      outputArtifactPaths: [policyDecisionArtifact.path],
      restartable: true,
      rerunStageOnResume: false,
      resumeInstructions:
        context.policyDecision.decision === 'prompt'
          ? ['Load the persisted approval packet and continue through approval resolution.']
          : ['Continue to runner execution using the persisted policy decision.'],
      lastSuccessfulStep: 'policy.evaluated',
      pendingStep:
        context.policyDecision.decision === 'prompt' ? 'approval.requested' : 'runner.started',
      summary:
        context.policyDecision.decision === 'prompt'
          ? 'Policy evaluation completed and is paused at the approval boundary.'
          : 'Policy evaluation completed and execution may proceed.',
    });
    const policyCheckpointArtifact = await persistRunCheckpoint(
      context.artifactStore,
      policyCheckpoint,
    );
    const policyProgress = createRunProgressSnapshotRecord({
      runId: context.run.id,
      sessionId: context.session.id,
      stage: 'policy_evaluated',
      status: context.policyDecision.decision === 'prompt' ? 'awaiting_approval' : 'in_progress',
      justCompleted: 'Evaluated the predicted scope against the selected policy pack.',
      remaining:
        context.policyDecision.decision === 'prompt'
          ? ['Resolve the approval request.', 'Execute the approved runner stage.']
          : [
              'Execute the write-capable runner.',
              'Capture execution artifacts and verification evidence.',
            ],
      blockers:
        context.policyDecision.decision === 'prompt'
          ? ['Human approval is required before write-capable execution may continue.']
          : [],
      currentRisks: context.policyDecision.uncertaintyNotes,
      approvedScope: context.policyDecision.affectedPaths,
      verificationState: 'not_run',
      artifactPaths: [policyDecisionArtifact.path, policyCheckpointArtifact.path],
      nextRecommendedStep:
        context.policyDecision.decision === 'prompt'
          ? 'Resolve the approval packet or resume later from the paused approval boundary.'
          : 'Start the write-capable runner within the governed scope.',
      summary:
        context.policyDecision.decision === 'prompt'
          ? 'Policy evaluation completed and approval is required.'
          : 'Policy evaluation completed and execution may proceed.',
    });
    const policyProgressArtifacts = await persistProgressSnapshot(
      context.artifactStore,
      policyProgress,
    );
    context.session = updateRunSessionRecord(context.session, {
      currentStage: 'policy_evaluated',
      lastProgressSnapshotId: policyProgress.id,
      outputArtifactPaths: uniqueStrings([
        ...context.session.outputArtifactPaths,
        impactPreviewArtifact.path,
        policyInputArtifact.path,
        policyDecisionArtifact.path,
        policyCheckpointArtifact.path,
        policyProgressArtifacts.history.path,
        policyProgressArtifacts.latest.path,
      ]),
      summary: policyProgress.summary,
    });
    await persistRunSession(context.artifactStore, context.session);
    context.run = updateRunStage(context.run, {
      currentStage: 'policy_evaluated',
      lastSuccessfulStage: 'policy_evaluated',
      pendingStage:
        context.policyDecision.decision === 'prompt' ? 'awaiting_approval' : 'runner_started',
      lastCheckpointId: policyCheckpoint.id,
      lastProgressSnapshotId: policyProgress.id,
      sessionId: context.session.id,
      summary: policyProgress.summary,
    });
    await persistRunStatus(context.artifactStore, context.run);
    context.manifest = updateSessionManifestRecord(context.manifest, {
      currentStage: 'policy_evaluated',
      lastSuccessfulStage: 'policy_evaluated',
      lastSuccessfulStep: 'policy.evaluated',
      pendingStage:
        context.policyDecision.decision === 'prompt' ? 'awaiting_approval' : 'runner_started',
      pendingStep:
        context.policyDecision.decision === 'prompt' ? 'approval.requested' : 'runner.started',
      policyDecision: {
        artifactPath: policyDecisionArtifact.path,
        decision: context.policyDecision.decision,
        requiredApprovalMode: context.policyDecision.requiredApprovalMode,
        summary:
          context.policyDecision.reasons[0]?.summary ??
          'Policy evaluation completed without a summary.',
      },
      lastCheckpointId: policyCheckpoint.id,
      lastProgressSnapshotId: policyProgress.id,
      artifactPaths: {
        ...context.manifest.artifactPaths,
        impactPreview: impactPreviewArtifact.path,
        policyInput: policyInputArtifact.path,
        policyDecision: policyDecisionArtifact.path,
        progressLatest: policyProgressArtifacts.latest.path,
        lastCheckpoint: policyCheckpointArtifact.path,
      },
      summary: policyProgress.summary,
    });
    await persistSessionManifest(context.artifactStore, context.manifest);
  }

  if (context.policyDecision.decision === 'forbid') {
    context.run = updateRunStatus(
      context.run,
      'failed',
      context.policyDecision.reasons[0]?.summary ?? 'Policy pack forbids this run from executing.',
    );
    context.run = updateRunStage(context.run, {
      currentStage: 'policy_evaluated',
      lastSuccessfulStage: 'policy_evaluated',
      pendingStage: undefined,
      summary:
        context.policyDecision.reasons[0]?.summary ??
        'Policy pack forbids this run from executing.',
      sessionId: context.mode === 'fresh' ? context.session.id : undefined,
    });
    await persistRunStatus(context.artifactStore, context.run);
    await context.emitEvent('policy.blocked', {
      decision: context.policyDecision.decision,
      matchedRuleIds: context.policyDecision.matchedRules.map((rule) => rule.ruleId),
    });

    if (context.mode === 'fresh') {
      context.session = updateRunSessionRecord(context.session, {
        status: 'completed',
        currentStage: 'policy_evaluated',
        summary:
          context.policyDecision.reasons[0]?.summary ??
          'Policy pack forbids this run from executing.',
      });
      await persistRunSession(context.artifactStore, context.session);
      context.manifest = updateSessionManifestRecord(context.manifest, {
        status: 'failed',
        currentStage: 'policy_evaluated',
        pendingStage: undefined,
        pendingStep: undefined,
        pendingActions: [],
        summary:
          context.policyDecision.reasons[0]?.summary ??
          'Policy pack forbids this run from executing.',
      });
      await persistSessionManifest(context.artifactStore, context.manifest);
    } else {
      context.manifest = updateSessionManifestRecord(context.manifest, {
        status: 'failed',
        summary: context.run.summary ?? 'Policy pack forbids this run from executing.',
      });
      await persistSessionManifest(context.artifactStore, context.manifest);
      await context.emitEvent('resume.failed', {
        reason: context.run.summary,
      });
    }

    context.runnerResult = createSkippedRunnerResult(
      context.policyDecision.reasons[0]?.summary ?? 'Policy pack forbids this run from executing.',
    );
    context.commandCapture = context.runnerResult.commandCapture;
    return undefined;
  }

  if (context.policyDecision.decision === 'prompt') {
    context.approvalPacket = createApprovalPacket({
      artifactPaths: [
        resolve(context.run.runDirectory, 'spec.normalized.json'),
        resolve(context.run.runDirectory, 'plan.json'),
        impactPreviewArtifact.path,
        policyInputArtifact.path,
        policyDecisionArtifact.path,
      ],
      impactPreview: context.impactPreview,
      policyDecision: context.policyDecision,
      runId: context.run.id,
      spec: context.spec,
    });
    const approvalMarkdown = renderApprovalPacketMarkdown(context.approvalPacket);

    context.approvalPacketArtifact = await context.artifactStore.writeJsonArtifact(
      'approval-packet',
      'approval-packet.json',
      context.approvalPacket,
      context.mode === 'resume'
        ? 'Approval packet regenerated during resume.'
        : 'Machine-readable approval packet for a prompted run.',
    );
    context.approvalPacketMarkdownArtifact = await context.artifactStore.writeTextArtifact(
      'approval-packet-markdown',
      'approval-packet.md',
      approvalMarkdown,
      'markdown',
      context.mode === 'resume'
        ? 'Human-readable approval packet regenerated during resume.'
        : 'Human-readable approval packet for a prompted run.',
    );

    if (context.mode === 'fresh') {
      context.run = updateRunStatus(
        context.run,
        'awaiting_approval',
        context.approvalPacket.decisionSummary,
      );
      context.run = updateRunStage(context.run, {
        currentStage: 'awaiting_approval',
        pendingStage: 'awaiting_approval',
        summary: context.approvalPacket.decisionSummary,
        sessionId: context.session.id,
      });
      await persistRunStatus(context.artifactStore, context.run);
      await context.emitEvent('approval.requested', {
        approvalPacketId: context.approvalPacket.id,
        artifactPaths: [
          context.approvalPacketArtifact.path,
          context.approvalPacketMarkdownArtifact.path,
        ],
        decision: context.policyDecision.decision,
      });
      const approvalPendingProgress = createRunProgressSnapshotRecord({
        runId: context.run.id,
        sessionId: context.session.id,
        stage: 'awaiting_approval',
        status: 'awaiting_approval',
        justCompleted: 'Persisted the approval packet required for this run.',
        remaining: [
          'Resolve the approval request.',
          'Resume runner execution if approval is granted.',
        ],
        blockers: ['Human approval is required before write-capable execution may continue.'],
        currentRisks: context.approvalPacket.riskSummary,
        approvedScope: context.policyDecision.affectedPaths,
        verificationState: 'not_run',
        artifactPaths: [
          context.approvalPacketArtifact.path,
          context.approvalPacketMarkdownArtifact.path,
        ],
        nextRecommendedStep: `Inspect the approval packet and continue with "gdh resume ${context.run.id}" once a human is ready to resolve it.`,
        summary: context.approvalPacket.decisionSummary,
      });
      const approvalPendingProgressArtifacts = await persistProgressSnapshot(
        context.artifactStore,
        approvalPendingProgress,
      );
      context.session = updateRunSessionRecord(context.session, {
        currentStage: 'awaiting_approval',
        lastProgressSnapshotId: approvalPendingProgress.id,
        outputArtifactPaths: uniqueStrings([
          ...context.session.outputArtifactPaths,
          context.approvalPacketArtifact.path,
          context.approvalPacketMarkdownArtifact.path,
          approvalPendingProgressArtifacts.history.path,
          approvalPendingProgressArtifacts.latest.path,
        ]),
        summary: context.approvalPacket.decisionSummary,
      });
      await persistRunSession(context.artifactStore, context.session);
      context.manifest = updateSessionManifestRecord(context.manifest, {
        status: 'awaiting_approval',
        currentStage: 'awaiting_approval',
        pendingStage: 'awaiting_approval',
        pendingStep: 'approval.requested',
        approvalState: {
          required: true,
          status: 'pending',
          approvalPacketId: context.approvalPacket.id,
          artifactPaths: [
            context.approvalPacketArtifact.path,
            context.approvalPacketMarkdownArtifact.path,
          ],
        },
        pendingActions: [
          createPendingActionRecord({
            runId: context.run.id,
            kind: 'approval',
            title: 'Resolve approval request',
            summary: context.approvalPacket.decisionSummary,
            artifactPaths: [
              context.approvalPacketArtifact.path,
              context.approvalPacketMarkdownArtifact.path,
            ],
          }),
        ],
        lastProgressSnapshotId: approvalPendingProgress.id,
        artifactPaths: {
          ...context.manifest.artifactPaths,
          approvalPacket: context.approvalPacketArtifact.path,
          approvalPacketMarkdown: context.approvalPacketMarkdownArtifact.path,
          progressLatest: approvalPendingProgressArtifacts.latest.path,
        },
        summary: context.approvalPacket.decisionSummary,
      });
      await persistSessionManifest(context.artifactStore, context.manifest);
    }

    return 'awaiting_approval';
  }

  return 'runner_started';
}

async function handleAwaitingApproval(
  context: RunLifecycleExecutionContext,
): Promise<import('@gdh/domain').RunStage | undefined> {
  if (!context.approvalPacket) {
    context.approvalPacket = await readJsonArtifact(
      resolve(context.run.runDirectory, 'approval-packet.json'),
      ApprovalPacketSchema,
      'approval packet',
    );
  }

  const approvalResolutionArtifact = resolve(context.run.runDirectory, 'approval-resolution.json');

  if (!context.approvalResolution && context.approvalResolver) {
    context.approvalResolution = await context.approvalResolver(context.approvalPacket);
    const approvalResolutionRecord = createApprovalResolutionRecord({
      approvalPacketId: context.approvalPacket.id,
      notes:
        context.approvalResolution === 'approved'
          ? [
              context.mode === 'fresh'
                ? 'Approval granted from the interactive CLI flow.'
                : 'Approval granted from the resume flow.',
            ]
          : [
              context.mode === 'fresh'
                ? 'Approval denied from the interactive CLI flow.'
                : 'Approval denied from the resume flow.',
            ],
      resolution: context.approvalResolution,
      runId: context.run.id,
    });
    await context.artifactStore.writeJsonArtifact(
      'approval-resolution',
      'approval-resolution.json',
      approvalResolutionRecord,
      context.mode === 'fresh'
        ? 'Recorded approval resolution for this run.'
        : 'Recorded approval resolution for the resumed run.',
    );
  }

  if (!context.approvalResolution) {
    if (context.mode === 'resume') {
      context.run = updateRunStatus(
        context.run,
        'awaiting_approval',
        context.approvalPacket.decisionSummary,
      );
      await persistRunStatus(context.artifactStore, context.run);
      context.manifest = updateSessionManifestRecord(context.manifest, {
        status: 'awaiting_approval',
        summary: context.approvalPacket.decisionSummary,
        approvalState: {
          required: true,
          status: 'pending',
          approvalPacketId: context.approvalPacket.id,
          artifactPaths: [
            resolve(context.run.runDirectory, 'approval-packet.json'),
            resolve(context.run.runDirectory, 'approval-packet.md'),
          ],
        },
      });
      await persistSessionManifest(context.artifactStore, context.manifest);
    } else {
      context.runnerResult = createSkippedRunnerResult(
        `Approval "${context.approvalPacket.id}" is required. Re-run with --approval-mode interactive to review it.`,
      );
      context.commandCapture = context.runnerResult.commandCapture;
    }

    return undefined;
  }

  if (context.approvalResolution !== 'approved') {
    context.run = updateRunStatus(
      context.run,
      'abandoned',
      context.mode === 'fresh'
        ? 'Approval denied; the run stopped before execution.'
        : 'Approval denied during resume.',
    );
    context.run = updateRunStage(context.run, {
      currentStage: 'approval_resolved',
      lastSuccessfulStage: 'approval_resolved',
      pendingStage: undefined,
      summary: context.run.summary,
      sessionId: context.mode === 'fresh' ? context.session.id : undefined,
    });
    await persistRunStatus(context.artifactStore, context.run);
    await context.emitEvent('approval.denied', {
      approvalPacketId: context.approvalPacket.id,
      resolution: context.approvalResolution,
    });

    if (context.mode === 'fresh') {
      context.session = updateRunSessionRecord(context.session, {
        status: 'completed',
        currentStage: 'approval_resolved',
        summary: 'Approval denied; the run was abandoned before execution.',
      });
      await persistRunSession(context.artifactStore, context.session);
      context.manifest = updateSessionManifestRecord(context.manifest, {
        status: 'abandoned',
        currentStage: 'approval_resolved',
        lastSuccessfulStage: 'approval_resolved',
        lastSuccessfulStep: 'approval.denied',
        pendingStage: undefined,
        pendingStep: undefined,
        approvalState: {
          required: true,
          status: 'denied',
          approvalPacketId: context.approvalPacket.id,
          artifactPaths: [
            resolve(context.run.runDirectory, 'approval-packet.json'),
            resolve(context.run.runDirectory, 'approval-packet.md'),
            approvalResolutionArtifact,
          ],
        },
        pendingActions: [],
        summary: 'Approval denied; the run was abandoned before execution.',
      });
      await persistSessionManifest(context.artifactStore, context.manifest);
      context.runnerResult = createSkippedRunnerResult(
        `Approval "${context.approvalPacket.id}" was denied; the governed run stopped before execution.`,
      );
    } else {
      context.manifest = updateSessionManifestRecord(context.manifest, {
        status: 'abandoned',
        approvalState: {
          required: true,
          status: 'denied',
          approvalPacketId: context.approvalPacket.id,
          artifactPaths: [
            resolve(context.run.runDirectory, 'approval-packet.json'),
            resolve(context.run.runDirectory, 'approval-packet.md'),
            resolve(context.run.runDirectory, 'approval-resolution.json'),
          ],
        },
        pendingActions: [],
        summary: 'Approval denied during resume.',
      });
      await persistSessionManifest(context.artifactStore, context.manifest);
      await context.emitEvent('resume.failed', {
        reason: 'Approval denied during resume.',
      });
    }

    context.commandCapture = context.runnerResult?.commandCapture;
    return undefined;
  }

  context.run = updateRunStatus(
    context.run,
    'in_progress',
    'Approval granted; write-capable execution may proceed.',
  );
  context.run = updateRunStage(context.run, {
    currentStage: 'approval_resolved',
    lastSuccessfulStage: 'approval_resolved',
    pendingStage: 'runner_started',
    summary: 'Approval granted; write-capable execution may proceed.',
    sessionId: context.mode === 'fresh' ? context.session.id : undefined,
  });
  await persistRunStatus(context.artifactStore, context.run);
  await context.emitEvent('approval.granted', {
    approvalPacketId: context.approvalPacket.id,
    resolution: context.approvalResolution,
  });

  const approvalCheckpoint = createRunCheckpointRecord({
    runId: context.run.id,
    sessionId: context.session.id,
    stage: 'approval_resolved',
    status: 'in_progress',
    requiredArtifactPaths: [
      resolve(context.run.runDirectory, 'approval-packet.json'),
      resolve(context.run.runDirectory, 'approval-packet.md'),
    ],
    outputArtifactPaths: [approvalResolutionArtifact],
    restartable: true,
    rerunStageOnResume: false,
    resumeInstructions: ['Reuse the approved resolution and continue with runner execution.'],
    lastSuccessfulStep: 'approval.granted',
    pendingStep: 'runner.started',
    summary: 'Approval was granted and execution may proceed.',
  });
  const approvalCheckpointArtifact = await persistRunCheckpoint(
    context.artifactStore,
    approvalCheckpoint,
  );
  const approvalProgress = createRunProgressSnapshotRecord({
    runId: context.run.id,
    sessionId: context.session.id,
    stage: 'approval_resolved',
    status: 'in_progress',
    justCompleted: 'Resolved the required approval as approved.',
    remaining: [
      'Run the write-capable runner.',
      'Capture execution artifacts and verification evidence.',
    ],
    currentRisks: [],
    approvedScope: context.policyDecision?.affectedPaths ?? [],
    verificationState: 'not_run',
    artifactPaths: [approvalResolutionArtifact, approvalCheckpointArtifact.path],
    nextRecommendedStep: 'Start the write-capable runner.',
    summary: 'Approval granted; execution may proceed.',
  });
  const approvalProgressArtifacts = await persistProgressSnapshot(
    context.artifactStore,
    approvalProgress,
  );

  if (context.mode === 'fresh') {
    context.session = updateRunSessionRecord(context.session, {
      currentStage: 'approval_resolved',
      lastProgressSnapshotId: approvalProgress.id,
      outputArtifactPaths: uniqueStrings([
        ...context.session.outputArtifactPaths,
        approvalResolutionArtifact,
        approvalCheckpointArtifact.path,
        approvalProgressArtifacts.history.path,
        approvalProgressArtifacts.latest.path,
      ]),
      summary: 'Approval granted; execution may proceed.',
    });
    await persistRunSession(context.artifactStore, context.session);
  } else {
    context.session = updateRunSessionRecord(context.session, {
      currentStage: 'approval_resolved',
      lastProgressSnapshotId: approvalProgress.id,
      outputArtifactPaths: uniqueStrings([
        ...context.session.outputArtifactPaths,
        approvalResolutionArtifact,
        approvalCheckpointArtifact.path,
        approvalProgressArtifacts.history.path,
        approvalProgressArtifacts.latest.path,
      ]),
      summary: 'Approval granted; execution may proceed.',
    });
    await persistRunSession(context.artifactStore, context.session);
  }

  context.manifest = updateSessionManifestRecord(context.manifest, {
    status: 'in_progress',
    currentStage: 'approval_resolved',
    lastSuccessfulStage: 'approval_resolved',
    lastSuccessfulStep: 'approval.granted',
    pendingStage: 'runner_started',
    pendingStep: 'runner.started',
    approvalState: {
      required: true,
      status: 'approved',
      approvalPacketId: context.approvalPacket.id,
      artifactPaths: [
        resolve(context.run.runDirectory, 'approval-packet.json'),
        resolve(context.run.runDirectory, 'approval-packet.md'),
        approvalResolutionArtifact,
      ],
    },
    pendingActions: [],
    lastCheckpointId: approvalCheckpoint.id,
    lastProgressSnapshotId: approvalProgress.id,
    artifactPaths: {
      ...context.manifest.artifactPaths,
      approvalResolution: approvalResolutionArtifact,
      lastCheckpoint: approvalCheckpointArtifact.path,
      progressLatest: approvalProgressArtifacts.latest.path,
    },
    summary: 'Approval granted; execution may proceed.',
  });
  await persistSessionManifest(context.artifactStore, context.manifest);

  return 'runner_started';
}

async function handleRunnerStarted(
  context: RunLifecycleExecutionContext,
): Promise<import('@gdh/domain').RunStage | undefined> {
  if (!context.spec || !context.plan || !context.policyDecision || !context.impactPreview) {
    throw new Error(
      'Cannot execute the runner stage because required planning artifacts are missing.',
    );
  }

  const spec = context.spec;
  const plan = context.plan;
  const policyDecision = context.policyDecision;
  const impactPreview = context.impactPreview;
  const excludedRunPrefix =
    context.excludedRunPrefix ??
    createRunRelativeDirectory(context.repoRoot, context.artifactStore.runDirectory);
  const beforeSnapshot = await captureWorkspaceSnapshot(context.repoRoot, {
    excludePrefixes: [excludedRunPrefix],
  });
  const runnerEntrySnapshotArtifact = await context.artifactStore.writeJsonArtifact(
    'runner-entry-snapshot',
    runnerEntrySnapshotRelativePath,
    createWorkspaceContentSnapshotArtifact(beforeSnapshot),
    context.mode === 'resume'
      ? 'Runner-entry workspace snapshot captured before re-entering the runner stage.'
      : 'Runner-entry workspace snapshot captured before launching the write-capable runner.',
  );
  context.beforeSnapshot = beforeSnapshot;
  const runner = createRunner(context.run.runner);
  let stdoutArtifact = await context.artifactStore.writeTextArtifact(
    'runner-stdout',
    'runner.stdout.log',
    '',
    'text',
    context.mode === 'resume' ? 'Live raw runner stdout during resume.' : 'Live raw runner stdout.',
  );
  let stderrArtifact = await context.artifactStore.writeTextArtifact(
    'runner-stderr',
    'runner.stderr.log',
    '',
    'text',
    context.mode === 'resume' ? 'Live raw runner stderr during resume.' : 'Live raw runner stderr.',
  );
  const runnerStartedSummary =
    context.mode === 'resume'
      ? 'Resumed run is executing the runner stage.'
      : 'Write-capable runner is starting.';
  const liveRunnerArtifactPaths = [
    runnerEntrySnapshotArtifact.path,
    stdoutArtifact.path,
    stderrArtifact.path,
  ];
  const liveRunnerState: {
    activeCommand?: string;
    lastReporterMessage?: string;
    todoItems: Array<{ completed: boolean; text: string }>;
  } = {
    todoItems: [],
  };
  const createLiveRemainingSteps = () => {
    const incompleteTodos = liveRunnerState.todoItems
      .filter((item) => !item.completed)
      .map((item) => item.text);

    return incompleteTodos.length > 0
      ? incompleteTodos.slice(0, 3)
      : ['Complete runner execution.', 'Capture diff, policy audit, and verification evidence.'];
  };
  const persistLiveRunnerProgress = async (input: {
    blockers?: string[];
    currentRisks?: string[];
    justCompleted: string;
    reporterMessage?: string;
    summary: string;
  }) => {
    const progressSnapshot = createRunProgressSnapshotRecord({
      runId: context.run.id,
      sessionId: context.session.id,
      stage: 'runner_started',
      status: 'in_progress',
      justCompleted: input.justCompleted,
      remaining: createLiveRemainingSteps(),
      blockers: input.blockers ?? [],
      currentRisks: uniqueStrings([
        ...policyDecision.uncertaintyNotes,
        ...(input.currentRisks ?? []),
      ]),
      approvedScope: policyDecision.affectedPaths,
      verificationState: 'not_run',
      artifactPaths: liveRunnerArtifactPaths,
      nextRecommendedStep: 'Wait for the runner to finish and persist the execution artifacts.',
      summary: input.summary,
    });

    await context.artifactStore.writeJsonArtifact(
      'run-progress-latest',
      progressLatestRelativePath,
      progressSnapshot,
      'Latest live runner progress snapshot during execution.',
    );

    const reporterMessage = input.reporterMessage?.trim();

    if (
      context.progressReporter &&
      reporterMessage &&
      reporterMessage !== liveRunnerState.lastReporterMessage
    ) {
      liveRunnerState.lastReporterMessage = reporterMessage;
      context.progressReporter({
        message: reporterMessage,
        stage: 'runner_started',
      });
    }
  };
  const runnerStartedProgress = createRunProgressSnapshotRecord({
    runId: context.run.id,
    sessionId: context.session.id,
    stage: 'runner_started',
    status: 'in_progress',
    justCompleted:
      'Persisted a runner-entry workspace snapshot and prepared write-capable execution.',
    remaining: [
      'Complete runner execution.',
      'Capture diff, policy audit, and verification evidence.',
    ],
    currentRisks: context.policyDecision.uncertaintyNotes,
    approvedScope: policyDecision.affectedPaths,
    verificationState: 'not_run',
    artifactPaths: liveRunnerArtifactPaths,
    nextRecommendedStep: 'Wait for the runner to finish and persist the execution artifacts.',
    summary: runnerStartedSummary,
  });

  context.executedRunner = true;
  context.run = updateRunStatus(context.run, 'in_progress', runnerStartedSummary);
  context.run = updateRunStage(context.run, {
    currentStage: 'runner_started',
    pendingStage: 'runner_completed',
    summary: runnerStartedSummary,
    sessionId: context.session.id,
  });
  await persistRunStatus(context.artifactStore, context.run);
  const runnerStartedProgressArtifacts = await persistProgressSnapshot(
    context.artifactStore,
    runnerStartedProgress,
  );
  context.session = updateRunSessionRecord(context.session, {
    currentStage: 'runner_started',
    lastProgressSnapshotId: runnerStartedProgress.id,
    outputArtifactPaths: uniqueStrings([
      ...context.session.outputArtifactPaths,
      runnerEntrySnapshotArtifact.path,
      runnerStartedProgressArtifacts.history.path,
      runnerStartedProgressArtifacts.latest.path,
    ]),
    summary: runnerStartedSummary,
  });
  await persistRunSession(context.artifactStore, context.session);
  context.manifest = updateSessionManifestRecord(context.manifest, {
    status: 'in_progress',
    currentStage: 'runner_started',
    pendingStage: 'runner_completed',
    pendingStep: 'runner.completed',
    lastProgressSnapshotId: runnerStartedProgress.id,
    artifactPaths: {
      ...context.manifest.artifactPaths,
      progressLatest: runnerStartedProgressArtifacts.latest.path,
      runnerEntrySnapshot: runnerEntrySnapshotArtifact.path,
    },
    summary: runnerStartedSummary,
  });
  await persistSessionManifest(context.artifactStore, context.manifest);
  await context.emitEvent('runner.started', {
    approvalPolicy: context.run.approvalPolicy,
    model: context.run.model,
    networkAccess: context.run.networkAccess,
    resumed: context.mode === 'resume',
    runner: runner.kind,
    runnerEntrySnapshotPath: runnerEntrySnapshotArtifact.path,
    sandboxMode: context.run.sandboxMode,
  });
  await persistLiveRunnerProgress({
    justCompleted: 'Persisted a runner-entry workspace snapshot and initialized live runner logs.',
    reporterMessage: 'runner started; waiting for live events',
    summary: runnerStartedSummary,
  });

  context.runnerResult = await (async () => {
    try {
      return await runner.execute(
        {
          approvalPacket: context.approvalPacket,
          impactPreview,
          plan,
          policyDecision,
          priorArtifacts: context.artifactStore.listArtifacts(),
          repoRoot: context.repoRoot,
          run: context.run,
          runDirectory: context.artifactStore.runDirectory,
          spec,
          verificationRequirements: describeVerificationScope(context.verificationConfig.commands),
        },
        {
          onProgress: async (event: RunnerProgressEvent) => {
            if (event.kind === 'stdout_chunk') {
              await context.artifactStore.appendTextArtifact(
                'runner-stdout',
                'runner.stdout.log',
                event.chunk,
                'text',
                context.mode === 'resume'
                  ? 'Live raw runner stdout during resume.'
                  : 'Live raw runner stdout.',
              );
              return;
            }

            if (event.kind === 'stderr_chunk') {
              await context.artifactStore.appendTextArtifact(
                'runner-stderr',
                'runner.stderr.log',
                event.chunk,
                'text',
                context.mode === 'resume'
                  ? 'Live raw runner stderr during resume.'
                  : 'Live raw runner stderr.',
              );
              return;
            }

            if (event.kind === 'stdout_line') {
              const line = truncateRunnerProgressText(event.line);

              if (!line) {
                return;
              }

              await persistLiveRunnerProgress({
                justCompleted: 'Observed non-JSON runner stdout.',
                reporterMessage: `output: ${line}`,
                summary: `Runner output: ${line}`,
              });
              return;
            }

            if (event.kind === 'stderr_line') {
              const line = truncateRunnerProgressText(event.line);

              if (!line) {
                return;
              }

              await persistLiveRunnerProgress({
                currentRisks: [line],
                justCompleted: 'Observed runner stderr output.',
                reporterMessage: `stderr: ${line}`,
                summary: `Runner stderr: ${line}`,
              });
              return;
            }

            const eventType = event.event.type;
            const item = event.event.item;

            if (eventType === 'thread.started') {
              await persistLiveRunnerProgress({
                justCompleted: 'Established a live Codex runner thread.',
                reporterMessage: 'thread started',
                summary: 'Runner thread started.',
              });
              return;
            }

            if (eventType === 'turn.started') {
              await persistLiveRunnerProgress({
                justCompleted: 'Codex began processing the governed runner turn.',
                reporterMessage: 'turn started',
                summary: 'Runner turn started.',
              });
              return;
            }

            if (eventType === 'error' || eventType === 'turn.failed') {
              const errorMessage =
                truncateRunnerProgressText(
                  typeof event.event.error === 'string'
                    ? event.event.error
                    : typeof event.event.error?.message === 'string'
                      ? event.event.error.message
                      : typeof event.event.message === 'string'
                        ? event.event.message
                        : undefined,
                ) ?? 'Runner reported an error.';

              await persistLiveRunnerProgress({
                currentRisks: [errorMessage],
                justCompleted: 'The live runner reported an error event.',
                reporterMessage: `error: ${errorMessage}`,
                summary: `Runner reported an error: ${errorMessage}`,
              });
              return;
            }

            if (
              (eventType === 'item.started' ||
                eventType === 'item.updated' ||
                eventType === 'item.completed') &&
              item?.type === 'todo_list'
            ) {
              const todoItems = (item.items ?? [])
                .filter(
                  (todo): todo is { completed: boolean; text: string } =>
                    typeof todo?.text === 'string' && typeof todo?.completed === 'boolean',
                )
                .map((todo) => ({
                  completed: todo.completed,
                  text: todo.text,
                }));

              liveRunnerState.todoItems = todoItems;
              const completedCount = todoItems.filter((todo) => todo.completed).length;
              const totalCount = todoItems.length;

              await persistLiveRunnerProgress({
                justCompleted: 'Updated the live runner todo list.',
                reporterMessage:
                  totalCount > 0
                    ? `todo ${completedCount}/${totalCount} complete`
                    : 'todo list updated',
                summary:
                  totalCount > 0
                    ? `Runner todo progress: ${completedCount}/${totalCount} item(s) complete.`
                    : 'Runner updated the todo list.',
              });
              return;
            }

            if (item?.type === 'command_execution' && typeof item.command === 'string') {
              const commandSummary =
                truncateRunnerProgressText(item.command, 110) ?? 'runner command';

              if (eventType === 'item.started') {
                liveRunnerState.activeCommand = item.command;
                await persistLiveRunnerProgress({
                  justCompleted: 'Started a command inside the live runner.',
                  reporterMessage: `running command: ${commandSummary}`,
                  summary: `Runner command started: ${commandSummary}`,
                });
                return;
              }

              if (eventType === 'item.completed') {
                liveRunnerState.activeCommand = undefined;
                const exitCode =
                  typeof item.exit_code === 'number' ? ` (exit ${item.exit_code})` : '';

                await persistLiveRunnerProgress({
                  currentRisks:
                    typeof item.exit_code === 'number' && item.exit_code !== 0
                      ? [`Runner command exited with code ${item.exit_code}.`]
                      : [],
                  justCompleted: 'Completed a command inside the live runner.',
                  reporterMessage: `completed command: ${commandSummary}${exitCode}`,
                  summary: `Runner command completed: ${commandSummary}${exitCode}`,
                });
                return;
              }
            }

            if (eventType === 'item.completed' && item?.type === 'agent_message') {
              const messageText = extractRunnerMessageText(
                typeof item.text === 'string' ? item.text : undefined,
              );

              if (!messageText) {
                return;
              }

              await persistLiveRunnerProgress({
                justCompleted: 'Received an agent message from the live runner.',
                reporterMessage: `agent: ${messageText}`,
                summary: `Runner update: ${messageText}`,
              });
            }
          },
        },
      );
    } catch (error) {
      return createStructuredRunnerFailureResult(error);
    }
  })();

  const runnerResult = context.runnerResult;

  if (!runnerResult) {
    throw new Error('Runner execution did not produce a structured result.');
  }

  const runnerPromptArtifact = await context.artifactStore.writeTextArtifact(
    'runner-prompt',
    'runner.prompt.md',
    runnerResult.prompt,
    'markdown',
    context.mode === 'resume'
      ? 'Prompt prepared for the write-capable runner during resume.'
      : 'Prompt prepared for the write-capable runner.',
  );
  stdoutArtifact = await context.artifactStore.writeTextArtifact(
    'runner-stdout',
    'runner.stdout.log',
    runnerResult.stdout,
    'text',
    context.mode === 'resume' ? 'Raw runner stdout from resume.' : 'Raw runner stdout.',
  );
  stderrArtifact = await context.artifactStore.writeTextArtifact(
    'runner-stderr',
    'runner.stderr.log',
    runnerResult.stderr,
    'text',
    context.mode === 'resume' ? 'Raw runner stderr from resume.' : 'Raw runner stderr.',
  );
  const commandCaptureArtifact = await context.artifactStore.writeJsonArtifact(
    'commands-executed',
    'commands-executed.json',
    runnerResult.commandCapture,
    context.mode === 'resume'
      ? 'Captured executed commands from the resumed runner stage.'
      : 'Captured executed commands with provenance and completeness.',
  );
  const runnerResultArtifact = await context.artifactStore.writeJsonArtifact(
    'runner-result',
    'runner.result.json',
    runnerResult,
    context.mode === 'resume'
      ? 'Structured runner result from the resumed runner stage.'
      : 'Structured runner result with logs and metadata.',
  );
  context.commandCapture = runnerResult.commandCapture;

  await context.emitEvent(eventTypeForRunnerStatus(runnerResult.status), {
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

  const afterSnapshot = await captureWorkspaceSnapshot(context.repoRoot, {
    excludePrefixes: [excludedRunPrefix],
  });
  context.changedFiles = await import('@gdh/artifact-store').then(({ diffWorkspaceSnapshots }) =>
    diffWorkspaceSnapshots(beforeSnapshot, afterSnapshot),
  );
  const changedFiles = context.changedFiles;

  if (!changedFiles) {
    throw new Error('Could not derive changed files after runner execution.');
  }

  context.diffPatch = await createDiffPatch(beforeSnapshot, afterSnapshot, changedFiles);
  const changedFilesArtifact = await context.artifactStore.writeJsonArtifact(
    'changed-files',
    'changed-files.json',
    changedFiles,
    context.mode === 'resume'
      ? 'Changed files captured during resume.'
      : 'Changed files derived from before/after workspace snapshots.',
  );
  const diffArtifact = await context.artifactStore.writeTextArtifact(
    'diff',
    'diff.patch',
    context.diffPatch,
    'patch',
    context.mode === 'resume'
      ? 'Patch captured during resume.'
      : 'Patch derived from workspace snapshot differences.',
  );
  await context.emitEvent('diff.captured', {
    artifactPath: changedFilesArtifact.path,
    changedFiles: changedFiles.files.map((file) => ({
      path: file.path,
      status: file.status,
    })),
    diffPath: diffArtifact.path,
  });

  context.policyAudit = createPolicyAudit({
    approvalResolution: context.approvalResolution,
    changedFiles,
    commandCapture: runnerResult.commandCapture,
    impactPreview,
    policyDecision,
    policyPack: context.loadedPolicyPack.pack,
    spec,
  });
  const policyAuditArtifact = await context.artifactStore.writeJsonArtifact(
    'policy-audit',
    'policy-audit.json',
    context.policyAudit,
    context.mode === 'resume'
      ? 'Policy audit captured during resume.'
      : 'Post-run policy audit based on actual changed files and captured commands.',
  );

  if (context.mode === 'resume') {
    if (runnerResult.status !== 'completed') {
      context.run = updateRunStatus(context.run, 'interrupted', runnerResult.summary);
      context.run = updateRunStage(context.run, {
        currentStage: 'runner_started',
        pendingStage: 'runner_started',
        summary: runnerResult.summary,
        sessionId: context.session.id,
      });
      await persistRunStatus(context.artifactStore, context.run);
      context.manifest = updateSessionManifestRecord(context.manifest, {
        status: 'interrupted',
        currentStage: 'runner_started',
        pendingStage: 'runner_started',
        pendingStep: 'runner.started',
        summary: runnerResult.summary,
      });
      await persistSessionManifest(context.artifactStore, context.manifest);
      await context.emitEvent('resume.failed', {
        reason: runnerResult.summary,
      });
      return undefined;
    }

    return 'verification_started';
  }

  const runnerCheckpoint = createRunCheckpointRecord({
    runId: context.run.id,
    sessionId: context.session.id,
    stage: 'runner_completed',
    status: runnerResult.status === 'completed' ? 'verifying' : 'interrupted',
    requiredArtifactPaths: [
      resolve(context.run.runDirectory, 'policy.decision.json'),
      ...(context.approvalPacketArtifact ? [context.approvalPacketArtifact.path] : []),
    ],
    outputArtifactPaths: [
      runnerEntrySnapshotArtifact.path,
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
  const runnerCheckpointArtifact = await persistRunCheckpoint(
    context.artifactStore,
    runnerCheckpoint,
  );
  const runnerProgress = createRunProgressSnapshotRecord({
    runId: context.run.id,
    sessionId: context.session.id,
    stage: 'runner_completed',
    status: runnerResult.status === 'completed' ? 'verifying' : 'interrupted',
    justCompleted:
      runnerResult.status === 'completed'
        ? 'Finished write-capable execution and captured the runner artifacts.'
        : 'Captured the failed runner result and logs.',
    remaining:
      runnerResult.status === 'completed'
        ? ['Capture changed files and diff.', 'Run deterministic verification.']
        : ['Inspect the runner failure and decide whether the runner stage can be retried safely.'],
    blockers:
      runnerResult.status === 'completed'
        ? []
        : ['Runner execution did not complete successfully.'],
    currentRisks: runnerResult.limitations,
    approvedScope: policyDecision.affectedPaths,
    verificationState: 'not_run',
    artifactPaths: [
      runnerEntrySnapshotArtifact.path,
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
  const runnerProgressArtifacts = await persistProgressSnapshot(
    context.artifactStore,
    runnerProgress,
  );
  context.session = updateRunSessionRecord(context.session, {
    currentStage: 'runner_completed',
    lastProgressSnapshotId: runnerProgress.id,
    outputArtifactPaths: uniqueStrings([
      ...context.session.outputArtifactPaths,
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
  await persistRunSession(context.artifactStore, context.session);
  context.manifest = updateSessionManifestRecord(context.manifest, {
    status: runnerResult.status === 'completed' ? 'verifying' : 'interrupted',
    currentStage: 'runner_completed',
    lastSuccessfulStage:
      runnerResult.status === 'completed'
        ? 'runner_completed'
        : context.manifest.lastSuccessfulStage,
    lastSuccessfulStep:
      runnerResult.status === 'completed'
        ? 'runner.completed'
        : context.manifest.lastSuccessfulStep,
    pendingStage: runnerResult.status === 'completed' ? 'verification_started' : 'runner_started',
    pendingStep: runnerResult.status === 'completed' ? 'verification.started' : 'runner.started',
    lastCheckpointId: runnerCheckpoint.id,
    lastProgressSnapshotId: runnerProgress.id,
    pendingActions:
      runnerResult.status === 'completed'
        ? []
        : [
            createPendingActionRecord({
              runId: context.run.id,
              kind: 'rerun_stage',
              title: 'Review runner failure',
              summary: runnerResult.summary,
              artifactPaths: [stderrArtifact.path, runnerResultArtifact.path],
            }),
          ],
    artifactPaths: {
      ...context.manifest.artifactPaths,
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
  await persistSessionManifest(context.artifactStore, context.manifest);

  context.run = updateRunStatus(
    context.run,
    runnerResult.status === 'completed' ? 'verifying' : 'interrupted',
    runnerResult.summary,
  );
  context.run = updateRunStage(context.run, {
    currentStage: 'runner_completed',
    lastSuccessfulStage:
      runnerResult.status === 'completed' ? 'runner_completed' : context.run.lastSuccessfulStage,
    pendingStage: runnerResult.status === 'completed' ? 'verification_started' : 'runner_started',
    lastCheckpointId: runnerCheckpoint.id,
    lastProgressSnapshotId: runnerProgress.id,
    summary: runnerResult.summary,
    sessionId: context.session.id,
  });
  await persistRunStatus(context.artifactStore, context.run);

  const postExecutionWorkspaceSnapshot = await captureWorkspaceState(context.repoRoot, {
    expectedArtifactPaths: uniqueStrings([
      context.artifactStore.resolveArtifactPath('run.json'),
      context.artifactStore.resolveArtifactPath(sessionManifestRelativePath),
      resolve(context.artifactStore.runDirectory, 'runner.result.json'),
      resolve(context.artifactStore.runDirectory, 'commands-executed.json'),
      changedFilesArtifact.path,
      diffArtifact.path,
      policyAuditArtifact.path,
    ]),
    knownRunChangedFiles: changedFiles.files.map((file) => file.path),
    workingDirectory: context.cwd,
  });
  const postExecutionWorkspaceArtifact = await persistWorkspaceState(
    context.artifactStore,
    postExecutionWorkspaceSnapshot,
  );

  const executionCheckpoint = createRunCheckpointRecord({
    runId: context.run.id,
    sessionId: context.session.id,
    stage: 'runner_completed',
    status: runnerResult.status === 'completed' ? 'verifying' : 'interrupted',
    requiredArtifactPaths: [
      resolve(context.run.runDirectory, 'policy.decision.json'),
      ...(context.approvalPacketArtifact ? [context.approvalPacketArtifact.path] : []),
    ],
    outputArtifactPaths: uniqueStrings([
      resolve(context.artifactStore.runDirectory, 'runner.result.json'),
      resolve(context.artifactStore.runDirectory, 'commands-executed.json'),
      runnerEntrySnapshotArtifact.path,
      changedFilesArtifact.path,
      diffArtifact.path,
      policyAuditArtifact.path,
      postExecutionWorkspaceArtifact.path,
    ]),
    restartable: runnerResult.status === 'completed',
    rerunStageOnResume: runnerResult.status !== 'completed',
    resumeInstructions:
      runnerResult.status === 'completed'
        ? ['Reuse the persisted execution evidence and continue with verification.']
        : ['Investigate the partial execution workspace state before rerunning the runner stage.'],
    lastSuccessfulStep: runnerResult.status === 'completed' ? 'runner.completed' : 'runner.failed',
    pendingStep: runnerResult.status === 'completed' ? 'verification.started' : 'runner.started',
    summary:
      runnerResult.status === 'completed'
        ? 'Execution artifacts are durable and verification can resume safely.'
        : 'Execution stopped before a restart-safe verification boundary was reached.',
  });
  const executionCheckpointArtifact = await persistRunCheckpoint(
    context.artifactStore,
    executionCheckpoint,
  );
  context.run = updateRunStage(context.run, {
    currentStage: 'runner_completed',
    lastSuccessfulStage:
      runnerResult.status === 'completed' ? 'runner_completed' : context.run.lastSuccessfulStage,
    pendingStage: runnerResult.status === 'completed' ? 'verification_started' : 'runner_started',
    lastCheckpointId: executionCheckpoint.id,
    summary: executionCheckpoint.summary,
    sessionId: context.session.id,
  });
  await persistRunStatus(context.artifactStore, context.run);
  context.manifest = updateSessionManifestRecord(context.manifest, {
    currentStage: 'runner_completed',
    lastSuccessfulStage:
      runnerResult.status === 'completed'
        ? 'runner_completed'
        : context.manifest.lastSuccessfulStage,
    lastSuccessfulStep:
      runnerResult.status === 'completed'
        ? 'runner.completed'
        : context.manifest.lastSuccessfulStep,
    pendingStage: runnerResult.status === 'completed' ? 'verification_started' : 'runner_started',
    pendingStep: runnerResult.status === 'completed' ? 'verification.started' : 'runner.started',
    lastCheckpointId: executionCheckpoint.id,
    workspace: {
      ...context.manifest.workspace,
      lastSnapshot: postExecutionWorkspaceSnapshot,
    },
    artifactPaths: {
      ...context.manifest.artifactPaths,
      changedFiles: changedFilesArtifact.path,
      diff: diffArtifact.path,
      policyAudit: policyAuditArtifact.path,
      workspaceLatest: postExecutionWorkspaceArtifact.path,
      lastCheckpoint: executionCheckpointArtifact.path,
    },
    summary: executionCheckpoint.summary,
  });
  await persistSessionManifest(context.artifactStore, context.manifest);

  return runnerResult.status === 'completed' ? 'verification_started' : undefined;
}

async function completeVerificationTransition(
  context: RunLifecycleExecutionContext,
  mode: 'fresh' | 'resume',
): Promise<void> {
  if (
    !context.spec ||
    !context.plan ||
    !context.policyDecision ||
    !context.runnerResult ||
    !context.changedFiles ||
    !context.commandCapture ||
    context.diffPatch === undefined
  ) {
    throw new Error('Cannot run verification because execution artifacts are missing.');
  }

  if (mode === 'fresh') {
    const verificationStartedProgress = createRunProgressSnapshotRecord({
      runId: context.run.id,
      sessionId: context.session.id,
      stage: 'verification_started',
      status: 'verifying',
      justCompleted: 'Captured execution artifacts and prepared deterministic verification.',
      remaining: [
        'Run configured verification commands.',
        'Aggregate verification result and final review packet.',
      ],
      currentRisks: context.policyAudit?.notes ?? [],
      approvedScope: context.policyDecision.affectedPaths,
      verificationState: 'not_run',
      artifactPaths: [
        resolve(context.artifactStore.runDirectory, 'changed-files.json'),
        resolve(context.artifactStore.runDirectory, 'diff.patch'),
        resolve(context.artifactStore.runDirectory, 'policy-audit.json'),
      ],
      nextRecommendedStep:
        'Run deterministic verification from the persisted post-execution boundary.',
      summary: 'Deterministic verification is starting.',
    });
    const verificationStartedProgressArtifacts = await persistProgressSnapshot(
      context.artifactStore,
      verificationStartedProgress,
    );
    context.run = updateRunStatus(
      context.run,
      'verifying',
      'Deterministic verification is starting.',
    );
    context.run = updateRunStage(context.run, {
      currentStage: 'verification_started',
      pendingStage: 'verification_completed',
      lastProgressSnapshotId: verificationStartedProgress.id,
      summary: 'Deterministic verification is starting.',
      sessionId: context.session.id,
    });
    await persistRunStatus(context.artifactStore, context.run);
    context.session = updateRunSessionRecord(context.session, {
      currentStage: 'verification_started',
      lastProgressSnapshotId: verificationStartedProgress.id,
      outputArtifactPaths: uniqueStrings([
        ...context.session.outputArtifactPaths,
        verificationStartedProgressArtifacts.history.path,
        verificationStartedProgressArtifacts.latest.path,
      ]),
      summary: 'Deterministic verification is starting.',
    });
    await persistRunSession(context.artifactStore, context.session);
    context.manifest = updateSessionManifestRecord(context.manifest, {
      status: 'verifying',
      currentStage: 'verification_started',
      pendingStage: 'verification_completed',
      pendingStep: 'verification.completed',
      lastProgressSnapshotId: verificationStartedProgress.id,
      artifactPaths: {
        ...context.manifest.artifactPaths,
        progressLatest: verificationStartedProgressArtifacts.latest.path,
      },
      summary: 'Deterministic verification is starting.',
    });
    await persistSessionManifest(context.artifactStore, context.manifest);
  } else {
    context.run = updateRunStatus(
      context.run,
      'verifying',
      'Running deterministic verification during resume.',
    );
    context.run = updateRunStage(context.run, {
      currentStage: 'verification_started',
      pendingStage: 'verification_completed',
      sessionId: context.session.id,
      summary: 'Running deterministic verification during resume.',
    });
    await persistRunStatus(context.artifactStore, context.run);
  }

  const verificationOutput = await runVerification({
    approvalPacket: context.approvalPacket,
    approvalResolution: context.approvalResolution,
    artifactStore: context.artifactStore,
    changedFiles: context.changedFiles,
    commandCapture: context.commandCapture,
    diffPatch: context.diffPatch,
    emitEvent: context.emitEvent,
    plan: context.plan,
    policyAudit: context.policyAudit,
    policyDecision: context.policyDecision,
    repoRoot: context.repoRoot,
    run: context.run,
    runnerResult: context.runnerResult,
    spec: context.spec,
  });
  const verificationResultPath = resolve(
    context.artifactStore.runDirectory,
    'verification.result.json',
  );
  context.run = updateRunStatus(
    context.run,
    verificationOutput.verificationResult.completionDecision.finalStatus,
    verificationOutput.verificationResult.summary,
  );
  context.run = updateRunVerification(context.run, {
    status: verificationOutput.verificationResult.status,
    resultPath: verificationResultPath,
    verifiedAt: verificationOutput.verificationResult.createdAt,
    summary: verificationOutput.verificationResult.summary,
  });
  context.run = updateRunStage(context.run, {
    currentStage: 'verification_completed',
    lastSuccessfulStage: 'verification_completed',
    pendingStage: undefined,
    summary: verificationOutput.verificationResult.summary,
    sessionId: mode === 'fresh' ? context.session.id : undefined,
  });
  await persistRunStatus(context.artifactStore, context.run);

  if (mode === 'fresh') {
    const verificationCheckpoint = createRunCheckpointRecord({
      runId: context.run.id,
      sessionId: context.session.id,
      stage: 'verification_completed',
      status: context.run.status,
      requiredArtifactPaths: [
        resolve(context.artifactStore.runDirectory, 'changed-files.json'),
        resolve(context.artifactStore.runDirectory, 'diff.patch'),
        resolve(context.artifactStore.runDirectory, 'policy-audit.json'),
      ],
      outputArtifactPaths: uniqueStrings([
        verificationResultPath,
        resolve(context.artifactStore.runDirectory, 'review-packet.json'),
        resolve(context.artifactStore.runDirectory, 'review-packet.md'),
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
      context.artifactStore,
      verificationCheckpoint,
    );
    const verificationProgress = createRunProgressSnapshotRecord({
      runId: context.run.id,
      sessionId: context.session.id,
      stage: 'verification_completed',
      status: context.run.status,
      justCompleted: 'Finished deterministic verification and wrote the final review packet.',
      remaining:
        context.run.status === 'completed' ? [] : ['Inspect the failed verification evidence.'],
      blockers:
        context.run.status === 'completed'
          ? []
          : verificationOutput.verificationResult.completionDecision.blockingReasons,
      currentRisks: verificationOutput.reviewPacket.limitations,
      approvedScope: context.policyDecision.affectedPaths,
      verificationState: verificationOutput.verificationResult.status,
      artifactPaths: uniqueStrings([
        verificationResultPath,
        resolve(context.artifactStore.runDirectory, 'review-packet.json'),
        resolve(context.artifactStore.runDirectory, 'review-packet.md'),
        verificationCheckpointArtifact.path,
      ]),
      nextRecommendedStep:
        context.run.status === 'completed'
          ? 'Inspect the completed run with "gdh status <run-id>" if needed.'
          : 'Inspect the verification result and decide whether manual fixes are needed.',
      summary: verificationOutput.verificationResult.summary,
    });
    const verificationProgressArtifacts = await persistProgressSnapshot(
      context.artifactStore,
      verificationProgress,
    );
    context.session = updateRunSessionRecord(context.session, {
      status: context.run.status === 'completed' ? 'completed' : 'failed',
      currentStage: 'verification_completed',
      lastProgressSnapshotId: verificationProgress.id,
      outputArtifactPaths: uniqueStrings([
        ...context.session.outputArtifactPaths,
        verificationCheckpointArtifact.path,
        verificationProgressArtifacts.history.path,
        verificationProgressArtifacts.latest.path,
        verificationResultPath,
        resolve(context.artifactStore.runDirectory, 'review-packet.json'),
        resolve(context.artifactStore.runDirectory, 'review-packet.md'),
      ]),
      summary: verificationOutput.verificationResult.summary,
      endedAt: createIsoTimestamp(),
    });
    await persistRunSession(context.artifactStore, context.session);
    context.manifest = updateSessionManifestRecord(context.manifest, {
      status: context.run.status,
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
        context.run.status === 'completed'
          ? []
          : [
              createPendingActionRecord({
                runId: context.run.id,
                kind: 'verification',
                title: 'Inspect failed verification result',
                summary: verificationOutput.verificationResult.summary,
                artifactPaths: [verificationResultPath],
              }),
            ],
      lastCheckpointId: verificationCheckpoint.id,
      lastProgressSnapshotId: verificationProgress.id,
      artifactPaths: {
        ...context.manifest.artifactPaths,
        verificationResult: verificationResultPath,
        reviewPacketJson: resolve(context.artifactStore.runDirectory, 'review-packet.json'),
        reviewPacketMarkdown: resolve(context.artifactStore.runDirectory, 'review-packet.md'),
        progressLatest: verificationProgressArtifacts.latest.path,
        lastCheckpoint: verificationCheckpointArtifact.path,
      },
      summary: verificationOutput.verificationResult.summary,
    });
    await persistSessionManifest(context.artifactStore, context.manifest);
  } else {
    context.manifest = updateSessionManifestRecord(context.manifest, {
      status: context.run.status,
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
    await persistSessionManifest(context.artifactStore, context.manifest);
  }
}

export async function advanceLifecycle(
  context: RunLifecycleExecutionContext,
  nextStage: import('@gdh/domain').RunStage | undefined,
): Promise<void> {
  while (nextStage) {
    switch (nextStage) {
      case 'spec_normalized':
        nextStage = await handleSpecNormalized(context);
        break;
      case 'plan_created':
        nextStage = await handlePlanCreated(context);
        break;
      case 'policy_evaluated':
        nextStage = await handlePolicyEvaluated(context);
        break;
      case 'awaiting_approval':
        nextStage = await handleAwaitingApproval(context);
        break;
      case 'runner_started':
        nextStage = await handleRunnerStarted(context);
        break;
      case 'verification_started':
        await completeVerificationTransition(context, context.mode);
        nextStage = undefined;
        break;
      default:
        throw new Error(`Lifecycle stage "${nextStage}" is not implemented safely yet.`);
    }
  }
}

export async function finalizeFreshRun(
  context: RunLifecycleExecutionContext,
): Promise<RunCommandSummary> {
  if (!context.runnerResult) {
    context.runnerResult = createSkippedRunnerResult(
      'The governed run stopped before write-capable execution.',
    );
  }
  context.commandCapture = context.runnerResult.commandCapture;

  if (!context.executedRunner) {
    await context.artifactStore.writeJsonArtifact(
      'commands-executed',
      'commands-executed.json',
      context.runnerResult.commandCapture,
      'Captured executed commands with provenance and completeness.',
    );
    await context.artifactStore.writeJsonArtifact(
      'runner-result',
      'runner.result.json',
      context.runnerResult,
      'Structured synthetic runner result for a blocked or pending run.',
    );

    const beforeSnapshot = context.beforeSnapshot;

    if (
      !beforeSnapshot ||
      !context.spec ||
      !context.plan ||
      !context.policyDecision ||
      !context.impactPreview
    ) {
      throw new Error('Cannot finalize a blocked run because pre-execution artifacts are missing.');
    }

    const afterSnapshot = await captureWorkspaceSnapshot(context.repoRoot, {
      excludePrefixes: [
        context.excludedRunPrefix ??
          createRunRelativeDirectory(context.repoRoot, context.artifactStore.runDirectory),
      ],
    });
    const { diffWorkspaceSnapshots } = await import('@gdh/artifact-store');
    context.changedFiles = diffWorkspaceSnapshots(beforeSnapshot, afterSnapshot);
    context.diffPatch = await createDiffPatch(beforeSnapshot, afterSnapshot, context.changedFiles);
    const changedFilesArtifact = await context.artifactStore.writeJsonArtifact(
      'changed-files',
      'changed-files.json',
      context.changedFiles,
      'Changed files derived from before/after workspace snapshots.',
    );
    const diffArtifact = await context.artifactStore.writeTextArtifact(
      'diff',
      'diff.patch',
      context.diffPatch,
      'patch',
      'Patch derived from workspace snapshot differences.',
    );
    await context.emitEvent('diff.captured', {
      artifactPath: changedFilesArtifact.path,
      changedFiles: context.changedFiles.files.map((file) => ({
        path: file.path,
        status: file.status,
      })),
      diffPath: diffArtifact.path,
    });
    context.policyAudit = createPolicyAudit({
      approvalResolution: context.approvalResolution,
      changedFiles: context.changedFiles,
      commandCapture: context.runnerResult.commandCapture,
      impactPreview: context.impactPreview,
      policyDecision: context.policyDecision,
      policyPack: context.loadedPolicyPack.pack,
      spec: context.spec,
    });
    const policyAuditArtifact = await context.artifactStore.writeJsonArtifact(
      'policy-audit',
      'policy-audit.json',
      context.policyAudit,
      'Post-run policy audit based on actual changed files and captured commands.',
    );
    const postExecutionWorkspaceSnapshot = await captureWorkspaceState(context.repoRoot, {
      expectedArtifactPaths: uniqueStrings([
        context.artifactStore.resolveArtifactPath('run.json'),
        context.artifactStore.resolveArtifactPath(sessionManifestRelativePath),
        changedFilesArtifact.path,
        diffArtifact.path,
        policyAuditArtifact.path,
      ]),
      knownRunChangedFiles: context.changedFiles.files.map((file) => file.path),
      workingDirectory: context.cwd,
    });
    const postExecutionWorkspaceArtifact = await persistWorkspaceState(
      context.artifactStore,
      postExecutionWorkspaceSnapshot,
    );
    context.manifest = updateSessionManifestRecord(context.manifest, {
      workspace: {
        ...context.manifest.workspace,
        lastSnapshot: postExecutionWorkspaceSnapshot,
      },
      artifactPaths: {
        ...context.manifest.artifactPaths,
        changedFiles: changedFilesArtifact.path,
        diff: diffArtifact.path,
        policyAudit: policyAuditArtifact.path,
        workspaceLatest: postExecutionWorkspaceArtifact.path,
      },
    });
    await persistSessionManifest(context.artifactStore, context.manifest);

    const skippedReviewPacket = createReviewPacket({
      approvalPacket: context.approvalPacket,
      approvalResolution: context.approvalResolution,
      artifacts: context.artifactStore.listArtifacts(),
      changedFiles: context.changedFiles,
      claimVerification: createSkippedClaimVerificationSummary(
        'Claim verification did not run because the governed run stopped before write-capable execution.',
      ),
      githubState: context.run.github,
      plan: context.plan,
      policyAudit: context.policyAudit,
      policyDecision: context.policyDecision,
      run: context.run,
      runCompletion: {
        finalStatus: 'failed',
        canComplete: false,
        summary:
          'Verification did not run because the governed run stopped before write-capable execution.',
        blockingCheckIds: ['pre_execution_gate'],
        blockingReasons: [context.run.summary ?? context.runnerResult.summary],
      },
      runStatus: context.run.status,
      runnerResult: context.runnerResult,
      spec: context.spec,
      verificationCommands: [] as VerificationCommandResult[],
      verificationStatus: 'not_run',
      verificationSummary:
        'Verification did not run because the governed run stopped before write-capable execution.',
    });
    const reviewPacketMarkdown = renderReviewPacketMarkdown(skippedReviewPacket);
    await context.artifactStore.writeJsonArtifact(
      'review-packet-json',
      'review-packet.json',
      skippedReviewPacket,
      'Structured review packet.',
    );
    context.approvalPacketMarkdownArtifact ??= context.approvalPacket
      ? {
          id: 'approval-packet-markdown',
          runId: context.run.id,
          kind: 'approval-packet-markdown',
          path: resolve(context.artifactStore.runDirectory, 'approval-packet.md'),
          format: 'markdown',
          createdAt: createIsoTimestamp(),
          summary: 'Human-readable approval packet.',
        }
      : undefined;
    const reviewPacketMarkdownArtifact = await context.artifactStore.writeTextArtifact(
      'review-packet-markdown',
      'review-packet.md',
      reviewPacketMarkdown,
      'markdown',
      'Human-readable review packet.',
    );
    await context.emitEvent('review_packet.generated', {
      artifactPaths: [
        resolve(context.artifactStore.runDirectory, 'review-packet.json'),
        reviewPacketMarkdownArtifact.path,
      ],
      verificationStatus: 'not_run',
    });
    context.session = updateRunSessionRecord(context.session, {
      status:
        context.run.status === 'failed' || context.run.status === 'abandoned'
          ? 'failed'
          : 'completed',
      lastProgressSnapshotId: context.run.lastProgressSnapshotId,
      outputArtifactPaths: uniqueStrings([
        ...context.session.outputArtifactPaths,
        resolve(context.artifactStore.runDirectory, 'review-packet.json'),
        reviewPacketMarkdownArtifact.path,
      ]),
      summary: context.run.summary ?? context.runnerResult.summary,
      endedAt: createIsoTimestamp(),
    });
    await persistRunSession(context.artifactStore, context.session);
    context.manifest = updateSessionManifestRecord(context.manifest, {
      status: context.run.status,
      artifactPaths: {
        ...context.manifest.artifactPaths,
        reviewPacketJson: resolve(context.artifactStore.runDirectory, 'review-packet.json'),
        reviewPacketMarkdown: reviewPacketMarkdownArtifact.path,
      },
      summary: context.run.summary ?? context.runnerResult.summary,
    });
    await persistSessionManifest(context.artifactStore, context.manifest);
  }

  const finalEventType = eventTypeForFinalRunStatus(context.run.status);

  if (finalEventType) {
    await context.emitEvent(finalEventType, {
      reviewPacketPath: resolve(context.artifactStore.runDirectory, 'review-packet.md'),
      status: context.run.status,
      summary: context.run.summary,
    });
  }

  const finalResumeEligibility =
    context.run.status === 'awaiting_approval'
      ? createResumeEligibilityRecord({
          eligible: true,
          nextStage: 'awaiting_approval',
          reasons: [],
          requiredArtifactPaths: [
            resolve(context.artifactStore.runDirectory, 'approval-packet.json'),
            resolve(context.artifactStore.runDirectory, 'policy.decision.json'),
          ],
          summary: `Run can resume from "${context.run.status}" once a human resolves the approval request.`,
        })
      : createResumeEligibilityRecord({
          eligible: false,
          reasons: [
            `Run status "${context.run.status}" is not currently resumable from this invocation.`,
          ],
          summary: `Run status "${context.run.status}" is not currently resumable from this invocation.`,
        });
  context.run = updateRunResumeEligibility(context.run, finalResumeEligibility);
  await persistRunStatus(context.artifactStore, context.run);
  context.manifest = updateSessionManifestRecord(context.manifest, {
    status: context.run.status,
    resumeEligibility: finalResumeEligibility,
  });
  await persistSessionManifest(context.artifactStore, context.manifest);

  const { listArtifactReferencesFromRunDirectory } = await import('@gdh/artifact-store');
  const artifacts = await listArtifactReferencesFromRunDirectory(
    context.run.id,
    context.run.runDirectory,
  );

  return {
    approvalPacketPath: context.approvalPacket
      ? resolve(context.artifactStore.runDirectory, 'approval-packet.md')
      : undefined,
    approvalResolution: context.approvalResolution,
    artifactCount: artifacts.length,
    artifactsDirectory: context.artifactStore.runDirectory,
    changedFiles: context.changedFiles?.files.map((file) => file.path) ?? [],
    commandsExecuted:
      context.runnerResult?.commandCapture.commands.map((command) => ({
        command: command.command,
        isPartial: command.isPartial,
        provenance: command.provenance,
      })) ?? [],
    exitCode: exitCodeForRunStatus(context.run.status),
    currentStage: context.run.currentStage,
    lastCompletedStage: context.run.lastSuccessfulStage,
    latestProgressSummary: context.manifest.summary,
    manifestPath: resolve(context.artifactStore.runDirectory, sessionManifestRelativePath),
    nextStage: context.manifest.pendingStage,
    policyAuditPath: resolve(context.artifactStore.runDirectory, 'policy-audit.json'),
    policyDecision: context.policyDecision?.decision,
    reviewPacketPath: resolve(context.artifactStore.runDirectory, 'review-packet.md'),
    resumeEligible: finalResumeEligibility.eligible,
    resumeSummary: finalResumeEligibility.summary,
    runId: context.run.id,
    specTitle: context.spec?.title ?? context.run.sourceSpecPath,
    status: context.run.status,
    summary:
      context.run.summary ?? context.runnerResult?.summary ?? 'Run finished without a summary.',
    verificationResultPath:
      context.run.verificationResultPath ??
      resolve(context.artifactStore.runDirectory, 'verification.result.json'),
    verificationStatus: context.run.verificationStatus,
  };
}

export async function rerunVerificationForExistingRun(input: {
  artifactStore: RunLifecycleExecutionContext['artifactStore'];
  loaded: import('./types.js').LoadedRunContext;
  repoRoot: string;
}): Promise<RunCommandSummary> {
  let run = updateRunStatus(
    input.loaded.run,
    'verifying',
    'Running deterministic verification for an existing governed run.',
  );
  await persistRunStatus(input.artifactStore, run);

  const appendEvent = async (type: RunEventType, payload: Record<string, unknown>) =>
    input.artifactStore.appendEvent(createRunEvent(run.id, type, payload));
  const verificationOutput = await runVerification({
    approvalPacket: input.loaded.approvalPacket,
    approvalResolution: input.loaded.approvalResolution,
    artifactStore: input.artifactStore,
    changedFiles: input.loaded.changedFiles,
    commandCapture: input.loaded.commandCapture,
    diffPatch: input.loaded.diffPatch,
    emitEvent: appendEvent,
    plan: input.loaded.plan,
    policyAudit: input.loaded.policyAudit,
    policyDecision: input.loaded.policyDecision,
    repoRoot: input.repoRoot,
    run,
    runnerResult: input.loaded.runnerResult,
    spec: input.loaded.spec,
  });
  const previousStatus = input.loaded.run.status;
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
  await persistRunStatus(input.artifactStore, run);

  if (input.loaded.manifest) {
    const manifest = updateSessionManifestRecord(input.loaded.manifest, {
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
    await persistSessionManifest(input.artifactStore, manifest);
  }

  const finalEventType = eventTypeForFinalRunStatus(run.status);

  if (finalEventType && previousStatus !== run.status) {
    await appendEvent(finalEventType, {
      reviewPacketPath: resolve(run.runDirectory, 'review-packet.md'),
      status: run.status,
      summary: run.summary,
    });
  }

  const { listArtifactReferencesFromRunDirectory } = await import('@gdh/artifact-store');
  const artifacts = await listArtifactReferencesFromRunDirectory(run.id, run.runDirectory);

  return {
    approvalPacketPath: input.loaded.approvalPacket
      ? resolve(run.runDirectory, 'approval-packet.md')
      : undefined,
    approvalResolution: input.loaded.approvalResolution,
    artifactCount: artifacts.length,
    artifactsDirectory: run.runDirectory,
    changedFiles: input.loaded.changedFiles.files.map((file) => file.path),
    commandsExecuted: input.loaded.commandCapture.commands.map((command) => ({
      command: command.command,
      isPartial: command.isPartial,
      provenance: command.provenance,
    })),
    exitCode: verificationOutput.verificationResult.completionDecision.canComplete ? 0 : 1,
    policyAuditPath: resolve(run.runDirectory, 'policy-audit.json'),
    policyDecision: input.loaded.policyDecision.decision,
    reviewPacketPath: resolve(run.runDirectory, 'review-packet.md'),
    runId: run.id,
    specTitle: input.loaded.spec.title,
    status: run.status,
    summary: verificationOutput.verificationResult.summary,
    verificationResultPath,
    verificationStatus: verificationOutput.verificationResult.status,
  };
}

export async function createFreshRunContext(input: {
  approvalMode: RunLifecycleExecutionContext['approvalMode'];
  approvalResolver?: RunLifecycleExecutionContext['approvalResolver'];
  artifactStore: RunLifecycleExecutionContext['artifactStore'];
  cwd: string;
  githubIssue?: RunLifecycleExecutionContext['githubIssue'];
  githubState?: RunGithubState;
  issueIngestionResult?: RunLifecycleExecutionContext['issueIngestionResult'];
  loadedPolicyPack: RunLifecycleExecutionContext['loadedPolicyPack'];
  loadedPolicyPath: string;
  plan: NonNullable<RunLifecycleExecutionContext['plan']>;
  progressReporter?: RunLifecycleExecutionContext['progressReporter'];
  repoRoot: string;
  runId: string;
  runnerKind: RunnerKind;
  spec: NonNullable<RunLifecycleExecutionContext['spec']>;
  verificationConfig: RunLifecycleExecutionContext['verificationConfig'];
}): Promise<RunLifecycleExecutionContext> {
  const excludedRunPrefix = createRunRelativeDirectory(
    input.repoRoot,
    input.artifactStore.runDirectory,
  );
  const beforeSnapshot = await captureWorkspaceSnapshot(input.repoRoot, {
    excludePrefixes: [excludedRunPrefix],
  });
  let run = createRunRecord({
    approvalMode: input.approvalMode,
    approvalPolicy: input.loadedPolicyPack.pack.defaults.approvalPolicy,
    createdAt: createIsoTimestamp(),
    model: defaultRunnerDefaults.model,
    networkAccess: input.loadedPolicyPack.pack.defaults.networkAccess,
    plan: input.plan,
    policyPackName: input.loadedPolicyPack.pack.name,
    policyPackPath: input.loadedPolicyPath,
    policyPackVersion: input.loadedPolicyPack.pack.version,
    repoRoot: input.repoRoot,
    runDirectory: input.artifactStore.runDirectory,
    runId: input.runId,
    runner: input.runnerKind,
    sandboxMode: input.loadedPolicyPack.pack.defaults.sandboxMode,
    spec: input.spec,
    github: input.githubState,
  });
  const session = createRunSessionRecord({
    runId: run.id,
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
  const initialWorkspaceSnapshot = await captureWorkspaceState(input.repoRoot, {
    expectedArtifactPaths: [
      input.artifactStore.resolveArtifactPath('run.json'),
      input.artifactStore.resolveArtifactPath(sessionManifestRelativePath),
    ],
    knownRunChangedFiles: [],
    workingDirectory: input.cwd,
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
      run: input.artifactStore.resolveArtifactPath('run.json'),
      sessionManifest: input.artifactStore.resolveArtifactPath(sessionManifestRelativePath),
    },
    github: input.githubState,
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
  const emitEvent = async (type: RunEventType, payload: Record<string, unknown>) =>
    input.artifactStore.appendEvent(createRunEvent(run.id, type, payload));

  await persistRunStatus(input.artifactStore, run);
  await persistRunSession(input.artifactStore, session);
  await persistWorkspaceState(input.artifactStore, initialWorkspaceSnapshot);
  const manifestArtifact = await persistSessionManifest(input.artifactStore, manifest);
  run = { ...run, sessionManifestPath: manifestArtifact.path };
  manifest = updateSessionManifestRecord(manifest, {
    artifactPaths: {
      ...manifest.artifactPaths,
      sessionManifest: manifestArtifact.path,
    },
  });
  await persistRunStatus(input.artifactStore, run);
  await persistSessionManifest(input.artifactStore, manifest);
  await emitEvent('run.created', {
    approvalMode: input.approvalMode,
    manifestPath: manifestArtifact.path,
    planId: input.plan.id,
    policyPackName: input.loadedPolicyPack.pack.name,
    policyPackPath: input.loadedPolicyPath,
    policyPackVersion: input.loadedPolicyPack.pack.version,
    runDirectory: input.artifactStore.runDirectory,
    runner: run.runner,
    sessionId: session.id,
    specId: input.spec.id,
  });
  await emitEvent('session.started', {
    sessionId: session.id,
    stage: session.startStage,
    trigger: session.trigger,
  });

  if (input.githubIssue && input.issueIngestionResult) {
    const githubSourceArtifact = await input.artifactStore.writeTextArtifact(
      'github-issue-source',
      'github/issue.source.md',
      renderGithubIssueSourceMarkdown(input.githubIssue),
      'markdown',
      'Materialized GitHub issue snapshot used as the durable run source.',
    );
    const issueIngestionArtifact = await input.artifactStore.writeJsonArtifact(
      'github-issue-ingestion',
      'github/issue.ingestion.json',
      input.issueIngestionResult,
      'Normalized GitHub issue ingestion result for this governed run.',
    );

    const githubState = updateGithubState(input.githubState, {
      issue: input.githubIssue,
      issueIngestionPath: issueIngestionArtifact.path,
    });
    ({ manifest, run } = await persistGithubState(input.artifactStore, run, manifest, githubState));
    manifest = updateSessionManifestRecord(manifest, {
      artifactPaths: {
        ...manifest.artifactPaths,
        githubIssueSource: githubSourceArtifact.path,
        githubIssueIngestion: issueIngestionArtifact.path,
      },
    });
    await persistSessionManifest(input.artifactStore, manifest);
    await emitEvent('github.issue.ingested', {
      artifactPaths: [githubSourceArtifact.path, issueIngestionArtifact.path],
      issueNumber: input.githubIssue.issueNumber,
      repository: input.githubIssue.repo.fullName,
      url: input.githubIssue.url,
    });
  }

  return {
    approvalMode: input.approvalMode,
    approvalResolver: input.approvalResolver,
    artifactStore: input.artifactStore,
    beforeSnapshot,
    cwd: input.cwd,
    emitEvent,
    executedRunner: false,
    excludedRunPrefix,
    githubIssue: input.githubIssue,
    githubState: input.githubState,
    issueIngestionResult: input.issueIngestionResult,
    loadedPolicyPack: input.loadedPolicyPack,
    loadedPolicyPath: input.loadedPolicyPath,
    manifest,
    mode: 'fresh',
    progressReporter: input.progressReporter,
    repoRoot: input.repoRoot,
    run,
    runnerKind: input.runnerKind,
    session,
    spec: input.spec,
    plan: input.plan,
    verificationConfig: input.verificationConfig,
  };
}
