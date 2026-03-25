import { resolve } from 'node:path';
import {
  createGithubIterationRequestRecord,
  createRunEvent,
  type GithubCommentRef,
  GithubCommentRefSchema,
  GithubDraftPrRequestSchema,
  GithubDraftPrResultSchema,
  type GithubIterationRequest,
  type GithubPullRequestRef,
  type ReviewPacket,
  type Run,
  type RunEventType,
  type RunGithubState,
  type SessionManifest,
  updateSessionManifestRecord,
} from '@gdh/domain';
import type { GithubAdapter, GithubConfig } from '@gdh/github-adapter';
import { renderDraftPullRequestBody, renderDraftPullRequestComment } from '@gdh/review-packets';
import { createIsoTimestamp, findRepoRoot } from '@gdh/shared';
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
} from '../../git.js';
import {
  createCommitMessage,
  createDraftPrTitle,
  deriveBranchName,
  resolveGithubClient,
} from '../../github.js';
import type { GithubCommandOptions, GithubCommandSummary } from '../../types.js';
import { persistGithubState, persistSessionManifest } from '../run-lifecycle/commit.js';
import { loadReviewPacket } from '../run-lifecycle/context.js';
import { gitHeadChangedContinuityReason, uniqueStrings } from '../run-lifecycle/inspection.js';
import type {
  ArtifactStore,
  LoadedDurableRunState,
  RunLifecycleInspection,
  RunLifecycleService,
} from '../run-lifecycle/types.js';
import { type GithubIssueIngestionInput, ingestGithubIssue } from './issue-ingestion.js';
import { mergeGithubState } from './state.js';

interface DraftPrEligibilityDecision {
  eligible: boolean;
  reasons: string[];
  summary: string;
}

export interface SyncContext {
  cwd: string;
  runId: string;
}

export interface GithubSyncServiceDeps {
  findRepoRootFn?: typeof findRepoRoot;
  lifecycleService?: RunLifecycleService;
  loadReviewPacketFn?: typeof loadReviewPacket;
  resolveGithubClientFn?: typeof resolveGithubClient;
}

interface SyncExecutionState {
  readonly artifactStore: ArtifactStore;
  readonly inspection: RunLifecycleInspection;
  readonly repoRoot: string;
  readonly run: Run;
  readonly manifest: SessionManifest;
  getClient(): Promise<{ adapter: GithubAdapter; config: GithubConfig }>;
  appendEvent(type: RunEventType, payload: Record<string, unknown>): Promise<unknown>;
  persistGithub(patch: Partial<RunGithubState>): Promise<RunGithubState>;
  persistManifest(input: Partial<Omit<SessionManifest, 'runId' | 'createdAt'>>): Promise<void>;
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

    if (!originRepo) {
      throw new Error(
        `Git remote origin "${remoteUrl}" is not a supported GitHub remote URL. Refusing to publish a PR for run-linked repository "${run.github.issue.repo.fullName}" until origin is verifiably aligned.`,
      );
    }

    if (`${originRepo.owner}/${originRepo.repo}` !== run.github.issue.repo.fullName) {
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
}): Promise<{
  branch: NonNullable<RunGithubState['branch']>;
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

function iterationRequestCreatedAt(comment: GithubCommentRef): string {
  return comment.createdAt ?? comment.updatedAt;
}

export class GithubSyncService {
  private readonly findRepoRootFn;
  private readonly loadReviewPacketFn;
  private readonly lifecycleService?;
  private readonly resolveGithubClientFn;

  constructor(deps: GithubSyncServiceDeps = {}) {
    this.findRepoRootFn = deps.findRepoRootFn ?? findRepoRoot;
    this.lifecycleService = deps.lifecycleService;
    this.loadReviewPacketFn = deps.loadReviewPacketFn ?? loadReviewPacket;
    this.resolveGithubClientFn = deps.resolveGithubClientFn ?? resolveGithubClient;
  }

  async createDraftPr(
    context: SyncContext,
    options: GithubCommandOptions = {},
  ): Promise<GithubCommandSummary> {
    return this.execute(context, options, 'draft_pr_create', async (execution) => {
      const reviewPacket = await this.loadReviewPacketFn(execution.repoRoot, context.runId);
      const ignoredContinuityReasons = await listIgnoredDraftPrContinuityReasons({
        continuity: execution.inspection.continuity,
        repoRoot: execution.repoRoot,
      });
      const eligibility = evaluateDraftPrEligibility({
        changedFiles: execution.inspection.state.changedFiles,
        continuity: execution.inspection.continuity,
        ignoredContinuityReasons,
        manifest: execution.manifest,
        reviewPacket,
        run: execution.run,
      });

      if (!eligibility.eligible) {
        return {
          artifactsDirectory: execution.run.runDirectory,
          runId: context.runId,
          status: 'blocked',
          summary: `${eligibility.summary} ${eligibility.reasons.join(' ')}`.trim(),
        };
      }

      const { adapter, config } = await execution.getClient();
      const repo = await resolveGithubRepoForRun(execution.repoRoot, execution.run, adapter);
      const branchName =
        options.branchName ??
        execution.run.github?.branch?.name ??
        deriveBranchName(execution.run, reviewPacket.specTitle, execution.run.github?.issue);
      const branchPreparation = await prepareBranchForRun({
        branchName,
        changedFiles: execution.inspection.state.changedFiles as NonNullable<
          LoadedDurableRunState['changedFiles']
        >,
        repo,
        repoRoot: execution.repoRoot,
      });
      const branchPreparationArtifact = await execution.artifactStore.writeJsonArtifact(
        'github-branch-preparation',
        'github/branch-prepared.json',
        branchPreparation.details,
        'Local Git branch preparation details for draft PR publication.',
      );

      await execution.persistGithub({
        branch: branchPreparation.branch,
        branchPreparationPath: branchPreparationArtifact.path,
      });
      await execution.appendEvent('github.branch.prepared', {
        action: branchPreparation.details.action,
        artifactPath: branchPreparationArtifact.path,
        branchName,
      });

      await stagePaths(
        execution.repoRoot,
        (
          execution.inspection.state.changedFiles as NonNullable<
            LoadedDurableRunState['changedFiles']
          >
        ).files.map((file) => file.path),
      );

      if (await hasStagedChanges(execution.repoRoot)) {
        await commitStagedChanges(
          execution.repoRoot,
          createCommitMessage(reviewPacket.specTitle, execution.run.github?.issue),
        );
        branchPreparation.branch.sha = await readGitHead(execution.repoRoot);
        await execution.persistGithub({
          branch: branchPreparation.branch,
        });
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
      await pushBranchToOrigin(execution.repoRoot, branchName);

      const prBody = renderDraftPullRequestBody(reviewPacket);
      const prBodyArtifact = await execution.artifactStore.writeTextArtifact(
        'github-pr-body',
        'github/pr-body.md',
        prBody,
        'markdown',
        'Rendered draft PR body derived from the structured review packet.',
      );
      const draftPrRequest = GithubDraftPrRequestSchema.parse({
        runId: execution.run.id,
        repo,
        baseBranch,
        headBranch: branchName,
        title: createDraftPrTitle(reviewPacket.specTitle, execution.run.github?.issue),
        body: prBody,
        draft: true,
        reviewPacketPath: resolve(execution.run.runDirectory, 'review-packet.md'),
        artifactPaths: [
          prBodyArtifact.path,
          resolve(execution.run.runDirectory, 'review-packet.md'),
        ],
        createdAt: createIsoTimestamp(),
      });
      const draftPrRequestArtifact = await execution.artifactStore.writeJsonArtifact(
        'github-draft-pr-request',
        'github/draft-pr.request.json',
        draftPrRequest,
        'Draft PR creation request prepared from the verified review packet.',
      );
      await execution.appendEvent('github.pr.draft_requested', {
        artifactPath: draftPrRequestArtifact.path,
        baseBranch,
        branchName,
      });
      const pullRequest = await adapter.createDraftPullRequest(draftPrRequest);
      const draftPrResult = GithubDraftPrResultSchema.parse({
        runId: execution.run.id,
        request: draftPrRequest,
        pullRequest,
        bodyUpdated: true,
        createdAt: createIsoTimestamp(),
      });
      const draftPrResultArtifact = await execution.artifactStore.writeJsonArtifact(
        'github-draft-pr-result',
        'github/draft-pr.result.json',
        draftPrResult,
        'Observed GitHub draft PR creation result for this run.',
      );

      await execution.persistGithub({
        pullRequest,
        draftPrRequestPath: draftPrRequestArtifact.path,
        draftPrResultPath: draftPrResultArtifact.path,
        publicationPath: prBodyArtifact.path,
      });
      await execution.persistManifest({
        artifactPaths: {
          ...execution.manifest.artifactPaths,
          githubBranchPreparation: branchPreparationArtifact.path,
          githubDraftPrRequest: draftPrRequestArtifact.path,
          githubDraftPrResult: draftPrResultArtifact.path,
          githubPrBody: prBodyArtifact.path,
        },
      });
      await execution.appendEvent('github.pr.draft_created', {
        artifactPath: draftPrResultArtifact.path,
        pullRequestNumber: pullRequest.pullRequestNumber,
        url: pullRequest.url,
      });

      return {
        artifactsDirectory: execution.run.runDirectory,
        branchName,
        pullRequestNumber: pullRequest.pullRequestNumber,
        pullRequestUrl: pullRequest.url,
        runId: context.runId,
        status: 'created',
        summary: `Draft PR #${pullRequest.pullRequestNumber} created for run "${execution.run.id}".`,
      };
    });
  }

  async syncPacket(
    context: SyncContext,
    options: GithubCommandOptions = {},
  ): Promise<GithubCommandSummary> {
    return this.execute(context, options, 'draft_pr_sync_packet', async (execution) => {
      const pullRequest = execution.run.github?.pullRequest;

      if (!pullRequest) {
        return {
          artifactsDirectory: execution.run.runDirectory,
          runId: context.runId,
          status: 'blocked',
          summary: 'Run does not have a recorded draft PR. Create the draft PR first.',
        };
      }

      const reviewPacket = await this.loadReviewPacketFn(execution.repoRoot, context.runId);
      const { adapter } = await execution.getClient();
      const prBody = renderDraftPullRequestBody(reviewPacket);
      const prComment = renderDraftPullRequestComment(reviewPacket);
      const bodyArtifact = await execution.artifactStore.writeTextArtifact(
        'github-pr-body',
        'github/pr-body.md',
        prBody,
        'markdown',
        'Rendered draft PR body derived from the structured review packet.',
      );
      const commentArtifact = await execution.artifactStore.writeTextArtifact(
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
      const publicationArtifact = await execution.artifactStore.writeJsonArtifact(
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

      const github = await execution.persistGithub({
        pullRequest: updatedPullRequest,
        publicationPath: publicationArtifact.path,
      });
      await execution.persistManifest({
        artifactPaths: {
          ...execution.manifest.artifactPaths,
          githubPrBody: bodyArtifact.path,
          githubPrComment: commentArtifact.path,
          githubPrPublication: publicationArtifact.path,
        },
      });
      await execution.appendEvent('github.pr.comment.published', {
        commentId: publishedComment.commentId,
        pullRequestNumber: updatedPullRequest.pullRequestNumber,
        url: publishedComment.url,
      });

      return {
        artifactsDirectory: execution.run.runDirectory,
        branchName: github.branch?.name,
        pullRequestNumber: updatedPullRequest.pullRequestNumber,
        pullRequestUrl: updatedPullRequest.url,
        runId: context.runId,
        status: 'synced',
        summary: `Draft PR #${updatedPullRequest.pullRequestNumber} body and supplemental comment were synced from the current review packet.`,
      };
    });
  }

  async syncComments(
    context: SyncContext,
    options: GithubCommandOptions = {},
  ): Promise<GithubCommandSummary> {
    return this.execute(context, options, 'draft_pr_comments', async (execution) => {
      const pullRequest = execution.run.github?.pullRequest;

      if (!pullRequest) {
        return {
          artifactsDirectory: execution.run.runDirectory,
          runId: context.runId,
          status: 'blocked',
          summary: 'Run does not have a recorded draft PR. Create the draft PR first.',
        };
      }

      const { adapter, config } = await execution.getClient();
      const comments = await adapter.listPullRequestComments(pullRequest);
      const commentsArtifact = await execution.artifactStore.writeJsonArtifact(
        'github-pr-comments',
        'github/pr-comments.json',
        comments,
        'Latest GitHub PR comments fetched for deterministic local review.',
      );
      const iterationRequests: GithubIterationRequest[] = [];
      const iterationRequestArtifactPaths: string[] = [];

      for (const comment of comments) {
        const instruction = extractIterationInstruction(comment, config.iterationCommandPrefix);

        if (!instruction) {
          continue;
        }

        const request = createGithubIterationRequestRecord({
          runId: context.runId,
          pullRequest,
          sourceComment: comment,
          instruction,
          command: config.iterationCommandPrefix,
          createdAt: iterationRequestCreatedAt(comment),
        });
        const requestArtifact = await execution.artifactStore.writeJsonArtifact(
          'github-iteration-request',
          `github/iteration-requests/${request.id}.json`,
          request,
          'Normalized GitHub iteration request detected from a PR comment.',
        );
        iterationRequests.push(request);
        iterationRequestArtifactPaths.push(requestArtifact.path);
        await execution.appendEvent('github.iteration.requested', {
          artifactPath: requestArtifact.path,
          commentId: comment.commentId,
          pullRequestNumber: pullRequest.pullRequestNumber,
        });
      }

      const github = await execution.persistGithub({
        commentSyncPath: commentsArtifact.path,
        iterationRequestPaths: uniqueStrings([
          ...(execution.run.github?.iterationRequestPaths ?? []),
          ...iterationRequestArtifactPaths,
        ]),
      });
      await execution.persistManifest({
        artifactPaths: {
          ...execution.manifest.artifactPaths,
          githubPrComments: commentsArtifact.path,
        },
      });

      return {
        artifactsDirectory: execution.run.runDirectory,
        branchName: github.branch?.name,
        commentCount: comments.length,
        iterationRequestCount: iterationRequests.length,
        pullRequestNumber: pullRequest.pullRequestNumber,
        pullRequestUrl: pullRequest.url,
        runId: context.runId,
        status: 'inspected',
        summary:
          iterationRequests.length > 0
            ? `Fetched ${comments.length} PR comment(s) and detected ${iterationRequests.length} explicit iteration request(s).`
            : `Fetched ${comments.length} PR comment(s) and detected no explicit iteration requests.`,
      };
    });
  }

  async materializeIteration(
    context: SyncContext,
    options: GithubCommandOptions = {},
  ): Promise<GithubCommandSummary> {
    const commentsSummary = await this.syncComments(context, options);

    return this.execute(context, options, 'draft_pr_iterate', async (execution) => {
      const pullRequest = execution.run.github?.pullRequest;

      if (!pullRequest) {
        return {
          artifactsDirectory: execution.run.runDirectory,
          runId: context.runId,
          status: 'blocked',
          summary: 'Run does not have a recorded draft PR. Create the draft PR first.',
        };
      }

      const comments = await execution.artifactStore.readJsonArtifact('github/pr-comments.json', {
        parse(value: unknown) {
          if (!Array.isArray(value)) {
            throw new Error('Expected an array of PR comments.');
          }

          return value.map((comment) => GithubCommentRefSchema.parse(comment));
        },
      });
      const { config } = await execution.getClient();
      const latestComment = [...comments]
        .reverse()
        .find((comment) => extractIterationInstruction(comment, config.iterationCommandPrefix));

      if (!latestComment) {
        return {
          artifactsDirectory: execution.run.runDirectory,
          commentCount: commentsSummary.commentCount,
          iterationRequestCount: commentsSummary.iterationRequestCount,
          pullRequestNumber: pullRequest.pullRequestNumber,
          pullRequestUrl: pullRequest.url,
          runId: context.runId,
          status: 'blocked',
          summary: 'No explicit iteration request was detected in the current PR comments.',
        };
      }

      const reviewPacket = await this.loadReviewPacketFn(execution.repoRoot, context.runId);
      const instruction = extractIterationInstruction(latestComment, config.iterationCommandPrefix);

      if (!instruction) {
        throw new Error('Latest iteration comment could not be normalized safely.');
      }

      const requestCreatedAt = iterationRequestCreatedAt(latestComment);
      const provisionalRequest = createGithubIterationRequestRecord({
        runId: context.runId,
        pullRequest,
        sourceComment: latestComment,
        instruction,
        command: config.iterationCommandPrefix,
        createdAt: requestCreatedAt,
      });
      const iterationMarkdown = renderIterationRequestMarkdown({
        comment: latestComment,
        instruction,
        reviewPacket,
        runId: context.runId,
      });
      const markdownArtifact = await execution.artifactStore.writeTextArtifact(
        'github-iteration-input',
        `github/iteration-requests/${provisionalRequest.id}.md`,
        iterationMarkdown,
        'markdown',
        'Follow-up governed-run input materialized from an explicit PR iteration request.',
      );
      const requestWithInput = createGithubIterationRequestRecord({
        runId: context.runId,
        pullRequest,
        sourceComment: latestComment,
        instruction,
        command: config.iterationCommandPrefix,
        normalizedInputPath: markdownArtifact.path,
        createdAt: requestCreatedAt,
      });
      const requestArtifact = await execution.artifactStore.writeJsonArtifact(
        'github-iteration-request',
        `github/iteration-requests/${requestWithInput.id}.json`,
        requestWithInput,
        'Normalized GitHub iteration request with a materialized follow-up input path.',
      );
      await execution.persistGithub({
        iterationRequestPaths: uniqueStrings([
          ...(execution.run.github?.iterationRequestPaths ?? []),
          requestArtifact.path,
        ]),
      });
      await execution.appendEvent('github.iteration.requested', {
        artifactPath: requestArtifact.path,
        commentId: latestComment.commentId,
        normalizedInputPath: markdownArtifact.path,
        pullRequestNumber: pullRequest.pullRequestNumber,
      });

      return {
        artifactsDirectory: execution.run.runDirectory,
        commentCount: commentsSummary.commentCount,
        iterationInputPath: markdownArtifact.path,
        iterationRequestCount: commentsSummary.iterationRequestCount,
        pullRequestNumber: pullRequest.pullRequestNumber,
        pullRequestUrl: pullRequest.url,
        runId: context.runId,
        status: 'created',
        summary: `Materialized a follow-up iteration input from PR comment ${latestComment.commentId}.`,
      };
    });
  }

  async ingestIssue(input: GithubIssueIngestionInput): Promise<{
    manifest: SessionManifest;
    run: Run;
  }> {
    return ingestGithubIssue(input);
  }

  private async execute<T>(
    context: SyncContext,
    options: GithubCommandOptions,
    operation: string,
    action: (state: SyncExecutionState) => Promise<T>,
  ): Promise<T> {
    const lifecycleService = this.requireLifecycleService();
    const repoRoot = await this.findRepoRootFn(context.cwd);
    const inspection = await lifecycleService.status(context.runId, { cwd: context.cwd });
    let run = inspection.run;
    let manifest = inspection.manifest;
    let clientPromise: Promise<{ adapter: GithubAdapter; config: GithubConfig }> | undefined;
    const resolveGithubClientFn = this.resolveGithubClientFn;

    const state: SyncExecutionState = {
      artifactStore: inspection.artifactStore,
      inspection,
      repoRoot,
      get run() {
        return run;
      },
      get manifest() {
        return manifest;
      },
      async getClient() {
        clientPromise ??= resolveGithubClientFn(repoRoot, {
          githubAdapter: options.githubAdapter,
          githubConfig: options.githubConfig,
        });

        return clientPromise;
      },
      appendEvent: async (type, payload) =>
        inspection.artifactStore.appendEvent(createRunEvent(run.id, type, payload)),
      persistGithub: async (patch) => {
        const github = mergeGithubState(run.github, patch);
        ({ manifest, run } = await persistGithubState(
          inspection.artifactStore,
          run,
          manifest,
          github,
        ));
        return github;
      },
      persistManifest: async (input) => {
        manifest = updateSessionManifestRecord(manifest, input);
        await persistSessionManifest(inspection.artifactStore, manifest);
      },
    };

    try {
      return await action(state);
    } catch (error) {
      try {
        await this.emitGithubFailureEvent(
          inspection.artifactStore,
          context.runId,
          operation,
          error,
        );
      } catch {
        // Preserve the original GitHub sync failure if failure-event persistence also breaks.
      }
      throw error;
    }
  }

  private requireLifecycleService(): RunLifecycleService {
    if (!this.lifecycleService) {
      throw new Error('GithubSyncService requires a lifecycleService for run-scoped operations.');
    }

    return this.lifecycleService;
  }

  private async emitGithubFailureEvent(
    artifactStore: ArtifactStore,
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
}
