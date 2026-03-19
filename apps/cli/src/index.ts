import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
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
  createGithubIterationRequestRecord,
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
  type GithubCommentRef,
  GithubCommentRefSchema,
  GithubDraftPrRequestSchema,
  GithubDraftPrResultSchema,
  type GithubIssueRef,
  type GithubIterationRequest,
  type GithubPullRequestRef,
  ImpactPreviewSchema,
  type IssueIngestionResult,
  IssueIngestionResultSchema,
  normalizeGithubIssueSpec,
  normalizeMarkdownSpec,
  PlanSchema,
  PolicyAuditResultSchema,
  type PolicyDecision,
  PolicyEvaluationSchema,
  type ResumeEligibility,
  type ReviewPacket,
  ReviewPacketSchema,
  type Run,
  type RunCheckpoint,
  RunCheckpointSchema,
  type RunEventType,
  type RunGithubState,
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
  updateRunGithubState,
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
  type BenchmarkCaseExecutionInput,
  type BenchmarkCaseExecutionSummary,
  compareBenchmarkRunArtifacts,
  loadBenchmarkRun,
  runBenchmarkTarget,
} from '@gdh/evals';
import {
  createGithubAdapter,
  type GithubAdapter,
  type GithubConfig,
  loadGithubConfig,
  parseGithubIssueReference,
  requireGithubToken,
} from '@gdh/github-adapter';
import {
  createApprovalPacket,
  createApprovalResolutionRecord,
  createPolicyAudit,
  evaluatePolicy,
  generateImpactPreview,
  loadPolicyPackFromFile,
  renderApprovalPacketMarkdown,
} from '@gdh/policy-engine';
import {
  createReviewPacket,
  renderDraftPullRequestBody,
  renderDraftPullRequestComment,
  renderReviewPacketMarkdown,
} from '@gdh/review-packets';
import {
  createCodexCliRunner,
  createFakeRunner,
  defaultRunnerDefaults,
  type Runner,
} from '@gdh/runner-codex';
import { createIsoTimestamp, createRunId, findRepoRoot, slugify } from '@gdh/shared';
import {
  describeVerificationScope,
  loadVerificationConfig,
  runVerification,
} from '@gdh/verification';
import { Command } from 'commander';

const execFileAsync = promisify(execFile);
const supportedRunnerValues = ['codex-cli', 'fake'] as const;
const supportedApprovalModeValues = ['interactive', 'fail'] as const;

export interface RunCommandOptions {
  approvalMode?: ApprovalMode;
  approvalResolver?: ApprovalResolver;
  cwd?: string;
  githubAdapter?: GithubAdapter;
  githubConfig?: GithubConfig;
  githubIssue?: string;
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

export interface GithubCommandOptions {
  baseBranch?: string;
  branchName?: string;
  commentId?: number;
  cwd?: string;
  githubAdapter?: GithubAdapter;
  githubConfig?: GithubConfig;
}

export interface GithubCommandSummary {
  artifactsDirectory: string;
  branchName?: string;
  commentCount?: number;
  iterationInputPath?: string;
  iterationRequestCount?: number;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  runId: string;
  status: 'blocked' | 'created' | 'inspected' | 'synced';
  summary: string;
}

export interface BenchmarkCommandSummary {
  artifactsDirectory: string;
  baselineLabel?: string;
  benchmarkRunId: string;
  caseCount: number;
  comparisonReportPath?: string;
  exitCode: number;
  passedCaseCount: number;
  regressionResultPath?: string;
  regressionStatus?: 'passed' | 'failed';
  score: number;
  status: 'completed' | 'failed';
  suiteId?: string;
  summary: string;
  targetId: string;
  targetKind: 'case' | 'suite';
}

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

const gitHeadChangedContinuityReason = 'Git HEAD changed since the last durable workspace snapshot.';

async function execGit(
  repoRoot: string,
  args: string[],
): Promise<{ stderr: string; stdout: string }> {
  try {
    const result = await execFileAsync('git', args, {
      cwd: repoRoot,
      maxBuffer: 20 * 1024 * 1024,
      encoding: 'utf8',
    });

    return {
      stderr: result.stderr ?? '',
      stdout: result.stdout ?? '',
    };
  } catch (error) {
    const failure = error as Error & {
      code?: number;
      stderr?: string;
      stdout?: string;
    };
    const command = ['git', ...args].join(' ');
    const details =
      [failure.stderr, failure.stdout, failure.message].filter(Boolean).join('\n').trim() ||
      'Git command failed.';

    throw new Error(`${command} failed: ${details}`);
  }
}

function parseGitStatusPath(line: string): string | undefined {
  if (!line.trim()) {
    return undefined;
  }

  const pathPortion = line.slice(3).trim();

  if (!pathPortion) {
    return undefined;
  }

  return pathPortion.includes(' -> ') ? pathPortion.split(' -> ').at(-1)?.trim() : pathPortion;
}

async function listDirtyWorkingTreePaths(repoRoot: string): Promise<string[]> {
  const { stdout } = await execGit(repoRoot, ['status', '--short', '--untracked-files=all']);

  return stdout
    .split(/\r?\n/)
    .map(parseGitStatusPath)
    .filter((value): value is string => Boolean(value));
}

async function currentBranchName(repoRoot: string): Promise<string> {
  const { stdout } = await execGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return stdout.trim();
}

async function localBranchExists(repoRoot: string, branchName: string): Promise<boolean> {
  try {
    await execGit(repoRoot, ['rev-parse', '--verify', `refs/heads/${branchName}`]);
    return true;
  } catch {
    return false;
  }
}

async function checkoutBranch(
  repoRoot: string,
  branchName: string,
  create: boolean,
): Promise<void> {
  await execGit(repoRoot, create ? ['checkout', '-b', branchName] : ['checkout', branchName]);
}

async function stagePaths(repoRoot: string, paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }

  await execGit(repoRoot, ['add', '--', ...paths]);
}

async function hasStagedChanges(repoRoot: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['diff', '--cached', '--quiet', '--exit-code'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    });
    return false;
  } catch (error) {
    const failure = error as Error & { code?: number };

    if (failure.code === 1) {
      return true;
    }

    throw error;
  }
}

async function commitStagedChanges(repoRoot: string, message: string): Promise<void> {
  await execGit(repoRoot, [
    '-c',
    'user.name=GDH',
    '-c',
    'user.email=gdh@example.invalid',
    'commit',
    '-m',
    message,
  ]);
}

async function pushBranchToOrigin(repoRoot: string, branchName: string): Promise<void> {
  await execGit(repoRoot, ['push', '--set-upstream', 'origin', branchName]);
}

async function readOriginRemoteUrl(repoRoot: string): Promise<string> {
  const { stdout } = await execGit(repoRoot, ['remote', 'get-url', 'origin']);
  return stdout.trim();
}

function parseGithubRemoteUrl(value: string): { owner: string; repo: string } | undefined {
  const trimmed = value.trim();
  const httpsMatch =
    /^https:\/\/github\.com\/(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(
      trimmed,
    );

  if (httpsMatch?.groups) {
    const owner = httpsMatch.groups.owner;
    const repo = httpsMatch.groups.repo;

    if (!owner || !repo) {
      return undefined;
    }

    return {
      owner,
      repo,
    };
  }

  const sshMatch =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(
      trimmed,
    );

  if (sshMatch?.groups) {
    const owner = sshMatch.groups.owner;
    const repo = sshMatch.groups.repo;

    if (!owner || !repo) {
      return undefined;
    }

    return {
      owner,
      repo,
    };
  }

  return undefined;
}

async function resolveGithubClient(
  repoRoot: string,
  options: {
    githubAdapter?: GithubAdapter;
    githubConfig?: GithubConfig;
  },
): Promise<{ adapter: GithubAdapter; config: GithubConfig }> {
  const config = options.githubConfig ?? (await loadGithubConfig(repoRoot));

  if (options.githubAdapter) {
    return {
      adapter: options.githubAdapter,
      config,
    };
  }

  return {
    adapter: createGithubAdapter({
      apiUrl: config.apiUrl,
      token: requireGithubToken(config),
    }),
    config,
  };
}

function renderGithubIssueSourceMarkdown(issue: GithubIssueRef): string {
  return [
    `# ${issue.title}`,
    '',
    `- Source: ${issue.url}`,
    `- Issue: ${issue.repo.fullName}#${issue.issueNumber}`,
    `- Labels: ${issue.labels.length > 0 ? issue.labels.join(', ') : 'none'}`,
    '',
    '## Objective',
    issue.title,
    '',
    '## Source Issue Body',
    issue.body.trim() || 'No issue body was provided on GitHub.',
  ].join('\n');
}

function deriveBranchName(run: Run, specTitle: string, issue?: GithubIssueRef): string {
  const titleSlug = slugify(specTitle).slice(0, 32);

  if (issue) {
    return `gdh/issue-${issue.issueNumber}-${titleSlug}`;
  }

  return `gdh/run-${titleSlug}-${run.id.slice(-6)}`;
}

function createCommitMessage(specTitle: string, issue?: GithubIssueRef): string {
  return issue ? `gdh: ${specTitle} (#${issue.issueNumber})` : `gdh: ${specTitle}`;
}

function createDraftPrTitle(specTitle: string, issue?: GithubIssueRef): string {
  return issue ? `${specTitle} (#${issue.issueNumber})` : specTitle;
}

function updateGithubState(
  github: RunGithubState | undefined,
  patch: Partial<RunGithubState>,
): RunGithubState {
  const iterationRequestPaths = patch.iterationRequestPaths ?? github?.iterationRequestPaths ?? [];

  return {
    updatedAt: createIsoTimestamp(),
    ...github,
    ...patch,
    iterationRequestPaths,
  };
}

async function emitGithubFailureEvent(
  artifactStore: ReturnType<typeof createArtifactStore>,
  runId: string,
  operation: string,
  error: unknown,
): Promise<void> {
  await artifactStore.appendEvent(
    createRunEvent(runId, 'github.sync.failed', {
      error: error instanceof Error ? error.message : String(error),
      operation,
    }),
  );
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

async function persistGithubState(
  artifactStore: ReturnType<typeof createArtifactStore>,
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

async function loadReviewPacket(repoRoot: string, runId: string): Promise<ReviewPacket> {
  const runDirectory = resolveRunDirectory(repoRoot, runId);

  return readJsonArtifact(
    resolve(runDirectory, 'review-packet.json'),
    ReviewPacketSchema,
    'review packet',
  );
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

function formatGithubCommandSummary(summary: GithubCommandSummary): string {
  return [
    `GitHub ${summary.status}: ${summary.runId}`,
    `Summary: ${summary.summary}`,
    summary.branchName ? `Branch: ${summary.branchName}` : 'Branch: none',
    summary.pullRequestNumber
      ? `Draft PR: #${summary.pullRequestNumber} (${summary.pullRequestUrl ?? 'no URL recorded'})`
      : 'Draft PR: none',
    summary.commentCount !== undefined ? `Comments fetched: ${summary.commentCount}` : null,
    summary.iterationRequestCount !== undefined
      ? `Iteration requests: ${summary.iterationRequestCount}`
      : null,
    summary.iterationInputPath
      ? `Iteration input: ${summary.iterationInputPath}`
      : 'Iteration input: none',
    `Artifacts: ${summary.artifactsDirectory}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function formatBenchmarkCommandSummary(summary: BenchmarkCommandSummary): string {
  return [
    `Benchmark ${summary.status}: ${summary.benchmarkRunId}`,
    `Target: ${summary.targetKind} ${summary.targetId}`,
    summary.suiteId ? `Suite: ${summary.suiteId}` : 'Suite: none',
    `Summary: ${summary.summary}`,
    `Score: ${summary.score.toFixed(2)}`,
    `Cases passed: ${summary.passedCaseCount}/${summary.caseCount}`,
    summary.baselineLabel ? `Baseline: ${summary.baselineLabel}` : 'Baseline: none',
    summary.regressionStatus
      ? `Regression status: ${summary.regressionStatus}`
      : 'Regression status: not_compared',
    summary.comparisonReportPath
      ? `Comparison report: ${summary.comparisonReportPath}`
      : 'Comparison report: none',
    summary.regressionResultPath
      ? `Regression result: ${summary.regressionResultPath}`
      : 'Regression result: none',
    `Artifacts: ${summary.artifactsDirectory}`,
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
  specFile: string | undefined,
  options: RunCommandOptions = {},
): Promise<RunCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const runnerKind = options.runner ?? 'codex-cli';
  const approvalMode = options.approvalMode ?? defaultApprovalMode();

  assertSupportedRunner(runnerKind);
  assertSupportedApprovalMode(approvalMode);

  const repoRoot = await findRepoRoot(cwd);
  const absolutePolicyPath = resolve(
    cwd,
    options.policyPath ?? resolve(repoRoot, 'policies/default.policy.yaml'),
  );

  await assertReadableFile(absolutePolicyPath);

  if ((!specFile && !options.githubIssue) || (specFile && options.githubIssue)) {
    throw new Error(
      'Provide exactly one run source: a local <spec-file> or --github-issue <owner/repo#123>.',
    );
  }

  let artifactStore: ReturnType<typeof createArtifactStore>;
  let githubIssue: GithubIssueRef | undefined;
  let githubState: RunGithubState | undefined;
  let issueIngestionResult: IssueIngestionResult | undefined;
  let normalizedSpec: ReturnType<typeof SpecSchema.parse>;
  let plan: ReturnType<typeof PlanSchema.parse>;
  let runId: string;

  if (options.githubIssue) {
    const { adapter } = await resolveGithubClient(repoRoot, {
      githubAdapter: options.githubAdapter,
      githubConfig: options.githubConfig,
    });
    const ingestedIssue = await adapter.fetchIssue(parseGithubIssueReference(options.githubIssue));

    githubIssue = ingestedIssue;
    runId = createRunId(ingestedIssue.title);
    artifactStore = createArtifactStore({
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
    if (!specFile) {
      throw new Error('A local spec file is required when --github-issue is not provided.');
    }

    const absoluteSpecPath = resolve(cwd, specFile);

    await assertReadableFile(absoluteSpecPath);

    const sourceContent = await readFile(absoluteSpecPath, 'utf8');

    normalizedSpec = normalizeMarkdownSpec({
      content: sourceContent,
      repoRoot,
      sourcePath: absoluteSpecPath,
    });
    plan = createPlanFromSpec(normalizedSpec);
    runId = createRunId(normalizedSpec.title);
    artifactStore = createArtifactStore({
      repoRoot,
      runId,
    });
  }

  const { pack: policyPack, path: loadedPolicyPath } =
    await loadPolicyPackFromFile(absolutePolicyPath);
  const verificationConfig = await loadVerificationConfig(repoRoot);

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
    github: githubState,
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
    github: githubState,
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

  if (githubIssue && issueIngestionResult) {
    const githubSourceArtifact = await artifactStore.writeTextArtifact(
      'github-issue-source',
      'github/issue.source.md',
      renderGithubIssueSourceMarkdown(githubIssue),
      'markdown',
      'Materialized GitHub issue snapshot used as the durable run source.',
    );
    const issueIngestionArtifact = await artifactStore.writeJsonArtifact(
      'github-issue-ingestion',
      'github/issue.ingestion.json',
      issueIngestionResult,
      'Normalized GitHub issue ingestion result for this governed run.',
    );

    githubState = updateGithubState(githubState, {
      issue: githubIssue,
      issueIngestionPath: issueIngestionArtifact.path,
    });
    ({ manifest, run } = await persistGithubState(artifactStore, run, manifest, githubState));
    manifest = updateSessionManifestRecord(manifest, {
      artifactPaths: {
        ...manifest.artifactPaths,
        githubIssueSource: githubSourceArtifact.path,
        githubIssueIngestion: issueIngestionArtifact.path,
      },
    });
    await persistSessionManifest(artifactStore, manifest);
    await emitEvent('github.issue.ingested', {
      artifactPaths: [githubSourceArtifact.path, issueIngestionArtifact.path],
      issueNumber: githubIssue.issueNumber,
      repository: githubIssue.repo.fullName,
      url: githubIssue.url,
    });
  }

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
      githubState: run.github,
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

async function executeBenchmarkCaseThroughCli(
  input: BenchmarkCaseExecutionInput,
): Promise<BenchmarkCaseExecutionSummary> {
  if (input.runner !== 'fake' && input.runner !== 'codex-cli') {
    throw new Error(
      `Benchmark execution does not support runner "${input.runner}" through the current CLI adapter.`,
    );
  }

  const summary = await runSpecFile(input.specPath, {
    approvalMode: input.approvalMode,
    cwd: input.cwd,
    policyPath: input.policyPath,
    runner: input.runner,
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
      if (run.github?.issue) {
        spec = normalizeGithubIssueSpec({
          issue: run.github.issue,
          repoRoot,
          sourcePath: run.sourceSpecPath,
        });
      } else {
        const sourceContent = await readFile(run.sourceSpecPath, 'utf8');
        spec = normalizeMarkdownSpec({
          content: sourceContent,
          repoRoot,
          sourcePath: run.sourceSpecPath,
        });
      }
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

      const approvalResolutionArtifact = resolve(run.runDirectory, 'approval-resolution.json');

      if (!approvalResolution) {
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
      }

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

      run = updateRunStatus(
        run,
        'in_progress',
        'Approval granted; write-capable execution may proceed.',
      );
      run = updateRunStage(run, {
        currentStage: 'approval_resolved',
        lastSuccessfulStage: 'approval_resolved',
        pendingStage: 'runner_started',
        sessionId: session.id,
        summary: 'Approval granted; write-capable execution may proceed.',
      });
      await persistRunStatus(artifactStore, run);
      const approvalCheckpoint = createRunCheckpointRecord({
        runId: run.id,
        sessionId: session.id,
        stage: 'approval_resolved',
        status: 'in_progress',
        requiredArtifactPaths: [
          resolve(run.runDirectory, 'approval-packet.json'),
          resolve(run.runDirectory, 'approval-packet.md'),
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
        approvedScope: policyDecision?.affectedPaths ?? [],
        verificationState: 'not_run',
        artifactPaths: [approvalResolutionArtifact, approvalCheckpointArtifact.path],
        nextRecommendedStep: 'Start the write-capable runner.',
        summary: 'Approval granted; execution may proceed.',
      });
      const approvalProgressArtifacts = await persistProgressSnapshot(
        artifactStore,
        approvalProgress,
      );
      await persistRunSession(
        artifactStore,
        updateRunSessionRecord(session, {
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
        }),
      );
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
            resolve(run.runDirectory, 'approval-packet.json'),
            resolve(run.runDirectory, 'approval-packet.md'),
            approvalResolutionArtifact,
          ],
        },
        pendingActions: [],
        lastCheckpointId: approvalCheckpoint.id,
        lastProgressSnapshotId: approvalProgress.id,
        artifactPaths: {
          ...manifest.artifactPaths,
          approvalResolution: approvalResolutionArtifact,
          lastCheckpoint: approvalCheckpointArtifact.path,
          progressLatest: approvalProgressArtifacts.latest.path,
        },
        summary: 'Approval granted; execution may proceed.',
      });
      await persistSessionManifest(artifactStore, manifest);
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

interface DraftPrEligibilityDecision {
  eligible: boolean;
  reasons: string[];
  summary: string;
}

async function isGitAncestorCommit(
  repoRoot: string,
  ancestorCommit: string,
  descendantCommit: string,
): Promise<boolean> {
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', ancestorCommit, descendantCommit], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    });
    return true;
  } catch (error) {
    const failure = error as Error & { code?: number; stderr?: string; stdout?: string };

    if (failure.code === 1) {
      return false;
    }

    const details =
      [failure.stderr, failure.stdout, failure.message].filter(Boolean).join('\n').trim() ||
      'Git command failed.';
    throw new Error(`git merge-base --is-ancestor failed: ${details}`);
  }
}

async function listIgnoredDraftPrContinuityReasons(input: {
  continuity: ReturnType<typeof createContinuityAssessmentRecord>;
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
  continuity: ReturnType<typeof createContinuityAssessmentRecord>;
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
    reasons.push(
      ...input.continuity.reasons.filter((reason) => !ignoredReasons.has(reason)),
    );
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

  const { stdout: shaStdout } = await execGit(input.repoRoot, ['rev-parse', 'HEAD']);
  const branch = {
    repo: input.repo,
    name: input.branchName,
    ref: `refs/heads/${input.branchName}`,
    sha: shaStdout.trim(),
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
  let inspection: Awaited<ReturnType<typeof prepareRunInspection>> | undefined;

  try {
    inspection = await prepareRunInspection(runId, repoRoot);
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
  let inspection: Awaited<ReturnType<typeof prepareRunInspection>> | undefined;

  try {
    inspection = await prepareRunInspection(runId, repoRoot);
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
  let inspection: Awaited<ReturnType<typeof prepareRunInspection>> | undefined;

  try {
    inspection = await prepareRunInspection(runId, repoRoot);
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
  let inspection: Awaited<ReturnType<typeof prepareRunInspection>> | undefined;

  try {
    const commentsSummary = await syncPullRequestComments(runId, options);
    inspection = await prepareRunInspection(runId, repoRoot);
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
