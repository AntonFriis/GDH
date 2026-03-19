import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { GithubAdapter } from '@gdh/github-adapter';
import { afterEach, describe, expect, it } from 'vitest';
import { createDraftPrForRun, materializeIterationRequest, runSpecFile } from '../src/index';

const tempDirectories: string[] = [];

const defaultPolicyContents = [
  'version: 1',
  'name: test-default',
  'defaults:',
  '  sandbox_mode: workspace-write',
  '  network_access: false',
  '  approval_policy: on-request',
  '  fallback_decision: prompt',
  'rules:',
  '  - id: docs-safe',
  '    match:',
  '      task_classes: [docs]',
  '      paths: ["docs/**", "README.md"]',
  '      actions: [read, write]',
  '    decision: allow',
].join('\n');

interface VerificationConfig {
  optional?: string[];
  postrun?: string[];
  preflight?: string[];
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function createTempRepo(verification?: VerificationConfig): Promise<{
  remoteRoot: string;
  repoRoot: string;
}> {
  const repoRoot = await mkdtemp(resolve(tmpdir(), 'gdh-cli-github-repo-'));
  const remoteRoot = await mkdtemp(resolve(tmpdir(), 'gdh-cli-github-remote-'));

  tempDirectories.push(repoRoot, remoteRoot);

  execFileSync('git', ['init'], { cwd: repoRoot });
  execFileSync('git', ['init', '--bare'], { cwd: remoteRoot });
  execFileSync('git', ['remote', 'add', 'origin', remoteRoot], { cwd: repoRoot });
  await mkdir(resolve(repoRoot, 'runs', 'local'), { recursive: true });
  await mkdir(resolve(repoRoot, 'policies'), { recursive: true });
  await mkdir(resolve(repoRoot, 'scripts'), { recursive: true });
  await mkdir(resolve(repoRoot, '.codex'), { recursive: true });
  await writeFile(
    resolve(repoRoot, '.gitignore'),
    ['runs/local/**', '!runs/local/.gitkeep', 'node_modules/', 'dist/'].join('\n'),
    'utf8',
  );
  await writeFile(resolve(repoRoot, 'runs', 'local', '.gitkeep'), '', 'utf8');
  await writeFile(resolve(repoRoot, 'README.md'), '# Temp Repo\n', 'utf8');
  await writeFile(resolve(repoRoot, 'AGENTS.md'), '# AGENTS\n', 'utf8');
  await writeFile(resolve(repoRoot, 'PLANS.md'), '# PLANS\n', 'utf8');
  await writeFile(resolve(repoRoot, 'implement.md'), '# implement\n', 'utf8');
  await writeFile(resolve(repoRoot, 'documentation.md'), '# documentation\n', 'utf8');
  await writeFile(
    resolve(repoRoot, 'codex_governed_delivery_handoff_spec.md'),
    '# handoff\n',
    'utf8',
  );
  await writeFile(resolve(repoRoot, '.codex', 'config.toml'), 'model = "gpt-5.4"\n', 'utf8');
  await writeFile(
    resolve(repoRoot, 'policies', 'default.policy.yaml'),
    defaultPolicyContents,
    'utf8',
  );
  await writeFile(
    resolve(repoRoot, 'scripts', 'pass.mjs'),
    "console.log(process.argv.slice(2).join(' '));\n",
    'utf8',
  );
  await writeFile(
    resolve(repoRoot, 'scripts', 'fail.mjs'),
    "console.error(process.argv.slice(2).join(' '));\nprocess.exit(1);\n",
    'utf8',
  );
  await writeJson(resolve(repoRoot, 'gdh.config.json'), {
    verification: {
      preflight: verification?.preflight ?? ['node scripts/pass.mjs lint'],
      postrun: verification?.postrun ?? ['node scripts/pass.mjs test'],
      optional: verification?.optional ?? [],
    },
    github: {
      defaultBaseBranch: 'main',
      iterationCommandPrefix: '/gdh iterate',
    },
  });
  execFileSync('git', ['add', '.'], { cwd: repoRoot });
  execFileSync(
    'git',
    ['-c', 'user.name=GDH', '-c', 'user.email=gdh@example.invalid', 'commit', '-m', 'init'],
    {
      cwd: repoRoot,
    },
  );

  return {
    remoteRoot,
    repoRoot,
  };
}

function commitAll(repoRoot: string, message: string): void {
  execFileSync('git', ['add', '.'], { cwd: repoRoot });
  execFileSync(
    'git',
    ['-c', 'user.name=GDH', '-c', 'user.email=gdh@example.invalid', 'commit', '-m', message],
    {
      cwd: repoRoot,
    },
  );
}

function commitPaths(repoRoot: string, message: string, paths: string[]): void {
  execFileSync('git', ['add', '--', ...paths], { cwd: repoRoot });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=GDH',
      '-c',
      'user.email=gdh@example.invalid',
      'commit',
      '-m',
      message,
      '--',
      ...paths,
    ],
    {
      cwd: repoRoot,
    },
  );
}

function createIssue() {
  return {
    repo: {
      owner: 'acme',
      repo: 'gdh',
      fullName: 'acme/gdh',
      url: 'https://github.com/acme/gdh',
      defaultBranch: 'main',
    },
    issueNumber: 42,
    title: 'Refresh the fake runner docs output',
    body: [
      '## Summary',
      'Refresh `docs/fake-run-output.md` to reflect the latest governed flow.',
      '',
      '## Objective',
      'Update `docs/fake-run-output.md` with the latest governed-delivery phase note.',
      '',
      '## Acceptance Criteria',
      '- `docs/fake-run-output.md` is updated.',
    ].join('\n'),
    labels: ['docs'],
    url: 'https://github.com/acme/gdh/issues/42',
    state: 'open' as const,
  };
}

class FakeGithubAdapter implements GithubAdapter {
  readonly comments: Array<{
    author?: string;
    body: string;
    commentId: number;
    createdAt: string;
    pullRequestNumber: number;
    updatedAt?: string;
    url?: string;
  }> = [];

  createdDraftPrs = 0;
  publishedComments = 0;

  constructor(private readonly issue = createIssue()) {}

  async fetchIssue() {
    return this.issue;
  }

  async fetchRepo() {
    return this.issue.repo;
  }

  async ensureBranch(request: { branchName: string; repo: typeof this.issue.repo }) {
    return {
      repo: request.repo,
      name: request.branchName,
      ref: `refs/heads/${request.branchName}`,
      sha: 'abc123',
      remoteName: 'origin',
      url: `${request.repo.url}/tree/${request.branchName}`,
      existed: false,
    };
  }

  async createDraftPullRequest(request: {
    baseBranch: string;
    headBranch: string;
    repo: typeof this.issue.repo;
    title: string;
  }) {
    this.createdDraftPrs += 1;

    return {
      repo: request.repo,
      pullRequestNumber: 7,
      title: request.title,
      url: `${request.repo.url}/pull/7`,
      state: 'open' as const,
      isDraft: true,
      baseBranch: request.baseBranch,
      headBranch: request.headBranch,
    };
  }

  async updatePullRequestBody(request: {
    pullRequest: Awaited<ReturnType<FakeGithubAdapter['createDraftPullRequest']>>;
  }) {
    return request.pullRequest;
  }

  async publishPullRequestComment(request: {
    pullRequestNumber: number;
    repo: typeof this.issue.repo;
  }) {
    this.publishedComments += 1;

    return {
      repo: request.repo,
      pullRequestNumber: request.pullRequestNumber,
      commentId: 99,
      url: `${request.repo.url}/issues/${request.pullRequestNumber}#issuecomment-99`,
      author: 'octocat',
      body: 'Synced comment',
      createdAt: '2026-03-17T10:05:00.000Z',
      updatedAt: '2026-03-17T10:05:00.000Z',
    };
  }

  async listPullRequestComments(
    pullRequest: Awaited<ReturnType<FakeGithubAdapter['createDraftPullRequest']>>,
  ) {
    return this.comments.map((comment) => ({
      repo: pullRequest.repo,
      pullRequestNumber: pullRequest.pullRequestNumber,
      commentId: comment.commentId,
      url: comment.url,
      author: comment.author,
      body: comment.body,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    }));
  }
}

async function createVerifiedIssueRun(): Promise<{
  adapter: FakeGithubAdapter;
  repoRoot: string;
  runId: string;
}> {
  const { repoRoot } = await createTempRepo();
  const adapter = new FakeGithubAdapter();
  const summary = await runSpecFile(undefined, {
    approvalMode: 'fail',
    cwd: repoRoot,
    githubAdapter: adapter,
    githubIssue: 'acme/gdh#42',
    runner: 'fake',
  });

  expect(summary.status).toBe('completed');

  return {
    adapter,
    repoRoot,
    runId: summary.runId,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('GitHub issue ingestion', () => {
  it('ingests a GitHub issue into the normal run pipeline and persists the linkage', async () => {
    const { repoRoot } = await createTempRepo();
    const adapter = new FakeGithubAdapter();
    const summary = await runSpecFile(undefined, {
      approvalMode: 'fail',
      cwd: repoRoot,
      githubAdapter: adapter,
      githubIssue: 'acme/gdh#42',
      runner: 'fake',
    });

    const spec = await readJson<{
      githubIssue?: { issueNumber?: number };
      source: string;
    }>(resolve(summary.artifactsDirectory, 'spec.normalized.json'));
    const run = await readJson<{
      github?: { issue?: { issueNumber?: number } };
    }>(resolve(summary.artifactsDirectory, 'run.json'));
    const issueIngestion = await readJson<{
      issue: { issueNumber: number };
    }>(resolve(summary.artifactsDirectory, 'github', 'issue.ingestion.json'));

    expect(summary.status).toBe('completed');
    expect(spec.source).toBe('github_issue');
    expect(spec.githubIssue?.issueNumber).toBe(42);
    expect(run.github?.issue?.issueNumber).toBe(42);
    expect(issueIngestion.issue.issueNumber).toBe(42);
  });
});

describe('Draft PR creation', () => {
  it('creates a draft PR for a verified run and persists the GitHub delivery state', async () => {
    const { adapter, repoRoot, runId } = await createVerifiedIssueRun();

    const summary = await createDraftPrForRun(runId, {
      cwd: repoRoot,
      githubAdapter: adapter,
    });
    const run = await readJson<{
      github?: {
        branch?: { name?: string };
        pullRequest?: { pullRequestNumber?: number; url?: string };
      };
    }>(resolve(repoRoot, 'runs', 'local', runId, 'run.json'));

    expect(summary.status).toBe('created');
    expect(summary.pullRequestNumber).toBe(7);
    expect(summary.branchName).toContain('gdh/issue-42');
    expect(run.github?.branch?.name).toContain('gdh/issue-42');
    expect(run.github?.pullRequest?.pullRequestNumber).toBe(7);
    expect(run.github?.pullRequest?.url).toContain('/pull/7');
    expect(adapter.createdDraftPrs).toBe(1);
  }, 20_000);

  it('creates a draft PR when the run modified an already tracked file', async () => {
    const { repoRoot } = await createTempRepo();
    const trackedOutputPath = resolve(repoRoot, 'docs', 'fake-run-output.md');
    const adapter = new FakeGithubAdapter();

    await mkdir(resolve(repoRoot, 'docs'), { recursive: true });
    await writeFile(trackedOutputPath, '# Existing docs output\n', 'utf8');
    commitAll(repoRoot, 'seed tracked docs output');

    const summary = await runSpecFile(undefined, {
      approvalMode: 'fail',
      cwd: repoRoot,
      githubAdapter: adapter,
      githubIssue: 'acme/gdh#42',
      runner: 'fake',
    });

    const prSummary = await createDraftPrForRun(summary.runId, {
      cwd: repoRoot,
      githubAdapter: adapter,
    });

    expect(summary.status).toBe('completed');
    expect(prSummary.status).toBe('created');
    expect(prSummary.branchName).toContain('gdh/issue-42');
    expect(adapter.createdDraftPrs).toBe(1);
  }, 20_000);

  it('allows draft PR creation after HEAD moved forward when the run changes remain in scope', async () => {
    const { repoRoot } = await createTempRepo();
    const adapter = new FakeGithubAdapter();
    const summary = await runSpecFile(undefined, {
      approvalMode: 'fail',
      cwd: repoRoot,
      githubAdapter: adapter,
      githubIssue: 'acme/gdh#42',
      runner: 'fake',
    });

    await writeFile(resolve(repoRoot, 'notes.md'), '# Notes\n', 'utf8');
    commitPaths(repoRoot, 'advance head with unrelated note', ['notes.md']);

    const prSummary = await createDraftPrForRun(summary.runId, {
      cwd: repoRoot,
      githubAdapter: adapter,
    });

    expect(summary.status).toBe('completed');
    expect(prSummary.status).toBe('created');
    expect(adapter.createdDraftPrs).toBe(1);
  }, 20_000);

  it('blocks draft PR creation when verification failed', async () => {
    const { repoRoot } = await createTempRepo({
      postrun: ['node scripts/fail.mjs test'],
      preflight: ['node scripts/pass.mjs lint'],
    });
    const adapter = new FakeGithubAdapter();
    const summary = await runSpecFile(undefined, {
      approvalMode: 'fail',
      cwd: repoRoot,
      githubAdapter: adapter,
      githubIssue: 'acme/gdh#42',
      runner: 'fake',
    });

    expect(summary.status).toBe('failed');

    const prSummary = await createDraftPrForRun(summary.runId, {
      cwd: repoRoot,
      githubAdapter: adapter,
    });

    expect(prSummary.status).toBe('blocked');
    expect(prSummary.summary).toContain('Run verification did not pass');
    expect(adapter.createdDraftPrs).toBe(0);
  });
});

describe('Comment-to-iterate flow', () => {
  it('materializes a conservative follow-up input from an explicit PR comment', async () => {
    const { adapter, repoRoot, runId } = await createVerifiedIssueRun();

    await createDraftPrForRun(runId, {
      cwd: repoRoot,
      githubAdapter: adapter,
    });
    adapter.comments.push({
      author: 'reviewer',
      body: '/gdh iterate add a short regression note to the docs output',
      commentId: 101,
      createdAt: '2026-03-17T10:10:00.000Z',
      pullRequestNumber: 7,
      updatedAt: '2026-03-17T10:10:00.000Z',
      url: 'https://github.com/acme/gdh/issues/7#issuecomment-101',
    });

    const summary = await materializeIterationRequest(runId, {
      cwd: repoRoot,
      githubAdapter: adapter,
    });
    const iterationInput = summary.iterationInputPath
      ? await readFile(summary.iterationInputPath, 'utf8')
      : '';

    expect(summary.status).toBe('created');
    expect(summary.iterationRequestCount).toBe(1);
    expect(summary.iterationInputPath).toContain('github/iteration-requests/');
    expect(iterationInput).toContain('add a short regression note to the docs output');
    expect(iterationInput).toContain('Original objective');
  }, 20_000);
});
