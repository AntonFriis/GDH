import type { Octokit } from '@octokit/rest';

export interface GitHubIssueRef {
  owner: string;
  repo: string;
  issueNumber: number;
}

export interface DraftPullRequestRequest {
  runId: string;
  branchName: string;
  title: string;
  body: string;
}

export interface GitHubAdapter {
  fetchIssue(ref: GitHubIssueRef): Promise<unknown>;
  createDraftPullRequest(request: DraftPullRequestRequest): Promise<unknown>;
}

export interface GitHubAdapterOptions {
  client?: Octokit;
}

export class NoopGitHubAdapter implements GitHubAdapter {
  async fetchIssue(_ref: GitHubIssueRef): Promise<unknown> {
    throw new Error('GitHub issue fetching starts in Phase 5.');
  }

  async createDraftPullRequest(_request: DraftPullRequestRequest): Promise<unknown> {
    throw new Error('Draft PR creation starts in Phase 5.');
  }
}

export function createGitHubAdapter(_options: GitHubAdapterOptions = {}): GitHubAdapter {
  return new NoopGitHubAdapter();
}
