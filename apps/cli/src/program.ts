import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { listArtifactReferencesFromRunDirectory } from '@gdh/artifact-store';
import {
  type ApprovalPacket,
  type ApprovalResolution,
  createGithubIterationRequestRecord,
  createRunEvent,
  failureCategoryValues,
  failureRecordStatusValues,
  failureSeverityValues,
  failureSourceSurfaceValues,
  type GithubCommentRef,
  GithubCommentRefSchema,
  GithubDraftPrRequestSchema,
  GithubDraftPrResultSchema,
  type GithubIterationRequest,
  type GithubPullRequestRef,
  type ReviewPacket,
  type Run,
  type RunGithubState,
  type SessionManifest,
  updateSessionManifestRecord,
} from '@gdh/domain';
import {
  type BenchmarkCaseExecutionInput,
  type BenchmarkCaseExecutionSummary,
  compareBenchmarkRunArtifacts,
  loadBenchmarkRun,
  runBenchmarkTarget,
} from '@gdh/evals';
import type { GithubAdapter } from '@gdh/github-adapter';
import { renderDraftPullRequestBody, renderDraftPullRequestComment } from '@gdh/review-packets';
import { createIsoTimestamp, findRepoRoot } from '@gdh/shared';
import { Command } from 'commander';
import { readJsonArtifact } from './artifacts.js';
import { generateFailureSummary, listRecordedFailures, logFailureRecord } from './failures.js';
import {
  checkoutBranch,
  commitStagedChanges,
  currentBranchName,
  hasStagedChanges,
  isGitAncestorCommit,
  listDirtyWorkingTreePaths,
  localBranchExists,
  parseGithubRemoteUrl,
  pushBranchToOrigin,
  readGitHead,
  readOriginRemoteUrl,
  stagePaths,
} from './git.js';
import {
  createCommitMessage,
  createDraftPrTitle,
  deriveBranchName,
  emitGithubFailureEvent,
  resolveGithubClient,
  updateGithubState,
} from './github.js';
import { persistGithubState, persistSessionManifest } from './services/run-lifecycle/commit.js';
import { loadReviewPacket } from './services/run-lifecycle/context.js';
import {
  gitHeadChangedContinuityReason,
  uniqueStrings,
} from './services/run-lifecycle/inspection.js';
import {
  createRunLifecycleService,
  summarizeInspection,
  verifyRunLifecycle,
} from './services/run-lifecycle/service.js';
import type {
  LoadedDurableRunState,
  RunLifecycleInspection,
} from './services/run-lifecycle/types.js';
import {
  defaultApprovalMode,
  formatApprovalPromptSummary,
  formatBenchmarkCommandSummary,
  formatFailureListCommandSummary,
  formatFailureLogCommandSummary,
  formatFailureSummaryCommandSummary,
  formatGithubCommandSummary,
  formatTerminalSummary,
} from './summaries.js';
import {
  type ApprovalResolver,
  type BenchmarkCommandSummary,
  type GithubCommandOptions,
  type GithubCommandSummary,
  type ProgressReporter,
  type RunCommandOptions,
  type RunCommandSummary,
  supportedApprovalModeValues,
  supportedRunnerValues,
} from './types.js';

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

function assertSupportedFailureCategory(
  value: string,
): asserts value is (typeof failureCategoryValues)[number] {
  if (!failureCategoryValues.includes(value as (typeof failureCategoryValues)[number])) {
    throw new Error(
      `Unsupported failure category "${value}". Expected one of: ${failureCategoryValues.join(', ')}.`,
    );
  }
}

function assertSupportedFailureSeverity(
  value: string,
): asserts value is (typeof failureSeverityValues)[number] {
  if (!failureSeverityValues.includes(value as (typeof failureSeverityValues)[number])) {
    throw new Error(
      `Unsupported failure severity "${value}". Expected one of: ${failureSeverityValues.join(', ')}.`,
    );
  }
}

function assertSupportedFailureSourceSurface(
  value: string,
): asserts value is (typeof failureSourceSurfaceValues)[number] {
  if (!failureSourceSurfaceValues.includes(value as (typeof failureSourceSurfaceValues)[number])) {
    throw new Error(
      `Unsupported failure source surface "${value}". Expected one of: ${failureSourceSurfaceValues.join(', ')}.`,
    );
  }
}

function assertSupportedFailureRecordStatus(
  value: string,
): asserts value is (typeof failureRecordStatusValues)[number] {
  if (!failureRecordStatusValues.includes(value as (typeof failureRecordStatusValues)[number])) {
    throw new Error(
      `Unsupported failure status "${value}". Expected one of: ${failureRecordStatusValues.join(', ')}.`,
    );
  }
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

function createLiveProgressReporter(jsonOutput: boolean | undefined): ProgressReporter {
  const stream = jsonOutput ? process.stderr : process.stdout;
  let lastMessage = '';

  return ({ message }) => {
    const trimmed = message.trim();

    if (!trimmed || trimmed === lastMessage) {
      return;
    }

    lastMessage = trimmed;
    stream.write(`[runner] ${trimmed}\n`);
  };
}

export async function runSpecFile(
  specFile: string | undefined,
  options: RunCommandOptions = {},
): Promise<RunCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const runnerKind = options.runner ?? 'codex-cli';
  const approvalMode = options.approvalMode ?? defaultApprovalMode();

  assertSupportedRunner(runnerKind);
  assertSupportedApprovalMode(approvalMode);

  if ((!specFile && !options.githubIssue) || (specFile && options.githubIssue)) {
    throw new Error(
      'Provide exactly one run source: a local <spec-file> or --github-issue <owner/repo#123>.',
    );
  }

  const approvalResolver =
    approvalMode === 'interactive'
      ? (options.approvalResolver ?? promptForApproval)
      : options.approvalResolver;
  const progressReporter = options.progressReporter ?? createLiveProgressReporter(options.json);
  const service = createRunLifecycleService();

  return service.run({
    approvalMode,
    approvalResolver,
    cwd,
    githubAdapter: options.githubAdapter,
    githubConfig: options.githubConfig,
    policyPath: options.policyPath,
    progressReporter,
    runner: runnerKind,
    source: options.githubIssue
      ? { kind: 'github_issue', ref: options.githubIssue }
      : { kind: 'spec_file', path: specFile as string },
  });
}

export async function statusRunId(
  runId: string,
  options: { cwd?: string } = {},
): Promise<RunCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const service = createRunLifecycleService();
  const inspection = await service.status(runId, {
    cwd,
    emitStatusRequested: true,
  });
  const artifacts = await listArtifactReferencesFromRunDirectory(
    inspection.run.id,
    inspection.run.runDirectory,
  );

  return summarizeInspection(inspection, artifacts.length);
}

export async function verifyRunId(
  runId: string,
  options: { cwd?: string } = {},
): Promise<RunCommandSummary> {
  return verifyRunLifecycle(runId, {
    cwd: options.cwd ?? process.cwd(),
  });
}

async function executeBenchmarkCaseThroughCli(
  input: BenchmarkCaseExecutionInput,
): Promise<BenchmarkCaseExecutionSummary> {
  if (input.runner !== 'fake' && input.runner !== 'codex-cli') {
    throw new Error(
      `Benchmark execution does not support runner "${input.runner}" through the current CLI adapter.`,
    );
  }

  const service = createRunLifecycleService();
  const summary = await service.run({
    approvalMode: input.approvalMode,
    cwd: input.cwd,
    policyPath: input.policyPath,
    runner: input.runner,
    source: {
      kind: 'spec_file',
      path: input.specPath,
    },
  });

  return {
    artifactsDirectory: summary.artifactsDirectory,
    policyDecision: summary.policyDecision,
    reviewPacketPath: summary.reviewPacketPath,
    runId: summary.runId,
    status: summary.status,
    summary: summary.summary,
    verificationStatus: summary.verificationStatus,
  };
}

function createBenchmarkCommandSummary(input: {
  baselineLabel?: string;
  benchmarkRunId: string;
  caseCount: number;
  comparisonReportPath?: string;
  exitCode: number;
  governedRuns: BenchmarkCommandSummary['governedRuns'];
  passedCaseCount: number;
  regressionResultPath?: string;
  regressionStatus?: 'passed' | 'failed';
  score: number;
  status: 'completed' | 'failed';
  suiteId?: string;
  summary: string;
  targetId: string;
  targetKind: 'case' | 'suite';
  artifactsDirectory: string;
}): BenchmarkCommandSummary {
  return input;
}

function extractGovernedRuns(
  caseResults: Array<{
    caseId: string;
    governedRunId?: string;
    governedRunPath?: string;
  }>,
): BenchmarkCommandSummary['governedRuns'] {
  return caseResults
    .filter(
      (
        caseResult,
      ): caseResult is {
        caseId: string;
        governedRunId: string;
        governedRunPath: string;
      } => Boolean(caseResult.governedRunId && caseResult.governedRunPath),
    )
    .map((caseResult) => ({
      caseId: caseResult.caseId,
      runDirectory: caseResult.governedRunPath,
      runId: caseResult.governedRunId,
    }));
}

export async function runBenchmarkTargetId(
  targetId: string,
  options: { ciSafe?: boolean; cwd?: string } = {},
): Promise<BenchmarkCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const result = await runBenchmarkTarget({
    ciSafe: options.ciSafe,
    executeCase: executeBenchmarkCaseThroughCli,
    repoRoot,
    targetId,
  });

  return createBenchmarkCommandSummary({
    artifactsDirectory: result.artifactsDirectory,
    baselineLabel: result.comparisonReport?.rhs.label,
    benchmarkRunId: result.benchmarkRun.id,
    caseCount: result.benchmarkRun.caseResults.length,
    comparisonReportPath: result.benchmarkRun.comparisonReportPath,
    exitCode: result.exitCode,
    governedRuns: extractGovernedRuns(result.benchmarkRun.caseResults),
    passedCaseCount: result.benchmarkRun.caseResults.filter(
      (caseResult) => caseResult.status === 'passed',
    ).length,
    regressionResultPath: result.benchmarkRun.regressionResultPath,
    regressionStatus: result.regressionResult?.status,
    score: result.benchmarkRun.score.normalizedScore,
    status: result.exitCode === 0 ? 'completed' : 'failed',
    suiteId: result.benchmarkRun.suiteId,
    summary: result.benchmarkRun.summary,
    targetId: result.benchmarkRun.target.id,
    targetKind: result.benchmarkRun.target.kind,
  });
}

export async function compareBenchmarkRunId(
  lhs: string,
  options: { againstBaseline?: boolean; cwd?: string; rhs?: string } = {},
): Promise<BenchmarkCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const result = await compareBenchmarkRunArtifacts({
    againstBaseline: options.againstBaseline,
    lhs,
    repoRoot,
    rhs: options.rhs,
  });

  return createBenchmarkCommandSummary({
    artifactsDirectory: result.benchmarkRun.runDirectory,
    baselineLabel: result.comparisonReport.rhs.label,
    benchmarkRunId: result.benchmarkRun.id,
    caseCount: result.benchmarkRun.caseResults.length,
    comparisonReportPath: result.benchmarkRun.comparisonReportPath,
    exitCode: result.regressionResult.status === 'passed' ? 0 : 1,
    governedRuns: extractGovernedRuns(result.benchmarkRun.caseResults),
    passedCaseCount: result.benchmarkRun.caseResults.filter(
      (caseResult) => caseResult.status === 'passed',
    ).length,
    regressionResultPath: result.benchmarkRun.regressionResultPath,
    regressionStatus: result.regressionResult.status,
    score: result.benchmarkRun.score.normalizedScore,
    status: result.regressionResult.status === 'passed' ? 'completed' : 'failed',
    suiteId: result.benchmarkRun.suiteId,
    summary: result.comparisonReport.summary,
    targetId: result.benchmarkRun.target.id,
    targetKind: result.benchmarkRun.target.kind,
  });
}

export async function showBenchmarkRunId(
  runId: string,
  options: { cwd?: string } = {},
): Promise<BenchmarkCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const benchmarkRun = await loadBenchmarkRun(repoRoot, runId);
  const regressionStatus = benchmarkRun.regressionResultPath
    ? await readJsonArtifact(
        benchmarkRun.regressionResultPath,
        {
          parse(value: unknown) {
            return (
              value as {
                status?: 'passed' | 'failed';
              }
            ).status;
          },
        },
        'benchmark regression result',
      )
    : undefined;

  return createBenchmarkCommandSummary({
    artifactsDirectory: benchmarkRun.runDirectory,
    benchmarkRunId: benchmarkRun.id,
    caseCount: benchmarkRun.caseResults.length,
    comparisonReportPath: benchmarkRun.comparisonReportPath,
    exitCode: benchmarkRun.status === 'completed' ? 0 : 1,
    governedRuns: extractGovernedRuns(benchmarkRun.caseResults),
    passedCaseCount: benchmarkRun.caseResults.filter((caseResult) => caseResult.status === 'passed')
      .length,
    regressionResultPath: benchmarkRun.regressionResultPath,
    regressionStatus,
    score: benchmarkRun.score.normalizedScore,
    status: benchmarkRun.status === 'completed' ? 'completed' : 'failed',
    suiteId: benchmarkRun.suiteId,
    summary: benchmarkRun.summary,
    targetId: benchmarkRun.target.id,
    targetKind: benchmarkRun.target.kind,
  });
}

export async function resumeRunId(
  runId: string,
  options: {
    approvalResolver?: ApprovalResolver;
    cwd?: string;
    json?: boolean;
    progressReporter?: ProgressReporter;
  } = {},
): Promise<RunCommandSummary> {
  const approvalResolver =
    options.approvalResolver ??
    (process.stdin.isTTY && process.stdout.isTTY ? promptForApproval : undefined);
  const progressReporter = options.progressReporter ?? createLiveProgressReporter(options.json);
  const service = createRunLifecycleService();

  return service.resume(runId, {
    approvalResolver,
    cwd: options.cwd ?? process.cwd(),
    progressReporter,
  });
}

interface DraftPrEligibilityDecision {
  eligible: boolean;
  reasons: string[];
  summary: string;
}

async function listIgnoredDraftPrContinuityReasons(input: {
  continuity: RunLifecycleInspection['continuity'];
  repoRoot: string;
}): Promise<string[]> {
  if (
    input.continuity.status !== 'incompatible' ||
    input.continuity.reasons.length !== 1 ||
    input.continuity.reasons[0] !== gitHeadChangedContinuityReason
  ) {
    return [];
  }

  const storedHead = input.continuity.storedSnapshot.gitHead;
  const currentHead = input.continuity.currentSnapshot.gitHead;

  if (!storedHead || !currentHead) {
    return [];
  }

  const movedForward = await isGitAncestorCommit(input.repoRoot, storedHead, currentHead);
  return movedForward ? [gitHeadChangedContinuityReason] : [];
}

function evaluateDraftPrEligibility(input: {
  changedFiles?: LoadedDurableRunState['changedFiles'];
  continuity: RunLifecycleInspection['continuity'];
  ignoredContinuityReasons?: string[];
  manifest: SessionManifest;
  reviewPacket: ReviewPacket;
  run: Run;
}): DraftPrEligibilityDecision {
  const reasons: string[] = [];

  if (input.run.status !== 'completed') {
    reasons.push(`Run status "${input.run.status}" is not eligible for draft PR creation.`);
  }

  if (input.run.currentStage !== 'verification_completed') {
    reasons.push('Run did not reach the completed verification stage.');
  }

  if (input.run.verificationStatus !== 'passed') {
    reasons.push('Run verification did not pass.');
  }

  if (input.manifest.verificationState.status !== 'passed') {
    reasons.push('The durable manifest does not record a passing verification state.');
  }

  if (input.reviewPacket.packetStatus !== 'ready') {
    reasons.push('The review packet is not marked ready for publication.');
  }

  if (input.reviewPacket.claimVerification.status !== 'passed') {
    reasons.push('Claim verification did not pass for the review packet.');
  }

  if (
    input.manifest.approvalState.status === 'pending' ||
    input.manifest.approvalState.status === 'denied'
  ) {
    reasons.push(
      `Approval state "${input.manifest.approvalState.status}" is not eligible for draft PR creation.`,
    );
  }

  if (input.continuity.status === 'incompatible') {
    const ignoredReasons = new Set(input.ignoredContinuityReasons ?? []);
    reasons.push(...input.continuity.reasons.filter((reason) => !ignoredReasons.has(reason)));
  }

  if (input.run.github?.pullRequest) {
    reasons.push(
      `Run already has a recorded draft PR #${input.run.github.pullRequest.pullRequestNumber}. Use "gdh pr sync-packet" instead of creating another PR.`,
    );
  }

  if (!input.changedFiles || input.changedFiles.files.length === 0) {
    reasons.push('No captured non-artifact file changes were available for draft PR creation.');
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    summary:
      reasons.length === 0
        ? 'Run is eligible for draft PR creation.'
        : 'Run is not eligible for draft PR creation.',
  };
}

async function resolveGithubRepoForRun(
  repoRoot: string,
  run: Run,
  adapter: GithubAdapter,
): Promise<GithubPullRequestRef['repo']> {
  if (run.github?.issue?.repo) {
    const remoteUrl = await readOriginRemoteUrl(repoRoot);
    const originRepo = parseGithubRemoteUrl(remoteUrl);

    if (originRepo && `${originRepo.owner}/${originRepo.repo}` !== run.github.issue.repo.fullName) {
      throw new Error(
        `Git remote origin points at "${originRepo.owner}/${originRepo.repo}", but the run is linked to "${run.github.issue.repo.fullName}". Refusing to publish a PR to a mismatched repository.`,
      );
    }

    return adapter.fetchRepo(run.github.issue.repo);
  }

  const remoteUrl = await readOriginRemoteUrl(repoRoot);
  const parsedRemote = parseGithubRemoteUrl(remoteUrl);

  if (!parsedRemote) {
    throw new Error(
      `Git remote origin "${remoteUrl}" is not a supported GitHub remote URL. Configure origin to a GitHub repository before creating a draft PR.`,
    );
  }

  return adapter.fetchRepo(parsedRemote);
}

async function prepareBranchForRun(input: {
  branchName: string;
  changedFiles: NonNullable<LoadedDurableRunState['changedFiles']>;
  repo: GithubPullRequestRef['repo'];
  repoRoot: string;
  runId: string;
}): Promise<{
  branch: RunGithubState['branch'];
  details: {
    action: 'created' | 'reused' | 'selected';
    branchName: string;
    createdAt: string;
    dirtyPaths: string[];
    previousBranch: string;
    summary: string;
    unexpectedDirtyPaths: string[];
  };
}> {
  const dirtyPaths = await listDirtyWorkingTreePaths(input.repoRoot);
  const runChangedPaths = new Set(input.changedFiles.files.map((file) => file.path));
  const unexpectedDirtyPaths = dirtyPaths.filter((path) => !runChangedPaths.has(path));

  if (unexpectedDirtyPaths.length > 0) {
    throw new Error(
      `Working tree contains changes outside the recorded run scope: ${unexpectedDirtyPaths.join(', ')}`,
    );
  }

  const previousBranch = await currentBranchName(input.repoRoot);
  const branchExists = await localBranchExists(input.repoRoot, input.branchName);
  let action: 'created' | 'reused' | 'selected' =
    previousBranch === input.branchName ? 'reused' : 'selected';

  if (previousBranch !== input.branchName) {
    if (dirtyPaths.length > 0 && branchExists) {
      throw new Error(
        `Target branch "${input.branchName}" already exists locally and the working tree still has run changes. Refusing to switch branches conservatively.`,
      );
    }

    await checkoutBranch(input.repoRoot, input.branchName, !branchExists);
    action = branchExists ? 'selected' : 'created';
  }

  const branch = {
    repo: input.repo,
    name: input.branchName,
    ref: `refs/heads/${input.branchName}`,
    sha: await readGitHead(input.repoRoot),
    remoteName: 'origin',
    url: `${input.repo.url ?? `https://github.com/${input.repo.fullName}`}/tree/${input.branchName}`,
    existed: branchExists,
  } satisfies NonNullable<RunGithubState['branch']>;

  return {
    branch,
    details: {
      action,
      branchName: input.branchName,
      createdAt: createIsoTimestamp(),
      dirtyPaths,
      previousBranch,
      summary:
        action === 'created'
          ? `Created branch "${input.branchName}" for draft PR publication.`
          : action === 'selected'
            ? `Selected existing branch "${input.branchName}" for draft PR publication.`
            : `Reused current branch "${input.branchName}" for draft PR publication.`,
      unexpectedDirtyPaths,
    },
  };
}

function extractIterationInstruction(
  comment: GithubCommentRef,
  prefix: string,
): string | undefined {
  const body = comment.body.trim();

  if (!body.startsWith(prefix)) {
    return undefined;
  }

  const instruction = body.slice(prefix.length).trim();
  return instruction || undefined;
}

function renderIterationRequestMarkdown(input: {
  comment: GithubCommentRef;
  instruction: string;
  reviewPacket: ReviewPacket;
  runId: string;
}): string {
  return [
    `# Iteration Request For Run ${input.runId}`,
    '',
    '## Objective',
    `Address the explicit GitHub PR follow-up request: ${input.instruction}`,
    '',
    '## Constraints',
    '- Preserve the existing governed-delivery policy, approval, verification, and evidence rules.',
    '- Treat this as a local-operator initiated follow-up, not an autonomous remote action.',
    '',
    '## Acceptance Criteria',
    '- The follow-up request from the PR comment is addressed or explicitly explained with evidence.',
    '- A new governed run can reference this follow-up input without needing the original PR comment context inline.',
    '',
    '## Prior Run Context',
    `- Original run: ${input.runId}`,
    `- Original objective: ${input.reviewPacket.objective}`,
    `- Source comment: ${input.comment.url ?? `comment ${input.comment.commentId}`}`,
    '',
    '## Requested Follow-Up',
    input.instruction,
  ].join('\n');
}

export async function createDraftPrForRun(
  runId: string,
  options: GithubCommandOptions = {},
): Promise<GithubCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const lifecycleService = createRunLifecycleService();
  let inspection: RunLifecycleInspection | undefined;

  try {
    inspection = await lifecycleService.status(runId, { cwd });
    const reviewPacket = await loadReviewPacket(repoRoot, runId);
    const ignoredContinuityReasons = await listIgnoredDraftPrContinuityReasons({
      continuity: inspection.continuity,
      repoRoot,
    });
    const eligibility = evaluateDraftPrEligibility({
      changedFiles: inspection.state.changedFiles,
      continuity: inspection.continuity,
      ignoredContinuityReasons,
      manifest: inspection.manifest,
      reviewPacket,
      run: inspection.run,
    });

    if (!eligibility.eligible) {
      return {
        artifactsDirectory: inspection.run.runDirectory,
        runId,
        status: 'blocked',
        summary: `${eligibility.summary} ${eligibility.reasons.join(' ')}`.trim(),
      };
    }

    const { adapter, config } = await resolveGithubClient(repoRoot, {
      githubAdapter: options.githubAdapter,
      githubConfig: options.githubConfig,
    });
    let run = inspection.run;
    let manifest = inspection.manifest;
    const repo = await resolveGithubRepoForRun(repoRoot, run, adapter);
    const branchName =
      options.branchName ??
      run.github?.branch?.name ??
      deriveBranchName(run, reviewPacket.specTitle, run.github?.issue);
    const branchPreparation = await prepareBranchForRun({
      branchName,
      changedFiles: inspection.state.changedFiles as NonNullable<
        LoadedDurableRunState['changedFiles']
      >,
      repo,
      repoRoot,
      runId,
    });
    const branchPreparationArtifact = await inspection.artifactStore.writeJsonArtifact(
      'github-branch-preparation',
      'github/branch-prepared.json',
      branchPreparation.details,
      'Local Git branch preparation details for draft PR publication.',
    );

    let github = updateGithubState(run.github, {
      branch: branchPreparation.branch,
      branchPreparationPath: branchPreparationArtifact.path,
    });
    ({ manifest, run } = await persistGithubState(inspection.artifactStore, run, manifest, github));
    await inspection.artifactStore.appendEvent(
      createRunEvent(run.id, 'github.branch.prepared', {
        action: branchPreparation.details.action,
        artifactPath: branchPreparationArtifact.path,
        branchName,
      }),
    );

    await stagePaths(
      repoRoot,
      (
        inspection.state.changedFiles as NonNullable<LoadedDurableRunState['changedFiles']>
      ).files.map((file) => file.path),
    );

    if (await hasStagedChanges(repoRoot)) {
      await commitStagedChanges(
        repoRoot,
        createCommitMessage(reviewPacket.specTitle, run.github?.issue),
      );
    }

    const baseBranch = options.baseBranch ?? config.defaultBaseBranch ?? repo.defaultBranch;

    if (!baseBranch) {
      throw new Error(
        `Could not determine a base branch for ${repo.fullName}. Provide --base-branch explicitly or configure github.defaultBaseBranch.`,
      );
    }

    await adapter.ensureBranch({
      repo,
      branchName,
      baseBranch,
    });
    await pushBranchToOrigin(repoRoot, branchName);

    const prBody = renderDraftPullRequestBody(reviewPacket);
    const prBodyArtifact = await inspection.artifactStore.writeTextArtifact(
      'github-pr-body',
      'github/pr-body.md',
      prBody,
      'markdown',
      'Rendered draft PR body derived from the structured review packet.',
    );
    const draftPrRequest = GithubDraftPrRequestSchema.parse({
      runId: run.id,
      repo,
      baseBranch,
      headBranch: branchName,
      title: createDraftPrTitle(reviewPacket.specTitle, run.github?.issue),
      body: prBody,
      draft: true,
      reviewPacketPath: resolve(run.runDirectory, 'review-packet.md'),
      artifactPaths: [prBodyArtifact.path, resolve(run.runDirectory, 'review-packet.md')],
      createdAt: createIsoTimestamp(),
    });
    const draftPrRequestArtifact = await inspection.artifactStore.writeJsonArtifact(
      'github-draft-pr-request',
      'github/draft-pr.request.json',
      draftPrRequest,
      'Draft PR creation request prepared from the verified review packet.',
    );
    await inspection.artifactStore.appendEvent(
      createRunEvent(run.id, 'github.pr.draft_requested', {
        artifactPath: draftPrRequestArtifact.path,
        baseBranch,
        branchName,
      }),
    );
    const pullRequest = await adapter.createDraftPullRequest(draftPrRequest);
    const draftPrResult = GithubDraftPrResultSchema.parse({
      runId: run.id,
      request: draftPrRequest,
      pullRequest,
      bodyUpdated: true,
      createdAt: createIsoTimestamp(),
    });
    const draftPrResultArtifact = await inspection.artifactStore.writeJsonArtifact(
      'github-draft-pr-result',
      'github/draft-pr.result.json',
      draftPrResult,
      'Observed GitHub draft PR creation result for this run.',
    );

    github = updateGithubState(github, {
      pullRequest,
      draftPrRequestPath: draftPrRequestArtifact.path,
      draftPrResultPath: draftPrResultArtifact.path,
      publicationPath: prBodyArtifact.path,
    });
    ({ manifest, run } = await persistGithubState(inspection.artifactStore, run, manifest, github));
    manifest = updateSessionManifestRecord(manifest, {
      artifactPaths: {
        ...manifest.artifactPaths,
        githubBranchPreparation: branchPreparationArtifact.path,
        githubDraftPrRequest: draftPrRequestArtifact.path,
        githubDraftPrResult: draftPrResultArtifact.path,
        githubPrBody: prBodyArtifact.path,
      },
    });
    await persistSessionManifest(inspection.artifactStore, manifest);
    await inspection.artifactStore.appendEvent(
      createRunEvent(run.id, 'github.pr.draft_created', {
        artifactPath: draftPrResultArtifact.path,
        pullRequestNumber: pullRequest.pullRequestNumber,
        url: pullRequest.url,
      }),
    );

    return {
      artifactsDirectory: run.runDirectory,
      branchName,
      pullRequestNumber: pullRequest.pullRequestNumber,
      pullRequestUrl: pullRequest.url,
      runId,
      status: 'created',
      summary: `Draft PR #${pullRequest.pullRequestNumber} created for run "${run.id}".`,
    };
  } catch (error) {
    if (inspection) {
      await emitGithubFailureEvent(inspection.artifactStore, runId, 'draft_pr_create', error);
    }

    throw error;
  }
}

export async function syncPullRequestPacket(
  runId: string,
  options: GithubCommandOptions = {},
): Promise<GithubCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const lifecycleService = createRunLifecycleService();
  let inspection: RunLifecycleInspection | undefined;

  try {
    inspection = await lifecycleService.status(runId, { cwd });
    const pullRequest = inspection.run.github?.pullRequest;

    if (!pullRequest) {
      return {
        artifactsDirectory: inspection.run.runDirectory,
        runId,
        status: 'blocked',
        summary: 'Run does not have a recorded draft PR. Create the draft PR first.',
      };
    }

    const reviewPacket = await loadReviewPacket(repoRoot, runId);
    const { adapter } = await resolveGithubClient(repoRoot, {
      githubAdapter: options.githubAdapter,
      githubConfig: options.githubConfig,
    });
    const prBody = renderDraftPullRequestBody(reviewPacket);
    const prComment = renderDraftPullRequestComment(reviewPacket);
    const bodyArtifact = await inspection.artifactStore.writeTextArtifact(
      'github-pr-body',
      'github/pr-body.md',
      prBody,
      'markdown',
      'Rendered draft PR body derived from the structured review packet.',
    );
    const commentArtifact = await inspection.artifactStore.writeTextArtifact(
      'github-pr-comment',
      'github/pr-comment.md',
      prComment,
      'markdown',
      'Supplemental PR comment derived from the structured review packet.',
    );
    const updatedPullRequest = await adapter.updatePullRequestBody({
      pullRequest,
      body: prBody,
    });
    const publishedComment = await adapter.publishPullRequestComment({
      repo: pullRequest.repo,
      pullRequestNumber: pullRequest.pullRequestNumber,
      body: prComment,
      commentId: options.commentId,
    });
    const publicationArtifact = await inspection.artifactStore.writeJsonArtifact(
      'github-pr-publication',
      'github/pr-publication.json',
      {
        bodyArtifactPath: bodyArtifact.path,
        comment: publishedComment,
        pullRequest: updatedPullRequest,
        publishedAt: createIsoTimestamp(),
      },
      'Observed GitHub PR body/comment publication result for this run.',
    );

    const github = updateGithubState(inspection.run.github, {
      pullRequest: updatedPullRequest,
      publicationPath: publicationArtifact.path,
    });
    let run = inspection.run;
    let manifest = inspection.manifest;
    ({ manifest, run } = await persistGithubState(inspection.artifactStore, run, manifest, github));
    manifest = updateSessionManifestRecord(manifest, {
      artifactPaths: {
        ...manifest.artifactPaths,
        githubPrBody: bodyArtifact.path,
        githubPrComment: commentArtifact.path,
        githubPrPublication: publicationArtifact.path,
      },
    });
    await persistSessionManifest(inspection.artifactStore, manifest);
    await inspection.artifactStore.appendEvent(
      createRunEvent(run.id, 'github.pr.comment.published', {
        commentId: publishedComment.commentId,
        pullRequestNumber: updatedPullRequest.pullRequestNumber,
        url: publishedComment.url,
      }),
    );

    return {
      artifactsDirectory: run.runDirectory,
      branchName: github.branch?.name,
      pullRequestNumber: updatedPullRequest.pullRequestNumber,
      pullRequestUrl: updatedPullRequest.url,
      runId,
      status: 'synced',
      summary: `Draft PR #${updatedPullRequest.pullRequestNumber} body and supplemental comment were synced from the current review packet.`,
    };
  } catch (error) {
    if (inspection) {
      await emitGithubFailureEvent(inspection.artifactStore, runId, 'draft_pr_sync_packet', error);
    }

    throw error;
  }
}

export async function syncPullRequestComments(
  runId: string,
  options: GithubCommandOptions = {},
): Promise<GithubCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const lifecycleService = createRunLifecycleService();
  let inspection: RunLifecycleInspection | undefined;

  try {
    inspection = await lifecycleService.status(runId, { cwd });
    const pullRequest = inspection.run.github?.pullRequest;

    if (!pullRequest) {
      return {
        artifactsDirectory: inspection.run.runDirectory,
        runId,
        status: 'blocked',
        summary: 'Run does not have a recorded draft PR. Create the draft PR first.',
      };
    }

    const { adapter, config } = await resolveGithubClient(repoRoot, {
      githubAdapter: options.githubAdapter,
      githubConfig: options.githubConfig,
    });
    const comments = await adapter.listPullRequestComments(pullRequest);
    const commentsArtifact = await inspection.artifactStore.writeJsonArtifact(
      'github-pr-comments',
      'github/pr-comments.json',
      comments,
      'Latest GitHub PR comments fetched for deterministic local review.',
    );
    const iterationRequests: GithubIterationRequest[] = [];

    for (const comment of comments) {
      const instruction = extractIterationInstruction(comment, config.iterationCommandPrefix);

      if (!instruction) {
        continue;
      }

      const request = createGithubIterationRequestRecord({
        runId,
        pullRequest,
        sourceComment: comment,
        instruction,
        command: config.iterationCommandPrefix,
      });
      const requestArtifact = await inspection.artifactStore.writeJsonArtifact(
        'github-iteration-request',
        `github/iteration-requests/${request.id}.json`,
        request,
        'Normalized GitHub iteration request detected from a PR comment.',
      );
      iterationRequests.push(request);
      await inspection.artifactStore.appendEvent(
        createRunEvent(runId, 'github.iteration.requested', {
          artifactPath: requestArtifact.path,
          commentId: comment.commentId,
          pullRequestNumber: pullRequest.pullRequestNumber,
        }),
      );
    }

    const runDirectory = inspection.run.runDirectory;
    const github = updateGithubState(inspection.run.github, {
      commentSyncPath: commentsArtifact.path,
      iterationRequestPaths: uniqueStrings([
        ...(inspection.run.github?.iterationRequestPaths ?? []),
        ...iterationRequests.map((request) =>
          resolve(runDirectory, `github/iteration-requests/${request.id}.json`),
        ),
      ]),
    });
    let run = inspection.run;
    let manifest = inspection.manifest;
    ({ manifest, run } = await persistGithubState(inspection.artifactStore, run, manifest, github));
    manifest = updateSessionManifestRecord(manifest, {
      artifactPaths: {
        ...manifest.artifactPaths,
        githubPrComments: commentsArtifact.path,
      },
    });
    await persistSessionManifest(inspection.artifactStore, manifest);

    return {
      artifactsDirectory: run.runDirectory,
      commentCount: comments.length,
      iterationRequestCount: iterationRequests.length,
      pullRequestNumber: pullRequest.pullRequestNumber,
      pullRequestUrl: pullRequest.url,
      runId,
      status: 'inspected',
      summary:
        iterationRequests.length > 0
          ? `Fetched ${comments.length} PR comment(s) and detected ${iterationRequests.length} explicit iteration request(s).`
          : `Fetched ${comments.length} PR comment(s) and detected no explicit iteration requests.`,
    };
  } catch (error) {
    if (inspection) {
      await emitGithubFailureEvent(inspection.artifactStore, runId, 'draft_pr_comments', error);
    }

    throw error;
  }
}

export async function materializeIterationRequest(
  runId: string,
  options: GithubCommandOptions = {},
): Promise<GithubCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const lifecycleService = createRunLifecycleService();
  let inspection: RunLifecycleInspection | undefined;

  try {
    const commentsSummary = await syncPullRequestComments(runId, options);
    inspection = await lifecycleService.status(runId, { cwd });
    const pullRequest = inspection.run.github?.pullRequest;

    if (!pullRequest) {
      return {
        artifactsDirectory: inspection.run.runDirectory,
        runId,
        status: 'blocked',
        summary: 'Run does not have a recorded draft PR. Create the draft PR first.',
      };
    }

    const comments = await readJsonArtifact(
      resolve(inspection.run.runDirectory, 'github/pr-comments.json'),
      {
        parse(value: unknown) {
          if (!Array.isArray(value)) {
            throw new Error('Expected an array of PR comments.');
          }

          return value.map((comment) => GithubCommentRefSchema.parse(comment));
        },
      },
      'GitHub PR comments',
    );
    const { config } = await resolveGithubClient(repoRoot, {
      githubAdapter: options.githubAdapter,
      githubConfig: options.githubConfig,
    });
    const latestComment = [...comments]
      .reverse()
      .find((comment) => extractIterationInstruction(comment, config.iterationCommandPrefix));

    if (!latestComment) {
      return {
        artifactsDirectory: inspection.run.runDirectory,
        commentCount: commentsSummary.commentCount,
        iterationRequestCount: commentsSummary.iterationRequestCount,
        pullRequestNumber: pullRequest.pullRequestNumber,
        pullRequestUrl: pullRequest.url,
        runId,
        status: 'blocked',
        summary: 'No explicit iteration request was detected in the current PR comments.',
      };
    }

    const reviewPacket = await loadReviewPacket(repoRoot, runId);
    const instruction = extractIterationInstruction(latestComment, config.iterationCommandPrefix);

    if (!instruction) {
      throw new Error('Latest iteration comment could not be normalized safely.');
    }

    const provisionalRequest = createGithubIterationRequestRecord({
      runId,
      pullRequest,
      sourceComment: latestComment,
      instruction,
      command: config.iterationCommandPrefix,
    });
    const iterationMarkdown = renderIterationRequestMarkdown({
      comment: latestComment,
      instruction,
      reviewPacket,
      runId,
    });
    const markdownArtifact = await inspection.artifactStore.writeTextArtifact(
      'github-iteration-input',
      `github/iteration-requests/${provisionalRequest.id}.md`,
      iterationMarkdown,
      'markdown',
      'Follow-up governed-run input materialized from an explicit PR iteration request.',
    );
    const requestWithInput = createGithubIterationRequestRecord({
      runId,
      pullRequest,
      sourceComment: latestComment,
      instruction,
      command: config.iterationCommandPrefix,
      normalizedInputPath: markdownArtifact.path,
    });
    const requestArtifact = await inspection.artifactStore.writeJsonArtifact(
      'github-iteration-request',
      `github/iteration-requests/${requestWithInput.id}.json`,
      requestWithInput,
      'Normalized GitHub iteration request with a materialized follow-up input path.',
    );
    const github = updateGithubState(inspection.run.github, {
      iterationRequestPaths: uniqueStrings([
        ...(inspection.run.github?.iterationRequestPaths ?? []),
        requestArtifact.path,
      ]),
    });
    let run = inspection.run;
    let manifest = inspection.manifest;
    ({ manifest, run } = await persistGithubState(inspection.artifactStore, run, manifest, github));
    await inspection.artifactStore.appendEvent(
      createRunEvent(run.id, 'github.iteration.requested', {
        artifactPath: requestArtifact.path,
        commentId: latestComment.commentId,
        normalizedInputPath: markdownArtifact.path,
        pullRequestNumber: pullRequest.pullRequestNumber,
      }),
    );

    return {
      artifactsDirectory: run.runDirectory,
      commentCount: commentsSummary.commentCount,
      iterationInputPath: markdownArtifact.path,
      iterationRequestCount: commentsSummary.iterationRequestCount,
      pullRequestNumber: pullRequest.pullRequestNumber,
      pullRequestUrl: pullRequest.url,
      runId,
      status: 'created',
      summary: `Materialized a follow-up iteration input from PR comment ${latestComment.commentId}.`,
    };
  } catch (error) {
    if (inspection) {
      await emitGithubFailureEvent(inspection.artifactStore, runId, 'draft_pr_iterate', error);
    }

    throw error;
  }
}

export function createProgram(): Command {
  const program = new Command();

  program.name('gdh').description('Governed delivery control plane CLI').version('0.2.0');

  program
    .command('run')
    .description('Normalize a spec and start a governed run')
    .argument('[spec-file]', 'Path to a local spec file')
    .option('--runner <runner>', 'Runner implementation to use', 'codex-cli')
    .option(
      '--approval-mode <mode>',
      'Approval handling mode (interactive or fail)',
      defaultApprovalMode(),
    )
    .option('--github-issue <issue-ref>', 'Ingest and run a GitHub issue reference')
    .option(
      '--policy <policy-file>',
      'Policy pack to evaluate before write-capable execution',
      'policies/default.policy.yaml',
    )
    .option('--json', 'Emit the final summary as JSON')
    .action(
      async (
        specFile: string | undefined,
        commandOptions: {
          approvalMode?: string;
          githubIssue?: string;
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
            githubIssue: commandOptions.githubIssue,
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
          json: commandOptions.json,
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

  const failuresCommand = program
    .command('failures')
    .description('Record and review durable operator failure records');

  failuresCommand
    .command('log')
    .description('Create a structured failure record and refresh the summary artifacts')
    .requiredOption('--title <title>', 'Short failure title')
    .requiredOption('--category <category>', 'Failure taxonomy category')
    .requiredOption('--severity <severity>', 'Failure severity')
    .requiredOption('--source-surface <surface>', 'Source surface where the failure was found')
    .requiredOption('--description <description>', 'Evidence-backed failure description')
    .option('--run-id <run-id>', 'Related governed run identifier')
    .option('--benchmark-id <benchmark-run-id>', 'Related benchmark run identifier')
    .option('--reproduction-notes <notes>', 'Reproduction or observation notes')
    .option('--suspected-cause <cause>', 'Suspected root cause')
    .option('--status <status>', 'Initial record status', 'open')
    .option('--owner <owner>', 'Owner name or handle', 'unassigned')
    .option('--timestamp <timestamp>', 'Override timestamp, for example when seeding known issues')
    .option('--id <id>', 'Explicit failure record identifier')
    .option(
      '--link <path>',
      'Artifact or document path to attach to the record; repeat for multiple links',
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .option('--json', 'Emit the failure-log summary as JSON')
    .action(
      async (commandOptions: {
        benchmarkId?: string;
        category?: string;
        description?: string;
        id?: string;
        json?: boolean;
        link?: string[];
        owner?: string;
        reproductionNotes?: string;
        runId?: string;
        severity?: string;
        sourceSurface?: string;
        status?: string;
        suspectedCause?: string;
        timestamp?: string;
        title?: string;
      }) => {
        try {
          const category = commandOptions.category ?? '';
          const severity = commandOptions.severity ?? '';
          const sourceSurface = commandOptions.sourceSurface ?? '';
          const status = commandOptions.status ?? 'open';

          assertSupportedFailureCategory(category);
          assertSupportedFailureSeverity(severity);
          assertSupportedFailureSourceSurface(sourceSurface);
          assertSupportedFailureRecordStatus(status);

          const summary = await logFailureRecord({
            benchmarkRunId: commandOptions.benchmarkId,
            category,
            cwd: process.cwd(),
            description: commandOptions.description ?? '',
            id: commandOptions.id,
            links: commandOptions.link,
            owner: commandOptions.owner,
            reproductionNotes: commandOptions.reproductionNotes,
            runId: commandOptions.runId,
            severity,
            sourceSurface,
            status,
            suspectedCause: commandOptions.suspectedCause,
            timestamp: commandOptions.timestamp,
            title: commandOptions.title ?? '',
          });

          if (commandOptions.json) {
            console.log(JSON.stringify(summary, null, 2));
          } else {
            console.log(formatFailureLogCommandSummary(summary));
          }

          process.exitCode = 0;
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      },
    );

  failuresCommand
    .command('list')
    .description('List recorded failures with optional filters')
    .option('--category <category>', 'Filter by failure category')
    .option('--severity <severity>', 'Filter by failure severity')
    .option('--source-surface <surface>', 'Filter by failure source surface')
    .option('--status <status>', 'Filter by failure status')
    .option('--owner <owner>', 'Filter by record owner')
    .option('--json', 'Emit the filtered failure list as JSON')
    .action(
      async (commandOptions: {
        category?: string;
        json?: boolean;
        owner?: string;
        severity?: string;
        sourceSurface?: string;
        status?: string;
      }) => {
        try {
          let category: (typeof failureCategoryValues)[number] | undefined;
          let severity: (typeof failureSeverityValues)[number] | undefined;
          let sourceSurface: (typeof failureSourceSurfaceValues)[number] | undefined;
          let status: (typeof failureRecordStatusValues)[number] | undefined;

          if (commandOptions.category) {
            assertSupportedFailureCategory(commandOptions.category);
            category = commandOptions.category;
          }

          if (commandOptions.severity) {
            assertSupportedFailureSeverity(commandOptions.severity);
            severity = commandOptions.severity;
          }

          if (commandOptions.sourceSurface) {
            assertSupportedFailureSourceSurface(commandOptions.sourceSurface);
            sourceSurface = commandOptions.sourceSurface;
          }

          if (commandOptions.status) {
            assertSupportedFailureRecordStatus(commandOptions.status);
            status = commandOptions.status;
          }

          const summary = await listRecordedFailures({
            category,
            cwd: process.cwd(),
            owner: commandOptions.owner,
            severity,
            sourceSurface,
            status,
          });

          if (commandOptions.json) {
            console.log(JSON.stringify(summary, null, 2));
          } else {
            console.log(formatFailureListCommandSummary(summary));
          }

          process.exitCode = 0;
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      },
    );

  failuresCommand
    .command('summary')
    .description('Regenerate the JSON and Markdown failure summary artifacts')
    .option('--json', 'Emit the summary result as JSON')
    .action(async (commandOptions: { json?: boolean }) => {
      try {
        const summary = await generateFailureSummary({
          cwd: process.cwd(),
        });

        if (commandOptions.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(formatFailureSummaryCommandSummary(summary));
        }

        process.exitCode = 0;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  const benchmarkCommand = program
    .command('benchmark')
    .description('Run, compare, and inspect benchmark suites');

  benchmarkCommand
    .command('run')
    .description('Run a benchmark suite or case')
    .argument('<target>', 'Benchmark suite or case identifier')
    .option('--ci-safe', 'Force deterministic CI-safe execution mode')
    .option('--json', 'Emit the benchmark summary as JSON')
    .action(async (target: string, commandOptions: { ciSafe?: boolean; json?: boolean }) => {
      try {
        const summary = await runBenchmarkTargetId(target, {
          ciSafe: commandOptions.ciSafe,
          cwd: process.cwd(),
        });

        if (commandOptions.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(formatBenchmarkCommandSummary(summary));
        }

        process.exitCode = summary.exitCode;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  benchmarkCommand
    .command('compare')
    .description('Compare a benchmark run against another run or the configured baseline')
    .argument('<lhs>', 'Left-hand benchmark run identifier')
    .argument('[rhs]', 'Right-hand benchmark run identifier or snapshot path')
    .option('--against-baseline', 'Compare the benchmark run against the suite baseline artifact')
    .option('--json', 'Emit the comparison summary as JSON')
    .action(
      async (
        lhs: string,
        rhs: string | undefined,
        commandOptions: {
          againstBaseline?: boolean;
          json?: boolean;
        },
      ) => {
        try {
          const summary = await compareBenchmarkRunId(lhs, {
            againstBaseline: commandOptions.againstBaseline,
            cwd: process.cwd(),
            rhs,
          });

          if (commandOptions.json) {
            console.log(JSON.stringify(summary, null, 2));
          } else {
            console.log(formatBenchmarkCommandSummary(summary));
          }

          process.exitCode = summary.exitCode;
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      },
    );

  benchmarkCommand
    .command('show')
    .description('Inspect a persisted benchmark run')
    .argument('<run-id>', 'Benchmark run identifier')
    .option('--json', 'Emit the benchmark summary as JSON')
    .action(async (runId: string, commandOptions: { json?: boolean }) => {
      try {
        const summary = await showBenchmarkRunId(runId, {
          cwd: process.cwd(),
        });

        if (commandOptions.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(formatBenchmarkCommandSummary(summary));
        }

        process.exitCode = summary.exitCode;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  const prCommand = program.command('pr').description('Draft PR delivery commands');

  prCommand
    .command('create')
    .description('Create a GitHub draft pull request from a verified run')
    .argument('<run-id>', 'Run identifier')
    .option('--branch <branch-name>', 'Explicit branch name to use or create')
    .option('--base-branch <base-branch>', 'Explicit base branch for the draft PR')
    .option('--json', 'Emit the PR summary as JSON')
    .action(
      async (
        runId: string,
        commandOptions: {
          baseBranch?: string;
          branch?: string;
          json?: boolean;
        },
      ) => {
        try {
          const summary = await createDraftPrForRun(runId, {
            baseBranch: commandOptions.baseBranch,
            branchName: commandOptions.branch,
            cwd: process.cwd(),
          });

          if (commandOptions.json) {
            console.log(JSON.stringify(summary, null, 2));
          } else {
            console.log(formatGithubCommandSummary(summary));
          }

          process.exitCode = summary.status === 'blocked' ? 1 : 0;
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      },
    );

  prCommand
    .command('sync-packet')
    .description('Update the draft PR body and supplemental comment from the current review packet')
    .argument('<run-id>', 'Run identifier')
    .option(
      '--comment-id <comment-id>',
      'Update an existing supplemental comment instead of creating a new one',
    )
    .option('--json', 'Emit the PR sync summary as JSON')
    .action(
      async (
        runId: string,
        commandOptions: {
          commentId?: string;
          json?: boolean;
        },
      ) => {
        try {
          const summary = await syncPullRequestPacket(runId, {
            commentId: commandOptions.commentId
              ? Number.parseInt(commandOptions.commentId, 10)
              : undefined,
            cwd: process.cwd(),
          });

          if (commandOptions.json) {
            console.log(JSON.stringify(summary, null, 2));
          } else {
            console.log(formatGithubCommandSummary(summary));
          }

          process.exitCode = summary.status === 'blocked' ? 1 : 0;
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      },
    );

  prCommand
    .command('comments')
    .description('Fetch PR comments and detect explicit iteration requests')
    .argument('<run-id>', 'Run identifier')
    .option('--json', 'Emit the PR comments summary as JSON')
    .action(async (runId: string, commandOptions: { json?: boolean }) => {
      try {
        const summary = await syncPullRequestComments(runId, {
          cwd: process.cwd(),
        });

        if (commandOptions.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(formatGithubCommandSummary(summary));
        }

        process.exitCode = summary.status === 'blocked' ? 1 : 0;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  prCommand
    .command('iterate')
    .description(
      'Materialize a follow-up governed-run input from the latest explicit PR iteration request',
    )
    .argument('<run-id>', 'Run identifier')
    .option('--json', 'Emit the iteration summary as JSON')
    .action(async (runId: string, commandOptions: { json?: boolean }) => {
      try {
        const summary = await materializeIterationRequest(runId, {
          cwd: process.cwd(),
        });

        if (commandOptions.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(formatGithubCommandSummary(summary));
        }

        process.exitCode = summary.status === 'blocked' ? 1 : 0;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  const githubCommand = program.command('github').description('GitHub integration commands');

  githubCommand
    .command('draft-pr')
    .description('Alias for "gdh pr create"')
    .argument('<run-id>', 'Run identifier')
    .option('--branch <branch-name>', 'Explicit branch name to use or create')
    .option('--base-branch <base-branch>', 'Explicit base branch for the draft PR')
    .option('--json', 'Emit the PR summary as JSON')
    .action(
      async (
        runId: string,
        commandOptions: {
          baseBranch?: string;
          branch?: string;
          json?: boolean;
        },
      ) => {
        try {
          const summary = await createDraftPrForRun(runId, {
            baseBranch: commandOptions.baseBranch,
            branchName: commandOptions.branch,
            cwd: process.cwd(),
          });

          if (commandOptions.json) {
            console.log(JSON.stringify(summary, null, 2));
          } else {
            console.log(formatGithubCommandSummary(summary));
          }

          process.exitCode = summary.status === 'blocked' ? 1 : 0;
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      },
    );

  githubCommand
    .command('comments')
    .description('Alias for "gdh pr comments"')
    .argument('<run-id>', 'Run identifier')
    .option('--json', 'Emit the PR comments summary as JSON')
    .action(async (runId: string, commandOptions: { json?: boolean }) => {
      try {
        const summary = await syncPullRequestComments(runId, {
          cwd: process.cwd(),
        });

        if (commandOptions.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(formatGithubCommandSummary(summary));
        }

        process.exitCode = summary.status === 'blocked' ? 1 : 0;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
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
