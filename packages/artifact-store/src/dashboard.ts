import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import type {
  ApprovalQueueItemView,
  ArtifactLinkView,
  BenchmarkDetailView,
  BenchmarkSummaryView,
  DashboardOverviewView,
  FailureBucketKind,
  FailureTaxonomyItemView,
  FailureTaxonomyView,
  RunDetailView,
  RunListItemView,
} from '@gdh/domain';
import {
  AnalyticsSummaryViewSchema,
  ApprovalQueueItemViewSchema,
  ApprovalSummaryViewSchema,
  ArtifactLinkViewSchema,
  approvalModeValues,
  approvalStateValues,
  artifactLinkFormatValues,
  BaselineRefSchema,
  BenchmarkDetailViewSchema,
  BenchmarkRunSchema,
  BenchmarkSummaryViewSchema,
  benchmarkExecutionModeValues,
  benchmarkRunStatusValues,
  benchmarkTargetKindValues,
  ComparisonReportSchema,
  DashboardOverviewViewSchema,
  FailureTaxonomyViewSchema,
  failureBucketKindValues,
  GithubSummaryViewSchema,
  githubSummaryStateValues,
  policyDecisionValues,
  RegressionResultSchema,
  RunDetailViewSchema,
  RunListItemViewSchema,
  runStageValues,
  runStatusValues,
  SpecSourceSchema,
  ThresholdPolicySchema,
  TimelineEventViewSchema,
  taskClassValues,
  VerificationSummaryViewSchema,
  verificationStatusValues,
} from '@gdh/domain';
import { createIsoTimestamp } from '@gdh/shared';

type JsonRecord = Record<string, unknown>;

const runStatusSet = new Set(runStatusValues);
const runStageSet = new Set(runStageValues);
const taskClassSet = new Set(taskClassValues);
const approvalStateSet = new Set(approvalStateValues);
const approvalModeSet = new Set(approvalModeValues);
const verificationStatusSet = new Set(verificationStatusValues);
const policyDecisionSet = new Set(policyDecisionValues);
const benchmarkRunStatusSet = new Set(benchmarkRunStatusValues);
const benchmarkExecutionModeSet = new Set(benchmarkExecutionModeValues);
const benchmarkTargetKindSet = new Set(benchmarkTargetKindValues);
const githubSummaryStateSet = new Set(githubSummaryStateValues);
const artifactLinkFormatSet = new Set(artifactLinkFormatValues);

export interface DashboardQueryOptions {
  repoRoot: string;
  runsRoot?: string;
  benchmarkRunsRoot?: string;
  artifactBaseUrl?: string;
}

export interface RunListQueryOptions {
  status?: string;
  sort?: 'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc';
}

export interface ArtifactContentResult {
  content: string;
  format: string;
  path: string;
}

export interface DashboardQueryService {
  getOverview(): Promise<DashboardOverviewView>;
  listRuns(options?: RunListQueryOptions): Promise<RunListItemView[]>;
  getRunDetail(runId: string): Promise<RunDetailView | null>;
  listApprovals(): Promise<ApprovalQueueItemView[]>;
  listBenchmarks(): Promise<BenchmarkSummaryView[]>;
  getBenchmarkDetail(benchmarkRunId: string): Promise<BenchmarkDetailView | null>;
  getFailureTaxonomy(): Promise<FailureTaxonomyView>;
  readArtifactContent(path: string): Promise<ArtifactContentResult | null>;
}

interface DashboardContext {
  artifactBaseUrl: string;
  benchmarkRunsRoot: string;
  repoRoot: string;
  runsRoot: string;
}

interface RunSnapshot {
  approvalQueueItem: ApprovalQueueItemView | null;
  detail: RunDetailView;
  failureItems: Array<{ item: FailureTaxonomyItemView; kind: FailureBucketKind }>;
  listItem: RunListItemView;
}

interface BenchmarkSnapshot {
  detail: BenchmarkDetailView;
  failureItems: Array<{ item: FailureTaxonomyItemView; kind: FailureBucketKind }>;
  summary: BenchmarkSummaryView;
}

interface DashboardState {
  approvals: ApprovalQueueItemView[];
  analytics: ReturnType<typeof AnalyticsSummaryViewSchema.parse>;
  benchmarkSnapshots: BenchmarkSnapshot[];
  failures: FailureTaxonomyView;
  runSnapshots: RunSnapshot[];
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll('\\', '/');
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asRecordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(asRecord).filter((entry): entry is JsonRecord => Boolean(entry));
}

function getString(record: JsonRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumber(record: JsonRecord | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' ? value : undefined;
}

function getBoolean(record: JsonRecord | undefined, key: string): boolean | undefined {
  const value = record?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

function getStringArray(record: JsonRecord | undefined, key: string): string[] {
  const value = record?.[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function getRecord(record: JsonRecord | undefined, key: string): JsonRecord | undefined {
  return asRecord(record?.[key]);
}

function getFirstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0);
}

function normalizeEnumValue<T extends string>(
  value: string | undefined,
  allowedValues: Set<T>,
  fallback: T,
): T {
  return value && allowedValues.has(value as T) ? (value as T) : fallback;
}

function optionalEnumValue<T extends string>(
  value: string | undefined,
  allowedValues: Set<T>,
): T | undefined {
  return value && allowedValues.has(value as T) ? (value as T) : undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

async function readJsonLinesFile(path: string): Promise<JsonRecord[]> {
  try {
    const contents = await readFile(path, 'utf8');

    return contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return asRecord(JSON.parse(line));
        } catch {
          return undefined;
        }
      })
      .filter((entry): entry is JsonRecord => Boolean(entry));
  } catch {
    return [];
  }
}

async function listDirectories(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(root, entry.name))
      .sort((left, right) => basename(left).localeCompare(basename(right)));
  } catch {
    return [];
  }
}

async function listFilesRecursive(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      filePaths.push(...(await listFilesRecursive(fullPath)));
      continue;
    }

    if (entry.isFile()) {
      filePaths.push(fullPath);
    }
  }

  return filePaths;
}

function inferArtifactFormat(path: string): string {
  const lowerPath = path.toLowerCase();

  if (lowerPath.endsWith('.json')) {
    return 'json';
  }

  if (lowerPath.endsWith('.jsonl')) {
    return 'jsonl';
  }

  if (lowerPath.endsWith('.md')) {
    return 'markdown';
  }

  if (lowerPath.endsWith('.patch')) {
    return 'patch';
  }

  return artifactLinkFormatSet.has('text') ? 'text' : 'unknown';
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const normalizedParent = resolve(parentPath);
  const normalizedCandidate = resolve(candidatePath);
  const relativePath = relative(normalizedParent, normalizedCandidate);

  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes(':'));
}

async function buildArtifactLink(
  context: DashboardContext,
  artifactPath: string,
  options?: {
    label?: string;
    relativeTo?: string;
    summary?: string;
  },
): Promise<ArtifactLinkView> {
  const exists = await pathExists(artifactPath);
  const relativePath = options?.relativeTo
    ? normalizeRelativePath(relative(options.relativeTo, artifactPath))
    : isPathInside(context.repoRoot, artifactPath)
      ? normalizeRelativePath(relative(context.repoRoot, artifactPath))
      : artifactPath;
  const format = normalizeEnumValue(
    exists ? inferArtifactFormat(artifactPath) : 'unknown',
    artifactLinkFormatSet,
    'unknown',
  );

  return ArtifactLinkViewSchema.parse({
    label: options?.label ?? relativePath,
    path: artifactPath,
    relativePath,
    format,
    exists,
    href:
      exists && isPathInside(context.repoRoot, artifactPath)
        ? `${context.artifactBaseUrl}${encodeURIComponent(artifactPath)}`
        : undefined,
    summary: options?.summary,
  });
}

async function buildArtifactLinksForDirectory(
  context: DashboardContext,
  directory: string,
  highlightRelativePaths: string[],
): Promise<ArtifactLinkView[]> {
  const highlights = new Map<string, ArtifactLinkView>();

  for (const relativePath of highlightRelativePaths) {
    const absolutePath = resolve(directory, relativePath);
    highlights.set(
      absolutePath,
      await buildArtifactLink(context, absolutePath, {
        label: relativePath,
        relativeTo: directory,
      }),
    );
  }

  let filePaths: string[] = [];

  try {
    filePaths = await listFilesRecursive(directory);
  } catch {
    filePaths = [];
  }

  for (const filePath of filePaths) {
    if (highlights.has(filePath)) {
      continue;
    }

    highlights.set(
      filePath,
      await buildArtifactLink(context, filePath, {
        label: normalizeRelativePath(relative(directory, filePath)),
        relativeTo: directory,
      }),
    );
  }

  const priority = [
    'review-packet.md',
    'review-packet.json',
    'approval-packet.md',
    'approval-packet.json',
    'approval-resolution.json',
    'verification.result.json',
    'policy.decision.json',
    'session.manifest.json',
    'benchmark.run.json',
    'comparison.report.json',
    'regression.result.json',
  ];

  return [...highlights.values()].sort((left, right) => {
    const leftPriority = priority.findIndex((entry) => left.label.endsWith(entry));
    const rightPriority = priority.findIndex((entry) => right.label.endsWith(entry));

    if (leftPriority !== rightPriority) {
      const normalizedLeft = leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority;
      const normalizedRight = rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority;
      return normalizedLeft - normalizedRight;
    }

    return left.label.localeCompare(right.label);
  });
}

function humanizeIdentifier(value: string): string {
  return value
    .replaceAll(/[-_./]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function deriveRunStage(events: JsonRecord[]): string | undefined {
  const lastEvent = [...events]
    .reverse()
    .find((event) => typeof getString(event, 'type') === 'string');
  const lastType = getString(lastEvent, 'type');

  switch (lastType) {
    case 'spec.normalized':
      return 'spec_normalized';
    case 'plan.created':
      return 'plan_created';
    case 'policy.evaluated':
      return 'policy_evaluated';
    case 'approval.requested':
      return 'awaiting_approval';
    case 'approval.granted':
    case 'approval.denied':
      return 'approval_resolved';
    case 'runner.started':
      return 'runner_started';
    case 'runner.completed':
      return 'runner_completed';
    case 'verification.started':
      return 'verification_started';
    case 'verification.completed':
      return 'verification_completed';
    default:
      return undefined;
  }
}

function deriveApprovalSummaryFromRecords(
  approvalPacket: JsonRecord | undefined,
  approvalResolution: JsonRecord | undefined,
  policyDecision: JsonRecord | undefined,
  sessionManifest: JsonRecord | undefined,
): {
  required: boolean;
  status: string;
  summary: string;
  policyDecision: string | undefined;
  requiredApprovalMode: string | null | undefined;
  packetId: string | undefined;
  createdAt: string | undefined;
  resolvedAt: string | undefined;
  affectedPaths: string[];
  predictedCommands: string[];
  reasons: string[];
  riskSummary: string[];
  artifactRelativePaths: string[];
} {
  const manifestApprovalState = getRecord(sessionManifest, 'approvalState');
  const manifestStatus = getString(manifestApprovalState, 'status');
  const manifestRequired = getBoolean(manifestApprovalState, 'required');
  const requiredApprovalMode = getFirstString(
    getString(policyDecision, 'requiredApprovalMode'),
    getString(getRecord(sessionManifest, 'policyDecision'), 'requiredApprovalMode'),
  );
  const decision = getString(policyDecision, 'decision');
  const required =
    manifestRequired === true ||
    Boolean(approvalPacket) ||
    decision === 'prompt' ||
    Boolean(requiredApprovalMode);
  const resolution =
    getString(approvalResolution, 'resolution') ?? getString(approvalPacket, 'resolution');
  const status = normalizeEnumValue(
    resolution ?? manifestStatus ?? (required ? 'pending' : 'not_required'),
    approvalStateSet,
    required ? 'pending' : 'not_required',
  );
  const reasons = approvalPacket
    ? getStringArray(approvalPacket, 'whyApprovalIsRequired')
    : getStringArray(policyDecision, 'notes');
  const artifactRelativePaths = [
    'approval-packet.json',
    'approval-packet.md',
    'approval-resolution.json',
  ];

  return {
    required,
    status,
    summary: required
      ? (getFirstString(
          getString(approvalPacket, 'decisionSummary'),
          getString(approvalPacket, 'summary'),
          getString(approvalResolution, 'notes'),
          getString(getRecord(sessionManifest, 'approvalState'), 'summary'),
        ) ?? `Approval status: ${status}.`)
      : 'No approval required for this run.',
    policyDecision: optionalEnumValue(decision, policyDecisionSet),
    requiredApprovalMode:
      requiredApprovalMode === null
        ? null
        : optionalEnumValue(requiredApprovalMode, approvalModeSet),
    packetId: getFirstString(
      getString(approvalPacket, 'id'),
      getString(getRecord(sessionManifest, 'approvalState'), 'approvalPacketId'),
    ),
    createdAt: getString(approvalPacket, 'createdAt'),
    resolvedAt: getFirstString(
      getString(approvalResolution, 'createdAt'),
      getString(approvalPacket, 'resolvedAt'),
    ),
    affectedPaths: approvalPacket
      ? getStringArray(approvalPacket, 'affectedPaths')
      : getStringArray(policyDecision, 'affectedPaths'),
    predictedCommands: approvalPacket
      ? getStringArray(approvalPacket, 'predictedCommands')
      : getStringArray(policyDecision, 'matchedCommands'),
    reasons,
    riskSummary: approvalPacket ? getStringArray(approvalPacket, 'riskSummary') : [],
    artifactRelativePaths,
  };
}

function deriveVerificationSummaryFromRecords(
  verificationResult: JsonRecord | undefined,
  sessionManifest: JsonRecord | undefined,
  runRecord: JsonRecord | undefined,
  reviewPacket: JsonRecord | undefined,
): {
  status: string;
  summary: string;
  lastVerifiedAt: string | undefined;
  claimStatus: string | undefined;
  packetCompletenessStatus: string | undefined;
  completionFinalStatus: string | undefined;
  commandsPassed: number;
  commandsFailed: number;
  checksPassed: number;
  checksFailed: number;
  mandatoryFailures: string[];
  artifactRelativePaths: string[];
} {
  const manifestVerificationState = getRecord(sessionManifest, 'verificationState');
  const status = normalizeEnumValue(
    getFirstString(
      getString(verificationResult, 'status'),
      getString(manifestVerificationState, 'status'),
      getString(runRecord, 'verificationStatus'),
      getString(reviewPacket, 'verificationStatus'),
    ),
    verificationStatusSet,
    'not_run',
  );
  const commands = asRecordArray(verificationResult?.commands);
  const checks = asRecordArray(verificationResult?.checks);
  const mandatoryFailures = checks
    .filter(
      (check) => getBoolean(check, 'mandatory') === true && getString(check, 'status') === 'failed',
    )
    .map(
      (check) =>
        getFirstString(getString(check, 'summary'), getString(check, 'name')) ?? 'Failed check',
    );

  return {
    status,
    summary:
      getFirstString(
        getString(verificationResult, 'summary'),
        getString(manifestVerificationState, 'summary'),
        status === 'not_run' ? 'Verification has not been run for this artifact set.' : undefined,
      ) ?? 'Verification state unavailable.',
    lastVerifiedAt: getFirstString(
      getString(verificationResult, 'createdAt'),
      getString(manifestVerificationState, 'lastVerifiedAt'),
      getString(runRecord, 'lastVerifiedAt'),
    ),
    claimStatus: getString(getRecord(verificationResult, 'claimVerification'), 'status'),
    packetCompletenessStatus: getString(
      getRecord(verificationResult, 'packetCompleteness'),
      'status',
    ),
    completionFinalStatus: getString(
      getRecord(verificationResult, 'completionDecision'),
      'finalStatus',
    ),
    commandsPassed: commands.filter((command) => getString(command, 'status') === 'passed').length,
    commandsFailed: commands.filter((command) => getString(command, 'status') === 'failed').length,
    checksPassed: checks.filter((check) => getString(check, 'status') === 'passed').length,
    checksFailed: checks.filter((check) => getString(check, 'status') === 'failed').length,
    mandatoryFailures,
    artifactRelativePaths: ['verification.result.json'],
  };
}

function deriveGithubStatus(
  runRecord: JsonRecord | undefined,
  sessionManifest: JsonRecord | undefined,
): {
  artifactRelativePaths: string[];
  branch: JsonRecord | undefined;
  issue: JsonRecord | undefined;
  lastSyncError: string | undefined;
  pullRequest: JsonRecord | undefined;
  status: string;
  summary: string;
  updatedAt: string | undefined;
} {
  const github = getRecord(runRecord, 'github') ?? getRecord(sessionManifest, 'github');
  const issue = getRecord(github, 'issue');
  const branch = getRecord(github, 'branch');
  const pullRequest = getRecord(github, 'pullRequest');
  const lastSyncError = getString(github, 'lastSyncError');

  const status = normalizeEnumValue(
    lastSyncError
      ? 'sync_failed'
      : pullRequest
        ? 'draft_pr_created'
        : getString(github, 'draftPrRequestPath')
          ? 'draft_pr_requested'
          : branch
            ? 'branch_prepared'
            : issue
              ? 'issue_ingested'
              : 'not_requested',
    githubSummaryStateSet,
    'not_requested',
  );

  return {
    status,
    summary:
      lastSyncError ??
      (pullRequest
        ? `Draft PR #${getString(pullRequest, 'pullRequestNumber') ?? 'unknown'} is recorded for this run.`
        : branch
          ? `GitHub branch ${getString(branch, 'name') ?? 'prepared'} is recorded for this run.`
          : issue
            ? `GitHub issue ${getString(issue, 'title') ?? 'linked'} is attached to this run.`
            : 'No GitHub delivery state is recorded for this run.'),
    issue,
    branch,
    pullRequest,
    updatedAt: getString(github, 'updatedAt'),
    lastSyncError,
    artifactRelativePaths: [
      'github/issue.ingestion.json',
      'github/branch-prepared.json',
      'github/draft-pr.request.json',
      'github/draft-pr.result.json',
      'github/pr-publication.json',
      'github/pr-comments.json',
    ],
  };
}

function deriveReviewPacketView(reviewPacket: JsonRecord | undefined): {
  diffSummary: string[];
  filesChanged: string[];
  limitations: string[];
  openQuestions: string[];
  overview: string;
  packetStatus: string;
  risks: string[];
  runnerSummary: string;
  artifactRelativePaths: string[];
} {
  const filesChanged = getStringArray(reviewPacket, 'filesChanged');
  const legacyChangedFiles = getStringArray(reviewPacket, 'changedFiles');

  return {
    packetStatus:
      getFirstString(getString(reviewPacket, 'packetStatus'), getString(reviewPacket, 'status')) ??
      'unavailable',
    overview:
      getFirstString(getString(reviewPacket, 'overview'), getString(reviewPacket, 'planSummary')) ??
      'Review packet not available.',
    runnerSummary:
      getFirstString(
        getString(reviewPacket, 'runnerReportedSummary'),
        getString(reviewPacket, 'runnerSummary'),
      ) ?? 'Runner summary unavailable.',
    filesChanged: filesChanged.length > 0 ? filesChanged : legacyChangedFiles,
    diffSummary: getStringArray(reviewPacket, 'diffSummary'),
    risks: getStringArray(reviewPacket, 'risks'),
    limitations: getStringArray(reviewPacket, 'limitations'),
    openQuestions: getStringArray(reviewPacket, 'openQuestions'),
    artifactRelativePaths: ['review-packet.json', 'review-packet.md'],
  };
}

function timelineTitleForEventType(type: string): string {
  switch (type) {
    case 'run.created':
      return 'Run created';
    case 'spec.normalized':
      return 'Spec normalized';
    case 'plan.created':
      return 'Plan created';
    case 'impact_preview.created':
      return 'Impact preview';
    case 'policy.evaluated':
      return 'Policy evaluated';
    case 'policy.blocked':
      return 'Policy blocked';
    case 'approval.requested':
      return 'Approval requested';
    case 'approval.granted':
      return 'Approval granted';
    case 'approval.denied':
      return 'Approval denied';
    case 'runner.started':
      return 'Runner started';
    case 'runner.completed':
      return 'Runner completed';
    case 'runner.failed':
      return 'Runner failed';
    case 'verification.started':
      return 'Verification started';
    case 'verification.completed':
      return 'Verification completed';
    case 'verification.failed':
      return 'Verification failed';
    case 'review_packet.generated':
      return 'Review packet generated';
    case 'github.issue.ingested':
      return 'GitHub issue ingested';
    case 'github.branch.prepared':
      return 'GitHub branch prepared';
    case 'github.pr.draft_created':
      return 'Draft PR created';
    case 'github.sync.failed':
      return 'GitHub sync failed';
    case 'benchmark.run.completed':
      return 'Benchmark completed';
    case 'run.completed':
      return 'Run completed';
    case 'run.failed':
      return 'Run failed';
    default:
      return humanizeIdentifier(type);
  }
}

function timelineSeverityForEventType(type: string): 'info' | 'success' | 'warning' | 'error' {
  if (type.includes('failed') || type === 'policy.blocked' || type === 'approval.denied') {
    return 'error';
  }

  if (
    type === 'run.completed' ||
    type === 'approval.granted' ||
    type === 'verification.completed' ||
    type === 'github.pr.draft_created'
  ) {
    return 'success';
  }

  if (type === 'approval.requested' || type === 'policy.evaluated' || type === 'run.interrupted') {
    return 'warning';
  }

  return 'info';
}

function timelineSummaryForEvent(event: JsonRecord): string {
  const type = getString(event, 'type') ?? 'event';
  const payload = getRecord(event, 'payload');

  switch (type) {
    case 'policy.evaluated':
      return `Policy decision: ${getString(payload, 'decision') ?? 'recorded'}.`;
    case 'policy.blocked':
      return getFirstString(getString(payload, 'summary'), getString(payload, 'decision'))
        ? `${getFirstString(getString(payload, 'summary'), getString(payload, 'decision'))}.`
        : 'Execution was blocked by policy.';
    case 'approval.requested':
      return 'The run requires human approval before it can continue.';
    case 'approval.granted':
      return 'Approval was granted and the run could continue.';
    case 'approval.denied':
      return 'Approval was denied.';
    case 'runner.completed':
    case 'runner.failed':
    case 'run.completed':
    case 'run.failed':
      return (
        getFirstString(getString(payload, 'summary'), getString(payload, 'status')) ??
        'Run state updated.'
      );
    case 'verification.completed':
    case 'verification.failed':
      return (
        getFirstString(getString(payload, 'summary'), getString(payload, 'status')) ??
        'Verification state updated.'
      );
    case 'github.sync.failed':
      return (
        getFirstString(getString(payload, 'summary'), getString(payload, 'error')) ??
        'GitHub sync failed.'
      );
    default:
      return (
        getFirstString(
          getString(payload, 'summary'),
          getString(payload, 'artifactPath'),
          getString(payload, 'status'),
        ) ?? 'Artifact-backed event recorded.'
      );
  }
}

async function deriveTimeline(
  context: DashboardContext,
  runDirectory: string,
  events: JsonRecord[],
): Promise<ReturnType<typeof TimelineEventViewSchema.parse>[]> {
  return Promise.all(
    events
      .sort((left, right) =>
        (getString(left, 'timestamp') ?? '').localeCompare(getString(right, 'timestamp') ?? ''),
      )
      .map(async (event) => {
        const payload = getRecord(event, 'payload');
        const artifactPath = getString(payload, 'artifactPath');

        return TimelineEventViewSchema.parse({
          id:
            getFirstString(getString(event, 'id'), getString(event, 'timestamp')) ??
            createIsoTimestamp(),
          timestamp: getString(event, 'timestamp') ?? createIsoTimestamp(),
          type: getString(event, 'type') ?? 'event',
          title: timelineTitleForEventType(getString(event, 'type') ?? 'event'),
          summary: timelineSummaryForEvent(event),
          severity: timelineSeverityForEventType(getString(event, 'type') ?? 'event'),
          artifactLink: artifactPath
            ? await buildArtifactLink(context, artifactPath, {
                label: normalizeRelativePath(relative(runDirectory, artifactPath)),
                relativeTo: runDirectory,
              })
            : undefined,
        });
      }),
  );
}

async function loadRunSnapshot(
  context: DashboardContext,
  runDirectory: string,
): Promise<RunSnapshot | null> {
  const runId = basename(runDirectory);
  const runRecord = asRecord(await readJsonFile(resolve(runDirectory, 'run.json')));

  if (!runRecord) {
    return null;
  }

  const specRecord = asRecord(await readJsonFile(resolve(runDirectory, 'spec.normalized.json')));
  const planRecord = asRecord(await readJsonFile(resolve(runDirectory, 'plan.json')));
  const policyDecision = asRecord(
    await readJsonFile(resolve(runDirectory, 'policy.decision.json')),
  );
  const approvalPacket = asRecord(
    await readJsonFile(resolve(runDirectory, 'approval-packet.json')),
  );
  const approvalResolution = asRecord(
    await readJsonFile(resolve(runDirectory, 'approval-resolution.json')),
  );
  const verificationResult = asRecord(
    await readJsonFile(resolve(runDirectory, 'verification.result.json')),
  );
  const reviewPacket = asRecord(await readJsonFile(resolve(runDirectory, 'review-packet.json')));
  const sessionManifest = asRecord(
    await readJsonFile(resolve(runDirectory, 'session.manifest.json')),
  );
  const events = await readJsonLinesFile(resolve(runDirectory, 'events.jsonl'));
  const runJsonStat = await stat(resolve(runDirectory, 'run.json'));
  const allArtifacts = await buildArtifactLinksForDirectory(context, runDirectory, [
    'review-packet.md',
    'review-packet.json',
    'approval-packet.md',
    'approval-packet.json',
    'approval-resolution.json',
    'verification.result.json',
    'policy.decision.json',
    'session.manifest.json',
  ]);
  const createdAt =
    getString(runRecord, 'createdAt') ??
    getString(specRecord, 'createdAt') ??
    runJsonStat.birthtime.toISOString();
  const updatedAt =
    getFirstString(getString(runRecord, 'updatedAt'), getString(sessionManifest, 'updatedAt')) ??
    runJsonStat.mtime.toISOString();
  const title =
    getFirstString(getString(specRecord, 'title'), getString(reviewPacket, 'specTitle')) ??
    humanizeIdentifier(runId);
  const objective =
    getFirstString(
      getString(specRecord, 'objective'),
      getString(specRecord, 'summary'),
      getString(reviewPacket, 'overview'),
      getString(runRecord, 'summary'),
    ) ?? 'Objective unavailable.';
  const taskClass = normalizeEnumValue(getString(specRecord, 'taskClass'), taskClassSet, 'other');
  const status = normalizeEnumValue(getString(runRecord, 'status'), runStatusSet, 'failed');
  const currentStage = optionalEnumValue(
    getFirstString(
      getString(runRecord, 'currentStage'),
      getString(sessionManifest, 'currentStage'),
      deriveRunStage(events),
    ),
    runStageSet,
  );
  const summary =
    getFirstString(
      getString(runRecord, 'summary'),
      getString(reviewPacket, 'runnerReportedSummary'),
      getString(reviewPacket, 'runnerSummary'),
      getString(reviewPacket, 'overview'),
    ) ?? 'No summary is available for this run.';
  const approvalDerived = deriveApprovalSummaryFromRecords(
    approvalPacket,
    approvalResolution,
    policyDecision,
    sessionManifest,
  );
  const verificationDerived = deriveVerificationSummaryFromRecords(
    verificationResult,
    sessionManifest,
    runRecord,
    reviewPacket,
  );
  const githubDerived = deriveGithubStatus(runRecord, sessionManifest);
  const reviewPacketDerived = deriveReviewPacketView(reviewPacket);
  const approvalArtifactLinks = await Promise.all(
    approvalDerived.artifactRelativePaths.map((relativePath) =>
      buildArtifactLink(context, resolve(runDirectory, relativePath), {
        label: relativePath,
        relativeTo: runDirectory,
      }),
    ),
  );
  const verificationArtifactLinks = await Promise.all(
    verificationDerived.artifactRelativePaths.map((relativePath) =>
      buildArtifactLink(context, resolve(runDirectory, relativePath), {
        label: relativePath,
        relativeTo: runDirectory,
      }),
    ),
  );
  const githubArtifactLinks = await Promise.all(
    githubDerived.artifactRelativePaths.map((relativePath) =>
      buildArtifactLink(context, resolve(runDirectory, relativePath), {
        label: relativePath,
        relativeTo: runDirectory,
      }),
    ),
  );
  const reviewPacketArtifactLinks = await Promise.all(
    reviewPacketDerived.artifactRelativePaths.map((relativePath) =>
      buildArtifactLink(context, resolve(runDirectory, relativePath), {
        label: relativePath,
        relativeTo: runDirectory,
      }),
    ),
  );

  const approval = ApprovalSummaryViewSchema.parse({
    required: approvalDerived.required,
    status: approvalDerived.status,
    summary: approvalDerived.summary,
    policyDecision: approvalDerived.policyDecision,
    requiredApprovalMode: approvalDerived.requiredApprovalMode,
    packetId: approvalDerived.packetId,
    createdAt: approvalDerived.createdAt,
    resolvedAt: approvalDerived.resolvedAt,
    affectedPaths: approvalDerived.affectedPaths,
    predictedCommands: approvalDerived.predictedCommands,
    reasons: approvalDerived.reasons,
    riskSummary: approvalDerived.riskSummary,
    artifactLinks: approvalArtifactLinks.filter((link) => link.exists),
  });
  const verification = VerificationSummaryViewSchema.parse({
    status: verificationDerived.status,
    summary: verificationDerived.summary,
    lastVerifiedAt: verificationDerived.lastVerifiedAt,
    claimStatus: verificationDerived.claimStatus,
    packetCompletenessStatus: verificationDerived.packetCompletenessStatus,
    completionFinalStatus: verificationDerived.completionFinalStatus,
    commandsPassed: verificationDerived.commandsPassed,
    commandsFailed: verificationDerived.commandsFailed,
    checksPassed: verificationDerived.checksPassed,
    checksFailed: verificationDerived.checksFailed,
    mandatoryFailures: verificationDerived.mandatoryFailures,
    artifactLinks: verificationArtifactLinks.filter((link) => link.exists),
  });
  const github = GithubSummaryViewSchema.parse({
    status: githubDerived.status,
    summary: githubDerived.summary,
    issue: githubDerived.issue,
    branch: githubDerived.branch,
    pullRequest: githubDerived.pullRequest,
    lastUpdatedAt: githubDerived.updatedAt,
    lastSyncError: githubDerived.lastSyncError,
    artifactLinks: githubArtifactLinks.filter((link) => link.exists),
  });
  const timeline = await deriveTimeline(context, runDirectory, events);

  const detail = RunDetailViewSchema.parse({
    id: runId,
    title,
    objective,
    summary,
    taskClass,
    status,
    currentStage,
    repoRoot: getString(runRecord, 'repoRoot') ?? context.repoRoot,
    runDirectory,
    createdAt,
    updatedAt,
    normalizedSpec: {
      source: SpecSourceSchema.catch('manual').parse(getString(specRecord, 'source') ?? 'manual'),
      sourcePath:
        getFirstString(
          getString(specRecord, 'sourcePath'),
          getString(runRecord, 'sourceSpecPath'),
        ) ?? runDirectory,
      summary: getString(specRecord, 'summary') ?? objective,
      objective,
      constraints: getStringArray(specRecord, 'constraints'),
      acceptanceCriteria: getStringArray(specRecord, 'acceptanceCriteria'),
      riskHints: getStringArray(specRecord, 'riskHints'),
      normalizationNotes: getStringArray(specRecord, 'normalizationNotes'),
      githubIssue: getRecord(specRecord, 'githubIssue'),
    },
    plan: {
      summary: getString(planRecord, 'summary') ?? 'Plan summary unavailable.',
      doneConditions: getStringArray(planRecord, 'doneConditions'),
      assumptions: getStringArray(planRecord, 'assumptions'),
      openQuestions: getStringArray(planRecord, 'openQuestions'),
      taskUnits: asRecordArray(planRecord?.taskUnits).map((taskUnit) => ({
        order: getNumber(taskUnit, 'order') ?? 0,
        title: getString(taskUnit, 'title') ?? 'Untitled task',
        description: getString(taskUnit, 'description') ?? '',
        riskLevel: optionalEnumValue(
          getString(taskUnit, 'riskLevel'),
          new Set(['low', 'medium', 'high']),
        ),
        suggestedMode: optionalEnumValue(
          getString(taskUnit, 'suggestedMode'),
          new Set(['read_only', 'workspace_write']),
        ),
        status: optionalEnumValue(
          getString(taskUnit, 'status'),
          new Set(['pending', 'running', 'blocked', 'done', 'failed']),
        ),
      })),
    },
    approval,
    verification,
    github,
    reviewPacket: {
      packetStatus: reviewPacketDerived.packetStatus,
      overview: reviewPacketDerived.overview,
      runnerSummary: reviewPacketDerived.runnerSummary,
      filesChanged: reviewPacketDerived.filesChanged,
      diffSummary: reviewPacketDerived.diffSummary,
      risks: reviewPacketDerived.risks,
      limitations: reviewPacketDerived.limitations,
      openQuestions: reviewPacketDerived.openQuestions,
      artifactLinks: reviewPacketArtifactLinks.filter((link) => link.exists),
    },
    benchmarkLinks: [],
    timeline,
    artifactLinks: allArtifacts,
  });

  const listItem = RunListItemViewSchema.parse({
    id: runId,
    title,
    objective,
    summary,
    taskClass,
    status,
    currentStage,
    repoRoot: detail.repoRoot,
    runDirectory,
    createdAt,
    updatedAt,
    approval,
    verification,
    github,
    linkedBenchmarkIds: [],
  });

  const approvalQueueItem = approval.required
    ? ApprovalQueueItemViewSchema.parse({
        runId,
        title,
        taskClass,
        status,
        createdAt,
        updatedAt,
        approval,
      })
    : null;

  const failureItems: Array<{ item: FailureTaxonomyItemView; kind: FailureBucketKind }> = [];
  const failureBase = {
    id: runId,
    title,
    timestamp: updatedAt,
    href: `/runs/${encodeURIComponent(runId)}`,
  };

  if (approval.policyDecision === 'forbid') {
    failureItems.push({
      kind: 'policy_blocked',
      item: {
        ...failureBase,
        summary: approval.summary,
        status,
      },
    });
  }

  if (approval.status === 'pending') {
    failureItems.push({
      kind: 'approval_pending',
      item: {
        ...failureBase,
        summary: approval.summary,
        status,
      },
    });
  }

  if (approval.status === 'denied') {
    failureItems.push({
      kind: 'approval_denied',
      item: {
        ...failureBase,
        summary: approval.summary,
        status,
      },
    });
  }

  if (verification.status === 'failed') {
    failureItems.push({
      kind: 'verification_failed',
      item: {
        ...failureBase,
        summary: verification.summary,
        status: verification.status,
      },
    });
  }

  if (verification.claimStatus === 'failed' || verification.packetCompletenessStatus === 'failed') {
    failureItems.push({
      kind: 'review_packet_inconsistent',
      item: {
        ...failureBase,
        summary: 'Review packet consistency checks failed verification.',
        status: verification.claimStatus ?? verification.packetCompletenessStatus ?? 'failed',
      },
    });
  }

  if (github.lastSyncError) {
    failureItems.push({
      kind: 'github_sync_failed',
      item: {
        ...failureBase,
        summary: github.lastSyncError,
        status: github.status,
      },
    });
  }

  return {
    detail,
    listItem,
    approvalQueueItem,
    failureItems,
  };
}

async function loadBenchmarkSnapshot(
  context: DashboardContext,
  benchmarkRunDirectory: string,
): Promise<BenchmarkSnapshot | null> {
  const benchmarkRunRaw = await readJsonFile(resolve(benchmarkRunDirectory, 'benchmark.run.json'));
  const benchmarkRunResult = BenchmarkRunSchema.safeParse(benchmarkRunRaw);

  if (!benchmarkRunResult.success) {
    return null;
  }

  const benchmarkRun = benchmarkRunResult.data;
  const comparisonReport = ComparisonReportSchema.safeParse(
    await readJsonFile(resolve(benchmarkRunDirectory, 'comparison.report.json')),
  );
  const regressionResult = RegressionResultSchema.safeParse(
    await readJsonFile(resolve(benchmarkRunDirectory, 'regression.result.json')),
  );
  const suiteRecord = await readJsonFile(resolve(benchmarkRunDirectory, 'benchmark.suite.json'));
  const suiteMetadata = asRecord(suiteRecord);
  const artifactLinks = await buildArtifactLinksForDirectory(context, benchmarkRunDirectory, [
    'benchmark.run.json',
    'benchmark.suite.json',
    'comparison.report.json',
    'regression.result.json',
  ]);
  const caseStatusCounts = benchmarkRun.caseResults.reduce(
    (counts, caseResult) => {
      counts.total += 1;

      if (caseResult.status === 'passed') {
        counts.passed += 1;
      } else if (caseResult.status === 'failed') {
        counts.failed += 1;
      } else {
        counts.error += 1;
      }

      return counts;
    },
    { total: 0, passed: 0, failed: 0, error: 0 },
  );
  const relatedRunIds = benchmarkRun.caseResults
    .map((caseResult) => caseResult.governedRunId)
    .filter((runId): runId is string => typeof runId === 'string' && runId.length > 0);

  const summary = BenchmarkSummaryViewSchema.parse({
    id: benchmarkRun.id,
    title:
      getFirstString(getString(suiteMetadata, 'title')) ??
      humanizeIdentifier(benchmarkRun.suiteId ?? benchmarkRun.target.id),
    suiteId: benchmarkRun.suiteId,
    targetKind: normalizeEnumValue(benchmarkRun.target.kind, benchmarkTargetKindSet, 'suite'),
    targetId: benchmarkRun.target.id,
    status: normalizeEnumValue(benchmarkRun.status, benchmarkRunStatusSet, 'failed'),
    mode: normalizeEnumValue(benchmarkRun.mode, benchmarkExecutionModeSet, 'ci_safe'),
    normalizedScore: benchmarkRun.score.normalizedScore,
    summary: benchmarkRun.summary,
    startedAt: benchmarkRun.startedAt,
    completedAt: benchmarkRun.completedAt,
    regressionStatus: regressionResult.success ? regressionResult.data.status : undefined,
    regressionSummary: regressionResult.success ? regressionResult.data.summary : undefined,
    comparisonSummary: comparisonReport.success ? comparisonReport.data.summary : undefined,
    passedCases: caseStatusCounts.passed,
    failedCases: caseStatusCounts.failed,
    errorCases: caseStatusCounts.error,
    totalCases: caseStatusCounts.total,
    relatedRunIds,
    artifactLinks,
  });

  const detail = BenchmarkDetailViewSchema.parse({
    summary,
    suiteTitle: getString(suiteMetadata, 'title'),
    suiteDescription: getString(suiteMetadata, 'description'),
    thresholdPolicy:
      (asRecord(suiteMetadata?.thresholds) ?? asRecord(benchmarkRun.configuration.thresholdPolicy))
        ? ThresholdPolicySchema.parse(
            asRecord(suiteMetadata?.thresholds) ?? benchmarkRun.configuration.thresholdPolicy,
          )
        : undefined,
    baseline:
      (asRecord(suiteMetadata?.baseline) ?? benchmarkRun.configuration.baseline)
        ? BaselineRefSchema.parse(
            asRecord(suiteMetadata?.baseline) ?? benchmarkRun.configuration.baseline,
          )
        : undefined,
    caseSummaries: benchmarkRun.caseResults.map((caseResult) => ({
      caseId: caseResult.caseId,
      title: caseResult.title,
      status: caseResult.status,
      normalizedScore: caseResult.score.normalizedScore,
      governedRunId: caseResult.governedRunId,
      governedRunPath: caseResult.governedRunPath,
      durationMs: caseResult.durationMs,
      failureReasons: caseResult.failureReasons,
    })),
  });

  const failureItems: Array<{ item: FailureTaxonomyItemView; kind: FailureBucketKind }> = [];

  if (regressionResult.success && regressionResult.data.status === 'failed') {
    failureItems.push({
      kind: 'benchmark_regression',
      item: {
        id: summary.id,
        title: summary.title,
        summary: regressionResult.data.summary,
        status: regressionResult.data.status,
        timestamp: summary.completedAt ?? summary.startedAt,
        href: `/benchmarks/${encodeURIComponent(summary.id)}`,
      },
    });
  }

  return {
    summary,
    detail,
    failureItems,
  };
}

function buildFailureTaxonomy(
  runSnapshots: RunSnapshot[],
  benchmarkSnapshots: BenchmarkSnapshot[],
): FailureTaxonomyView {
  const buckets = new Map<FailureBucketKind, FailureTaxonomyItemView[]>();

  for (const kind of failureBucketKindValues) {
    buckets.set(kind, []);
  }

  for (const runSnapshot of runSnapshots) {
    for (const failure of runSnapshot.failureItems) {
      buckets.get(failure.kind)?.push(failure.item);
    }
  }

  for (const benchmarkSnapshot of benchmarkSnapshots) {
    for (const failure of benchmarkSnapshot.failureItems) {
      buckets.get(failure.kind)?.push(failure.item);
    }
  }

  return FailureTaxonomyViewSchema.parse({
    generatedAt: createIsoTimestamp(),
    buckets: failureBucketKindValues.map((kind) => {
      const items = [...(buckets.get(kind) ?? [])].sort((left, right) =>
        right.timestamp.localeCompare(left.timestamp),
      );

      return {
        kind,
        title: humanizeIdentifier(kind),
        count: items.length,
        items,
      };
    }),
  });
}

function buildAnalytics(runSnapshots: RunSnapshot[], benchmarkSnapshots: BenchmarkSnapshot[]) {
  const runCounts = new Map<string, number>();

  for (const snapshot of runSnapshots) {
    runCounts.set(snapshot.listItem.status, (runCounts.get(snapshot.listItem.status) ?? 0) + 1);
  }

  const recentActivity = [
    ...runSnapshots.map((snapshot) => ({
      kind: 'run' as const,
      id: snapshot.listItem.id,
      title: snapshot.listItem.title,
      status: snapshot.listItem.status,
      timestamp: snapshot.listItem.updatedAt,
    })),
    ...benchmarkSnapshots.map((snapshot) => ({
      kind: 'benchmark' as const,
      id: snapshot.summary.id,
      title: snapshot.summary.title,
      status: snapshot.summary.status,
      timestamp: snapshot.summary.completedAt ?? snapshot.summary.startedAt,
    })),
  ]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 10);

  return AnalyticsSummaryViewSchema.parse({
    generatedAt: createIsoTimestamp(),
    totalRuns: runSnapshots.length,
    totalBenchmarks: benchmarkSnapshots.length,
    runCountsByStatus: [...runCounts.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([label, count]) => ({ label, count })),
    approvalRequiredRuns: runSnapshots.filter((snapshot) => snapshot.listItem.approval.required)
      .length,
    autoAllowedRuns: runSnapshots.filter((snapshot) => !snapshot.listItem.approval.required).length,
    approvalPendingRuns: runSnapshots.filter(
      (snapshot) => snapshot.listItem.approval.status === 'pending',
    ).length,
    approvalDeniedRuns: runSnapshots.filter(
      (snapshot) => snapshot.listItem.approval.status === 'denied',
    ).length,
    verificationPassedRuns: runSnapshots.filter(
      (snapshot) => snapshot.listItem.verification.status === 'passed',
    ).length,
    verificationFailedRuns: runSnapshots.filter(
      (snapshot) => snapshot.listItem.verification.status === 'failed',
    ).length,
    githubDraftPrRuns: runSnapshots.filter(
      (snapshot) => snapshot.listItem.github.status === 'draft_pr_created',
    ).length,
    benchmarkRegressionFailures: benchmarkSnapshots.filter(
      (snapshot) => snapshot.summary.regressionStatus === 'failed',
    ).length,
    recentActivity,
  });
}

async function loadDashboardState(context: DashboardContext): Promise<DashboardState> {
  const [runDirectories, benchmarkDirectories] = await Promise.all([
    listDirectories(context.runsRoot),
    listDirectories(context.benchmarkRunsRoot),
  ]);
  const runSnapshots = (
    await Promise.all(runDirectories.map((runDirectory) => loadRunSnapshot(context, runDirectory)))
  ).filter((snapshot): snapshot is RunSnapshot => Boolean(snapshot));
  const benchmarkSnapshots = (
    await Promise.all(
      benchmarkDirectories.map((benchmarkDirectory) =>
        loadBenchmarkSnapshot(context, benchmarkDirectory),
      ),
    )
  ).filter((snapshot): snapshot is BenchmarkSnapshot => Boolean(snapshot));
  const benchmarkLinksByRunId = new Map<string, BenchmarkSummaryView[]>();

  for (const benchmarkSnapshot of benchmarkSnapshots) {
    for (const runId of benchmarkSnapshot.summary.relatedRunIds) {
      const existing = benchmarkLinksByRunId.get(runId) ?? [];
      existing.push(benchmarkSnapshot.summary);
      benchmarkLinksByRunId.set(runId, existing);
    }
  }

  for (const runSnapshot of runSnapshots) {
    const benchmarkLinks = (benchmarkLinksByRunId.get(runSnapshot.listItem.id) ?? []).sort(
      (left, right) =>
        (right.completedAt ?? right.startedAt).localeCompare(left.completedAt ?? left.startedAt),
    );
    runSnapshot.listItem.linkedBenchmarkIds = benchmarkLinks.map((entry) => entry.id);
    runSnapshot.detail.benchmarkLinks = benchmarkLinks;
  }

  const approvals = runSnapshots
    .map((snapshot) => snapshot.approvalQueueItem)
    .filter((item): item is ApprovalQueueItemView => Boolean(item))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const failures = buildFailureTaxonomy(runSnapshots, benchmarkSnapshots);

  return {
    runSnapshots: runSnapshots.sort((left, right) =>
      right.listItem.updatedAt.localeCompare(left.listItem.updatedAt),
    ),
    benchmarkSnapshots: benchmarkSnapshots.sort((left, right) =>
      (right.summary.completedAt ?? right.summary.startedAt).localeCompare(
        left.summary.completedAt ?? left.summary.startedAt,
      ),
    ),
    approvals,
    failures,
    analytics: buildAnalytics(runSnapshots, benchmarkSnapshots),
  };
}

function createContext(options: DashboardQueryOptions): DashboardContext {
  const repoRoot = resolve(options.repoRoot);

  return {
    repoRoot,
    runsRoot: resolve(options.runsRoot ?? resolve(repoRoot, 'runs', 'local')),
    benchmarkRunsRoot: resolve(
      options.benchmarkRunsRoot ?? resolve(repoRoot, 'runs', 'benchmarks'),
    ),
    artifactBaseUrl: options.artifactBaseUrl ?? '/api/artifacts/content?path=',
  };
}

export function createDashboardQueryService(options: DashboardQueryOptions): DashboardQueryService {
  const context = createContext(options);

  return {
    async getOverview() {
      const state = await loadDashboardState(context);

      return DashboardOverviewViewSchema.parse({
        analytics: state.analytics,
        recentRuns: state.runSnapshots.slice(0, 5).map((snapshot) => snapshot.listItem),
        recentBenchmarks: state.benchmarkSnapshots.slice(0, 5).map((snapshot) => snapshot.summary),
        approvals: state.approvals.slice(0, 5),
        failures: state.failures,
      });
    },

    async listRuns(query = {}) {
      const state = await loadDashboardState(context);
      const statusFilter = query.status;
      const filtered = state.runSnapshots
        .map((snapshot) => snapshot.listItem)
        .filter((item) => !statusFilter || item.status === statusFilter);

      filtered.sort((left, right) => {
        switch (query.sort) {
          case 'created_asc':
            return left.createdAt.localeCompare(right.createdAt);
          case 'created_desc':
            return right.createdAt.localeCompare(left.createdAt);
          case 'updated_asc':
            return left.updatedAt.localeCompare(right.updatedAt);
          default:
            return right.updatedAt.localeCompare(left.updatedAt);
        }
      });

      return filtered.map((item) => RunListItemViewSchema.parse(item));
    },

    async getRunDetail(runId: string) {
      const state = await loadDashboardState(context);
      return state.runSnapshots.find((snapshot) => snapshot.detail.id === runId)?.detail ?? null;
    },

    async listApprovals() {
      const state = await loadDashboardState(context);
      return state.approvals.map((item) => ApprovalQueueItemViewSchema.parse(item));
    },

    async listBenchmarks() {
      const state = await loadDashboardState(context);
      return state.benchmarkSnapshots.map((snapshot) =>
        BenchmarkSummaryViewSchema.parse(snapshot.summary),
      );
    },

    async getBenchmarkDetail(benchmarkRunId: string) {
      const state = await loadDashboardState(context);

      return (
        state.benchmarkSnapshots.find((snapshot) => snapshot.detail.summary.id === benchmarkRunId)
          ?.detail ?? null
      );
    },

    async getFailureTaxonomy() {
      const state = await loadDashboardState(context);
      return FailureTaxonomyViewSchema.parse(state.failures);
    },

    async readArtifactContent(path: string) {
      const resolvedPath = resolve(path);

      if (!isPathInside(context.repoRoot, resolvedPath) || !(await pathExists(resolvedPath))) {
        return null;
      }

      return {
        path: resolvedPath,
        format: inferArtifactFormat(resolvedPath),
        content: await readFile(resolvedPath, 'utf8'),
      };
    },
  };
}
