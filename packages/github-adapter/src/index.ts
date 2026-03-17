import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type GithubBranchRef,
  GithubBranchRefSchema,
  type GithubCommentRef,
  GithubCommentRefSchema,
  type GithubDraftPrRequest,
  GithubDraftPrRequestSchema,
  type GithubIssueRef,
  GithubIssueRefSchema,
  type GithubPullRequestRef,
  GithubPullRequestRefSchema,
  type GithubRepoRef,
  GithubRepoRefSchema,
} from '@gdh/domain';
import { Octokit } from '@octokit/rest';

export interface GithubIssueLocator {
  owner: string;
  repo: string;
  issueNumber: number;
}

export interface GithubBranchPreparationRequest {
  repo: GithubRepoRef;
  branchName: string;
  baseBranch?: string;
}

export interface GithubPullRequestUpdateRequest {
  pullRequest: GithubPullRequestRef;
  body: string;
}

export interface GithubCommentPublicationRequest {
  repo: GithubRepoRef;
  pullRequestNumber: number;
  body: string;
  commentId?: number;
}

export interface GithubConfig {
  apiUrl?: string;
  defaultBaseBranch?: string;
  iterationCommandPrefix: string;
  token?: string;
}

export interface GithubAdapter {
  fetchIssue(ref: GithubIssueLocator): Promise<GithubIssueRef>;
  fetchRepo(ref: Pick<GithubRepoRef, 'owner' | 'repo'>): Promise<GithubRepoRef>;
  ensureBranch(request: GithubBranchPreparationRequest): Promise<GithubBranchRef>;
  createDraftPullRequest(request: GithubDraftPrRequest): Promise<GithubPullRequestRef>;
  updatePullRequestBody(request: GithubPullRequestUpdateRequest): Promise<GithubPullRequestRef>;
  publishPullRequestComment(request: GithubCommentPublicationRequest): Promise<GithubCommentRef>;
  listPullRequestComments(pullRequest: GithubPullRequestRef): Promise<GithubCommentRef[]>;
}

type GithubRestClient = {
  rest: {
    git: {
      createRef(input: {
        owner: string;
        repo: string;
        ref: string;
        sha: string;
      }): Promise<{ data: { object?: { sha?: string } } }>;
    };
    issues: {
      createComment(input: {
        owner: string;
        repo: string;
        issue_number: number;
        body: string;
      }): Promise<{
        data: {
          id: number;
          body?: string | null;
          html_url?: string;
          created_at?: string;
          updated_at?: string;
          user?: { login?: string | null };
        };
      }>;
      get(input: { owner: string; repo: string; issue_number: number }): Promise<{
        data: {
          number: number;
          title?: string | null;
          body?: string | null;
          html_url?: string;
          state?: 'open' | 'closed';
          labels?: Array<string | { name?: string | null }>;
          pull_request?: unknown;
        };
      }>;
      listComments(input: {
        owner: string;
        repo: string;
        issue_number: number;
        page?: number;
        per_page?: number;
      }): Promise<{
        data: Array<{
          id: number;
          body?: string | null;
          html_url?: string;
          created_at?: string;
          updated_at?: string;
          user?: { login?: string | null };
        }>;
      }>;
      updateComment(input: {
        owner: string;
        repo: string;
        comment_id: number;
        body: string;
      }): Promise<{
        data: {
          id: number;
          body?: string | null;
          html_url?: string;
          created_at?: string;
          updated_at?: string;
          user?: { login?: string | null };
        };
      }>;
    };
    pulls: {
      create(input: {
        owner: string;
        repo: string;
        head: string;
        base: string;
        title: string;
        body: string;
        draft: true;
      }): Promise<{
        data: {
          number: number;
          title?: string | null;
          html_url?: string;
          state?: 'open' | 'closed';
          draft?: boolean | null;
          base?: { ref?: string | null };
          head?: { ref?: string | null };
        };
      }>;
      update(input: { owner: string; repo: string; pull_number: number; body: string }): Promise<{
        data: {
          number: number;
          title?: string | null;
          html_url?: string;
          state?: 'open' | 'closed';
          draft?: boolean | null;
          base?: { ref?: string | null };
          head?: { ref?: string | null };
        };
      }>;
    };
    repos: {
      get(input: { owner: string; repo: string }): Promise<{
        data: {
          owner?: { login?: string | null };
          name?: string | null;
          html_url?: string;
          default_branch?: string | null;
        };
      }>;
      getBranch(input: { owner: string; repo: string; branch: string }): Promise<{
        data: {
          name?: string | null;
          commit?: { sha?: string | null };
        };
      }>;
    };
  };
};

interface GithubConfigFile {
  github?: {
    defaultBaseBranch?: string;
    iterationCommandPrefix?: string;
  };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number' &&
    (error as { status: number }).status === 404
  );
}

function normalizeLabel(label: string | { name?: string | null }): string {
  if (typeof label === 'string') {
    return label.trim();
  }

  return label.name?.trim() ?? '';
}

function createRepoRef(input: {
  owner: string;
  repo: string;
  url?: string;
  defaultBranch?: string;
}): GithubRepoRef {
  return GithubRepoRefSchema.parse({
    owner: input.owner,
    repo: input.repo,
    fullName: `${input.owner}/${input.repo}`,
    url: input.url,
    defaultBranch: input.defaultBranch,
  });
}

function createPullRequestRef(
  repo: GithubRepoRef,
  input: {
    number: number;
    title?: string | null;
    url?: string;
    state?: 'open' | 'closed';
    draft?: boolean | null;
    baseBranch?: string | null;
    headBranch?: string | null;
  },
): GithubPullRequestRef {
  return GithubPullRequestRefSchema.parse({
    repo,
    pullRequestNumber: input.number,
    title: input.title?.trim() || `Draft PR #${input.number}`,
    url: input.url ?? `${repo.url ?? `https://github.com/${repo.fullName}`}/pull/${input.number}`,
    state: input.state ?? 'open',
    isDraft: input.draft ?? true,
    baseBranch: input.baseBranch?.trim() || repo.defaultBranch || 'main',
    headBranch: input.headBranch?.trim() || 'unknown',
  });
}

function createCommentRef(
  repo: GithubRepoRef,
  pullRequestNumber: number,
  input: {
    id: number;
    body?: string | null;
    html_url?: string;
    created_at?: string;
    updated_at?: string;
    user?: { login?: string | null };
  },
): GithubCommentRef {
  return GithubCommentRefSchema.parse({
    repo,
    pullRequestNumber,
    commentId: input.id,
    url: input.html_url,
    author: input.user?.login ?? undefined,
    body: input.body ?? '',
    createdAt: input.created_at ?? new Date().toISOString(),
    updatedAt: input.updated_at ?? undefined,
  });
}

export function parseGithubIssueReference(value: string): GithubIssueLocator {
  const trimmed = value.trim();
  const match = /^(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+)#(?<issueNumber>\d+)$/.exec(
    trimmed,
  );

  if (!match?.groups) {
    throw new Error(
      `Invalid GitHub issue reference "${value}". Expected the form "owner/repo#123".`,
    );
  }

  const owner = match.groups.owner;
  const repo = match.groups.repo;
  const issueNumber = match.groups.issueNumber;

  if (!owner || !repo || !issueNumber) {
    throw new Error(
      `Invalid GitHub issue reference "${value}". Expected the form "owner/repo#123".`,
    );
  }

  return {
    owner,
    repo,
    issueNumber: Number.parseInt(issueNumber, 10),
  };
}

export async function loadGithubConfig(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GithubConfig> {
  const configPath = resolve(repoRoot, 'gdh.config.json');
  let fileConfig: GithubConfigFile = {};

  try {
    fileConfig = JSON.parse(await readFile(configPath, 'utf8')) as GithubConfigFile;
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;

    if (fileError.code !== 'ENOENT') {
      throw new Error(
        `Could not load GitHub config from "${configPath}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    apiUrl: env.GITHUB_API_URL?.trim() || undefined,
    defaultBaseBranch: fileConfig.github?.defaultBaseBranch?.trim() || undefined,
    iterationCommandPrefix: fileConfig.github?.iterationCommandPrefix?.trim() || '/gdh iterate',
    token: env.GITHUB_TOKEN?.trim() || undefined,
  };
}

export function requireGithubToken(config: GithubConfig): string {
  if (!config.token) {
    throw new Error(
      'GitHub integration was requested but GITHUB_TOKEN is not configured. Set it in the environment before using GitHub commands.',
    );
  }

  return config.token;
}

class OctokitGithubAdapter implements GithubAdapter {
  constructor(private readonly client: GithubRestClient) {}

  async fetchIssue(ref: GithubIssueLocator): Promise<GithubIssueRef> {
    const [repoResponse, issueResponse] = await Promise.all([
      this.client.rest.repos.get({
        owner: ref.owner,
        repo: ref.repo,
      }),
      this.client.rest.issues.get({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.issueNumber,
      }),
    ]);

    if (issueResponse.data.pull_request) {
      throw new Error(
        `GitHub issue ingestion only supports issues, but "${ref.owner}/${ref.repo}#${ref.issueNumber}" is a pull request.`,
      );
    }

    const repo = createRepoRef({
      owner: repoResponse.data.owner?.login ?? ref.owner,
      repo: repoResponse.data.name ?? ref.repo,
      url: repoResponse.data.html_url ?? undefined,
      defaultBranch: repoResponse.data.default_branch ?? undefined,
    });

    return GithubIssueRefSchema.parse({
      repo,
      issueNumber: issueResponse.data.number,
      title: issueResponse.data.title?.trim() || `${repo.fullName}#${issueResponse.data.number}`,
      body: issueResponse.data.body ?? '',
      labels: (issueResponse.data.labels ?? []).map(normalizeLabel).filter(Boolean),
      url: issueResponse.data.html_url ?? `${repo.url}/issues/${issueResponse.data.number}`,
      state: issueResponse.data.state ?? 'open',
    });
  }

  async fetchRepo(ref: Pick<GithubRepoRef, 'owner' | 'repo'>): Promise<GithubRepoRef> {
    const response = await this.client.rest.repos.get({
      owner: ref.owner,
      repo: ref.repo,
    });

    return createRepoRef({
      owner: response.data.owner?.login ?? ref.owner,
      repo: response.data.name ?? ref.repo,
      url: response.data.html_url ?? undefined,
      defaultBranch: response.data.default_branch ?? undefined,
    });
  }

  async ensureBranch(request: GithubBranchPreparationRequest): Promise<GithubBranchRef> {
    try {
      const existing = await this.client.rest.repos.getBranch({
        owner: request.repo.owner,
        repo: request.repo.repo,
        branch: request.branchName,
      });

      return GithubBranchRefSchema.parse({
        repo: request.repo,
        name: request.branchName,
        ref: `refs/heads/${request.branchName}`,
        sha: existing.data.commit?.sha ?? undefined,
        remoteName: 'origin',
        url: `${request.repo.url ?? `https://github.com/${request.repo.fullName}`}/tree/${request.branchName}`,
        existed: true,
      });
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }

    const baseBranch = request.baseBranch ?? request.repo.defaultBranch;

    if (!baseBranch) {
      throw new Error(
        `Cannot create branch "${request.branchName}" because no base branch was provided and the repository default branch is unknown.`,
      );
    }

    const base = await this.client.rest.repos.getBranch({
      owner: request.repo.owner,
      repo: request.repo.repo,
      branch: baseBranch,
    });
    await this.client.rest.git.createRef({
      owner: request.repo.owner,
      repo: request.repo.repo,
      ref: `refs/heads/${request.branchName}`,
      sha: base.data.commit?.sha ?? '',
    });

    return GithubBranchRefSchema.parse({
      repo: request.repo,
      name: request.branchName,
      ref: `refs/heads/${request.branchName}`,
      sha: base.data.commit?.sha ?? undefined,
      remoteName: 'origin',
      url: `${request.repo.url ?? `https://github.com/${request.repo.fullName}`}/tree/${request.branchName}`,
      existed: false,
    });
  }

  async createDraftPullRequest(request: GithubDraftPrRequest): Promise<GithubPullRequestRef> {
    const parsed = GithubDraftPrRequestSchema.parse(request);
    const response = await this.client.rest.pulls.create({
      owner: parsed.repo.owner,
      repo: parsed.repo.repo,
      head: parsed.headBranch,
      base: parsed.baseBranch,
      title: parsed.title,
      body: parsed.body,
      draft: true,
    });

    return createPullRequestRef(parsed.repo, {
      number: response.data.number,
      title: response.data.title,
      url: response.data.html_url,
      state: response.data.state ?? 'open',
      draft: response.data.draft,
      baseBranch: response.data.base?.ref,
      headBranch: response.data.head?.ref,
    });
  }

  async updatePullRequestBody(
    request: GithubPullRequestUpdateRequest,
  ): Promise<GithubPullRequestRef> {
    const response = await this.client.rest.pulls.update({
      owner: request.pullRequest.repo.owner,
      repo: request.pullRequest.repo.repo,
      pull_number: request.pullRequest.pullRequestNumber,
      body: request.body,
    });

    return createPullRequestRef(request.pullRequest.repo, {
      number: response.data.number,
      title: response.data.title,
      url: response.data.html_url,
      state: response.data.state ?? 'open',
      draft: response.data.draft,
      baseBranch: response.data.base?.ref,
      headBranch: response.data.head?.ref,
    });
  }

  async publishPullRequestComment(
    request: GithubCommentPublicationRequest,
  ): Promise<GithubCommentRef> {
    const response = request.commentId
      ? await this.client.rest.issues.updateComment({
          owner: request.repo.owner,
          repo: request.repo.repo,
          comment_id: request.commentId,
          body: request.body,
        })
      : await this.client.rest.issues.createComment({
          owner: request.repo.owner,
          repo: request.repo.repo,
          issue_number: request.pullRequestNumber,
          body: request.body,
        });

    return createCommentRef(request.repo, request.pullRequestNumber, response.data);
  }

  async listPullRequestComments(pullRequest: GithubPullRequestRef): Promise<GithubCommentRef[]> {
    const comments: GithubCommentRef[] = [];
    let page = 1;

    while (true) {
      const response = await this.client.rest.issues.listComments({
        owner: pullRequest.repo.owner,
        repo: pullRequest.repo.repo,
        issue_number: pullRequest.pullRequestNumber,
        page,
        per_page: 100,
      });

      comments.push(
        ...response.data.map((comment) =>
          createCommentRef(pullRequest.repo, pullRequest.pullRequestNumber, comment),
        ),
      );

      if (response.data.length < 100) {
        break;
      }

      page += 1;
    }

    return comments;
  }
}

export interface GithubAdapterOptions {
  apiUrl?: string;
  client?: GithubRestClient;
  token?: string;
}

export function createGithubAdapter(options: GithubAdapterOptions = {}): GithubAdapter {
  if (options.client) {
    return new OctokitGithubAdapter(options.client);
  }

  const token = options.token?.trim();

  if (!token) {
    throw new Error(
      'GitHub integration was requested but no authenticated client or token was provided.',
    );
  }

  return new OctokitGithubAdapter(
    new Octokit({
      auth: token,
      baseUrl: options.apiUrl,
    }) as unknown as GithubRestClient,
  );
}
