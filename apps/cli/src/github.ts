import type { createArtifactStore } from '@gdh/artifact-store';
import { createRunEvent, type GithubIssueRef, type Run, type RunGithubState } from '@gdh/domain';
import {
  createGithubAdapter,
  type GithubAdapter,
  type GithubConfig,
  loadGithubConfig,
  requireGithubToken,
} from '@gdh/github-adapter';
import { createIsoTimestamp, slugify } from '@gdh/shared';

export async function resolveGithubClient(
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

export function renderGithubIssueSourceMarkdown(issue: GithubIssueRef): string {
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

export function deriveBranchName(run: Run, specTitle: string, issue?: GithubIssueRef): string {
  const titleSlug = slugify(specTitle).slice(0, 32);

  if (issue) {
    return `gdh/issue-${issue.issueNumber}-${titleSlug}`;
  }

  return `gdh/run-${titleSlug}-${run.id.slice(-6)}`;
}

export function createCommitMessage(specTitle: string, issue?: GithubIssueRef): string {
  return issue ? `gdh: ${specTitle} (#${issue.issueNumber})` : `gdh: ${specTitle}`;
}

export function createDraftPrTitle(specTitle: string, issue?: GithubIssueRef): string {
  return issue ? `${specTitle} (#${issue.issueNumber})` : specTitle;
}

export function updateGithubState(
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

export async function emitGithubFailureEvent(
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
