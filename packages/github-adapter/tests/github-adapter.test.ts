import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGithubAdapter, loadGithubConfig, parseGithubIssueReference } from '../src/index';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('parseGithubIssueReference', () => {
  it('parses the owner/repo#number form', () => {
    expect(parseGithubIssueReference('acme/gdh#42')).toEqual({
      owner: 'acme',
      repo: 'gdh',
      issueNumber: 42,
    });
  });

  it('rejects invalid references', () => {
    expect(() => parseGithubIssueReference('acme/gdh/issues/42')).toThrow(
      'Expected the form "owner/repo#123"',
    );
  });
});

describe('loadGithubConfig', () => {
  it('loads the repo-local iteration prefix and env token', async () => {
    const repoRoot = await mkdtemp(resolve(tmpdir(), 'gdh-github-config-'));

    tempDirectories.push(repoRoot);

    await writeFile(
      resolve(repoRoot, 'gdh.config.json'),
      JSON.stringify(
        {
          github: {
            defaultBaseBranch: 'develop',
            iterationCommandPrefix: '/gdh iterate',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const config = await loadGithubConfig(repoRoot, {
      GITHUB_API_URL: 'https://api.github.example.com',
      GITHUB_TOKEN: 'token-123',
    });

    expect(config.defaultBaseBranch).toBe('develop');
    expect(config.iterationCommandPrefix).toBe('/gdh iterate');
    expect(config.apiUrl).toBe('https://api.github.example.com');
    expect(config.token).toBe('token-123');
  });
});

describe('createGithubAdapter', () => {
  it('maps issue, branch, draft PR, and comment payloads through the thin adapter', async () => {
    const recorded: {
      createRef?: { owner: string; repo: string; ref: string; sha: string };
      draftRequest?: { owner: string; repo: string; head: string; base: string; title: string };
    } = {};

    const client = {
      rest: {
        git: {
          async createRef(input: { owner: string; repo: string; ref: string; sha: string }) {
            recorded.createRef = input;
            return { data: { object: { sha: input.sha } } };
          },
        },
        issues: {
          async createComment(input: {
            owner: string;
            repo: string;
            issue_number: number;
            body: string;
          }) {
            return {
              data: {
                id: 88,
                body: input.body,
                html_url: `https://github.com/${input.owner}/${input.repo}/issues/${input.issue_number}#issuecomment-88`,
                created_at: '2026-03-17T10:00:00.000Z',
                updated_at: '2026-03-17T10:00:00.000Z',
                user: { login: 'octocat' },
              },
            };
          },
          async get(input: { owner: string; repo: string; issue_number: number }) {
            return {
              data: {
                number: input.issue_number,
                title: 'Docs issue',
                body: 'Refresh the docs output.',
                html_url: `https://github.com/${input.owner}/${input.repo}/issues/${input.issue_number}`,
                state: 'open' as const,
                labels: [{ name: 'docs' }],
              },
            };
          },
          async listComments() {
            return {
              data: [
                {
                  id: 91,
                  body: '/gdh iterate tighten the PR body',
                  html_url: 'https://github.com/acme/gdh/issues/7#issuecomment-91',
                  created_at: '2026-03-17T10:05:00.000Z',
                  updated_at: '2026-03-17T10:05:00.000Z',
                  user: { login: 'reviewer' },
                },
              ],
            };
          },
          async updateComment(input: {
            owner: string;
            repo: string;
            comment_id: number;
            body: string;
          }) {
            return {
              data: {
                id: input.comment_id,
                body: input.body,
                html_url: `https://github.com/${input.owner}/${input.repo}/issues/7#issuecomment-${input.comment_id}`,
                created_at: '2026-03-17T10:06:00.000Z',
                updated_at: '2026-03-17T10:06:00.000Z',
                user: { login: 'octocat' },
              },
            };
          },
        },
        pulls: {
          async create(input: {
            owner: string;
            repo: string;
            head: string;
            base: string;
            title: string;
            body: string;
            draft: true;
          }) {
            recorded.draftRequest = {
              owner: input.owner,
              repo: input.repo,
              head: input.head,
              base: input.base,
              title: input.title,
            };
            return {
              data: {
                number: 7,
                title: input.title,
                html_url: `https://github.com/${input.owner}/${input.repo}/pull/7`,
                state: 'open' as const,
                draft: true,
                base: { ref: input.base },
                head: { ref: input.head },
              },
            };
          },
          async update(input: { owner: string; repo: string; pull_number: number; body: string }) {
            return {
              data: {
                number: input.pull_number,
                title: 'Docs issue',
                html_url: `https://github.com/${input.owner}/${input.repo}/pull/${input.pull_number}`,
                state: 'open' as const,
                draft: true,
                base: { ref: 'main' },
                head: { ref: 'gdh/docs-fix' },
              },
            };
          },
        },
        repos: {
          async get(input: { owner: string; repo: string }) {
            return {
              data: {
                owner: { login: input.owner },
                name: input.repo,
                html_url: `https://github.com/${input.owner}/${input.repo}`,
                default_branch: 'main',
              },
            };
          },
          async getBranch(input: { owner: string; repo: string; branch: string }) {
            if (input.branch === 'gdh/docs-fix') {
              throw { status: 404 };
            }

            return {
              data: {
                name: input.branch,
                commit: { sha: 'abc123' },
              },
            };
          },
        },
      },
    };

    const adapter = createGithubAdapter({ client });
    const issue = await adapter.fetchIssue({
      owner: 'acme',
      repo: 'gdh',
      issueNumber: 42,
    });
    const repo = await adapter.fetchRepo({
      owner: 'acme',
      repo: 'gdh',
    });
    const branch = await adapter.ensureBranch({
      repo,
      branchName: 'gdh/docs-fix',
      baseBranch: 'main',
    });
    const pullRequest = await adapter.createDraftPullRequest({
      runId: 'run-1',
      repo,
      baseBranch: 'main',
      headBranch: branch.name,
      title: 'Docs issue',
      body: 'PR body',
      draft: true,
      reviewPacketPath: '/tmp/run-1/review-packet.md',
      artifactPaths: ['/tmp/run-1/review-packet.md'],
      createdAt: '2026-03-17T10:00:00.000Z',
    });
    const updatedPullRequest = await adapter.updatePullRequestBody({
      pullRequest,
      body: 'Updated body',
    });
    const comment = await adapter.publishPullRequestComment({
      repo,
      pullRequestNumber: pullRequest.pullRequestNumber,
      body: 'Synced comment',
    });
    const comments = await adapter.listPullRequestComments(updatedPullRequest);

    expect(issue.issueNumber).toBe(42);
    expect(issue.labels).toEqual(['docs']);
    expect(recorded.createRef?.ref).toBe('refs/heads/gdh/docs-fix');
    expect(branch.existed).toBe(false);
    expect(recorded.draftRequest?.head).toBe('gdh/docs-fix');
    expect(pullRequest.isDraft).toBe(true);
    expect(comment.commentId).toBe(88);
    expect(comments[0]?.commentId).toBe(91);
  });
});
