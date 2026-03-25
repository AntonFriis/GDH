import { resolve } from 'node:path';
import {
  createArtifactReference,
  createContinuityAssessmentRecord,
  createPlanFromSpec,
  createRunRecord,
  createRunSessionRecord,
  createSessionManifestRecord,
  createWorkspaceSnapshotRecord,
  normalizeMarkdownSpec,
  type Run,
  type RunEvent,
  updateRunStage,
  updateRunStatus,
  updateRunVerification,
} from '@gdh/domain';
import type { GithubAdapter } from '@gdh/github-adapter';
import { describe, expect, it, vi } from 'vitest';
import { GithubSyncService } from '../src/services/github-sync/service.js';
import type { ArtifactStore, RunLifecycleInspection } from '../src/services/run-lifecycle/types.js';

class MemoryArtifactStore implements ArtifactStore {
  readonly artifacts = new Map<string, unknown>();
  readonly events: RunEvent[] = [];
  failEventAppend = false;
  failRunWrite = false;
  failTextWrite = false;
  writeRunAttempts = 0;

  constructor(
    readonly repoRoot: string,
    readonly runId: string,
  ) {}

  get runDirectory(): string {
    return resolve(this.repoRoot, 'runs', 'local', this.runId);
  }

  async initialize(): Promise<void> {}

  resolveArtifactPath(relativePath: string): string {
    return resolve(this.runDirectory, relativePath);
  }

  async artifactExists(relativePath: string): Promise<boolean> {
    return this.artifacts.has(this.resolveArtifactPath(relativePath));
  }

  async readJsonArtifact<T>(
    relativePath: string,
    parser: { parse(value: unknown): T },
  ): Promise<T> {
    return parser.parse(this.artifacts.get(this.resolveArtifactPath(relativePath)));
  }

  async readTextArtifact(relativePath: string): Promise<string> {
    const value = this.artifacts.get(this.resolveArtifactPath(relativePath));
    return typeof value === 'string' ? value : '';
  }

  async writeRun(run: Run) {
    this.writeRunAttempts += 1;

    if (this.failRunWrite) {
      throw new Error('persist run failed');
    }

    return this.writeJsonArtifact('run-record', 'run.json', run, 'Current persisted run record.');
  }

  async appendEvent(event: RunEvent) {
    if (this.failEventAppend) {
      throw new Error('append event failed');
    }

    this.events.push(event);
    return createArtifactReference(
      this.runId,
      'run-event',
      this.resolveArtifactPath(`events/${this.events.length}.json`),
      'json',
    );
  }

  async writeJsonArtifact<T>(kind: string, relativePath: string, value: T, summary?: string) {
    const path = this.resolveArtifactPath(relativePath);
    this.artifacts.set(path, value);
    return createArtifactReference(this.runId, kind, path, 'json', undefined, summary);
  }

  async writeTextArtifact(
    kind: string,
    relativePath: string,
    value: string,
    format: 'markdown' | 'patch' | 'text',
    summary?: string,
  ) {
    if (this.failTextWrite) {
      throw new Error('write text failed');
    }

    const path = this.resolveArtifactPath(relativePath);
    this.artifacts.set(path, value);
    return createArtifactReference(this.runId, kind, path, format, undefined, summary);
  }

  async appendTextArtifact(
    kind: string,
    relativePath: string,
    value: string,
    format: 'markdown' | 'patch' | 'text',
    summary?: string,
  ) {
    const path = this.resolveArtifactPath(relativePath);
    const existing = this.artifacts.get(path);
    this.artifacts.set(path, `${typeof existing === 'string' ? existing : ''}${value}`);
    return createArtifactReference(this.runId, kind, path, format, undefined, summary);
  }

  listArtifacts() {
    return [];
  }
}

function createInspection(store: MemoryArtifactStore): RunLifecycleInspection {
  const repoRoot = store.repoRoot;
  const spec = normalizeMarkdownSpec({
    content: ['# Sync comments test', '', '## Objective', 'Exercise the GitHub sync service.'].join(
      '\n',
    ),
    repoRoot,
    sourcePath: resolve(repoRoot, 'spec.md'),
  });
  const plan = createPlanFromSpec(spec);
  const pullRequest = {
    repo: {
      owner: 'acme',
      repo: 'gdh',
      fullName: 'acme/gdh',
      url: 'https://github.com/acme/gdh',
      defaultBranch: 'main',
    },
    pullRequestNumber: 7,
    title: 'Sync service test PR',
    url: 'https://github.com/acme/gdh/pull/7',
    state: 'open' as const,
    isDraft: true,
    baseBranch: 'main',
    headBranch: 'gdh/issue-42-sync-service',
  };

  let run = createRunRecord({
    runId: store.runId,
    spec,
    plan,
    runner: 'fake',
    model: 'gpt-5.4',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalMode: 'fail',
    networkAccess: false,
    policyPackName: 'default',
    policyPackVersion: 1,
    policyPackPath: resolve(repoRoot, 'policies/default.policy.yaml'),
    repoRoot,
    runDirectory: store.runDirectory,
    github: {
      pullRequest,
      iterationRequestPaths: [],
      updatedAt: '2026-03-25T10:00:00.000Z',
    },
    createdAt: '2026-03-25T10:00:00.000Z',
  });
  run = updateRunStage(
    updateRunVerification(run, {
      status: 'passed',
      resultPath: resolve(store.runDirectory, 'verification.result.json'),
      verifiedAt: '2026-03-25T10:02:00.000Z',
      summary: 'Verification passed.',
    }),
    {
      currentStage: 'verification_completed',
      lastSuccessfulStage: 'verification_completed',
      summary: 'Verification completed.',
    },
  );
  run = updateRunStatus(run, 'completed', 'Run completed successfully.');

  const session = createRunSessionRecord({
    runId: store.runId,
    trigger: 'run',
    startStage: 'created',
    startedAt: '2026-03-25T10:00:00.000Z',
    summary: 'Started for sync service tests.',
  });
  const manifest = createSessionManifestRecord({
    run,
    currentSession: session,
    github: run.github,
    summary: 'Ready for GitHub sync tests.',
    verificationState: {
      status: 'passed',
      summary: 'Verification passed.',
      resultPath: run.verificationResultPath,
      lastVerifiedAt: run.lastVerifiedAt,
    },
  });
  const workspaceSnapshot = createWorkspaceSnapshotRecord({
    repoRoot,
    workingDirectory: repoRoot,
    gitAvailable: true,
    gitHead: 'abc123',
  });

  return {
    artifactStore: store,
    continuity: createContinuityAssessmentRecord({
      runId: store.runId,
      status: 'compatible',
      summary: 'Workspace is compatible.',
      reasons: [],
      storedSnapshot: workspaceSnapshot,
      currentSnapshot: workspaceSnapshot,
    }),
    eligibility: manifest.resumeEligibility,
    manifest,
    run,
    state: {
      manifest,
      run,
    },
  };
}

function createAdapter(overrides?: {
  listPullRequestComments?: GithubAdapter['listPullRequestComments'];
}): GithubAdapter {
  return {
    fetchIssue: vi.fn(async () => {
      throw new Error('not used');
    }),
    fetchRepo: vi.fn(async () => {
      throw new Error('not used');
    }),
    ensureBranch: vi.fn(async () => {
      throw new Error('not used');
    }),
    createDraftPullRequest: vi.fn(async () => {
      throw new Error('not used');
    }),
    updatePullRequestBody: vi.fn(async () => {
      throw new Error('not used');
    }),
    publishPullRequestComment: vi.fn(async () => {
      throw new Error('not used');
    }),
    listPullRequestComments:
      overrides?.listPullRequestComments ??
      vi.fn(async () => [
        {
          repo: {
            owner: 'acme',
            repo: 'gdh',
            fullName: 'acme/gdh',
            url: 'https://github.com/acme/gdh',
            defaultBranch: 'main',
          },
          pullRequestNumber: 7,
          commentId: 101,
          body: 'Looks good',
          author: 'reviewer',
          createdAt: '2026-03-25T10:05:00.000Z',
          updatedAt: '2026-03-25T10:05:00.000Z',
          url: 'https://github.com/acme/gdh/pull/7#issuecomment-101',
        },
      ]),
  };
}

function createHarness(input?: {
  adapter?: GithubAdapter;
  failEventAppend?: boolean;
  failRunWrite?: boolean;
  failTextWrite?: boolean;
}): {
  adapter: GithubAdapter;
  inspection: RunLifecycleInspection;
  service: GithubSyncService;
  store: MemoryArtifactStore;
} {
  const repoRoot = '/tmp/gdh-github-sync-service';
  const runId = 'sync-service-test-run';
  const store = new MemoryArtifactStore(repoRoot, runId);
  store.failEventAppend = input?.failEventAppend ?? false;
  store.failRunWrite = input?.failRunWrite ?? false;
  store.failTextWrite = input?.failTextWrite ?? false;
  const inspection = createInspection(store);
  const adapter = input?.adapter ?? createAdapter();
  const service = new GithubSyncService({
    findRepoRootFn: async () => repoRoot,
    lifecycleService: {
      async run() {
        throw new Error('not used');
      },
      async status() {
        return inspection;
      },
      async resume() {
        throw new Error('not used');
      },
    },
    resolveGithubClientFn: async () => ({
      adapter,
      config: {
        iterationCommandPrefix: '/gdh iterate',
      },
    }),
  });

  return { adapter, inspection, service, store };
}

describe('GithubSyncService', () => {
  it('emits github.sync.failed when comment sync persistence fails after GitHub succeeds', async () => {
    const { adapter, inspection, service, store } = createHarness({
      failRunWrite: true,
    });

    await expect(
      service.syncComments({
        cwd: inspection.run.repoRoot,
        runId: inspection.run.id,
      }),
    ).rejects.toThrow('persist run failed');

    expect(adapter.listPullRequestComments).toHaveBeenCalledOnce();
    expect(store.writeRunAttempts).toBe(1);
    expect(store.events.at(-1)?.type).toBe('github.sync.failed');
    expect(store.events.at(-1)?.payload).toMatchObject({
      error: 'persist run failed',
      operation: 'draft_pr_comments',
    });
  });

  it('leaves durable state untouched and emits github.sync.failed when GitHub comment sync fails', async () => {
    const adapter = createAdapter({
      listPullRequestComments: vi.fn(async () => {
        throw new Error('github unavailable');
      }),
    });
    const { inspection, service, store } = createHarness({ adapter });

    await expect(
      service.syncComments({
        cwd: inspection.run.repoRoot,
        runId: inspection.run.id,
      }),
    ).rejects.toThrow('github unavailable');

    expect(adapter.listPullRequestComments).toHaveBeenCalledOnce();
    expect(store.writeRunAttempts).toBe(0);
    expect(store.artifacts.has(store.resolveArtifactPath('github/pr-comments.json'))).toBe(false);
    expect(store.events.at(-1)?.type).toBe('github.sync.failed');
    expect(store.events.at(-1)?.payload).toMatchObject({
      error: 'github unavailable',
      operation: 'draft_pr_comments',
    });
  });

  it('preserves the original sync error when failure-event persistence also fails', async () => {
    const adapter = createAdapter({
      listPullRequestComments: vi.fn(async () => {
        throw new Error('github unavailable');
      }),
    });
    const { inspection, service, store } = createHarness({
      adapter,
      failEventAppend: true,
    });

    await expect(
      service.syncComments({
        cwd: inspection.run.repoRoot,
        runId: inspection.run.id,
      }),
    ).rejects.toThrow('github unavailable');

    expect(adapter.listPullRequestComments).toHaveBeenCalledOnce();
    expect(store.events).toHaveLength(0);
  });

  it('preserves the original issue-ingestion error when failure-event persistence also fails', async () => {
    const { inspection, service, store } = createHarness({
      failEventAppend: true,
      failTextWrite: true,
    });

    await expect(
      service.ingestIssue({
        artifactStore: store,
        emitEvent: async (type, payload) =>
          store.appendEvent({
            id: 'event-1',
            runId: inspection.run.id,
            type,
            payload,
            createdAt: '2026-03-25T10:00:00.000Z',
          }),
        githubIssue: {
          repo: {
            owner: 'acme',
            repo: 'gdh',
            fullName: 'acme/gdh',
            url: 'https://github.com/acme/gdh',
            defaultBranch: 'main',
          },
          issueNumber: 42,
          title: 'Test issue',
          body: 'Body',
          labels: [],
          url: 'https://github.com/acme/gdh/issues/42',
          state: 'open',
        },
        githubState: inspection.run.github,
        issueIngestionResult: {
          issue: {
            repo: {
              owner: 'acme',
              repo: 'gdh',
              fullName: 'acme/gdh',
              url: 'https://github.com/acme/gdh',
              defaultBranch: 'main',
            },
            issueNumber: 42,
            title: 'Test issue',
            body: 'Body',
            labels: [],
            url: 'https://github.com/acme/gdh/issues/42',
            state: 'open',
          },
          normalizedSpecPath: resolve(store.runDirectory, 'spec.normalized.json'),
          sourceArtifactPath: resolve(store.runDirectory, 'github/issue.source.md'),
          summary: 'Ingested test issue.',
        },
        manifest: inspection.manifest,
        run: inspection.run,
      }),
    ).rejects.toThrow('write text failed');

    expect(store.events).toHaveLength(0);
  });
});
