import type { GithubIssueRef, Run } from '@gdh/domain';
import {
  createGithubAdapter,
  type GithubAdapter,
  type GithubConfig,
  loadGithubConfig,
  requireGithubToken,
} from '@gdh/github-adapter';
import { slugify } from '@gdh/shared';

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
