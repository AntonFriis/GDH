import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureWorkspaceSnapshot,
  captureWorkspaceState,
  createArtifactStore,
  createDiffPatch,
  createRunRelativeDirectory,
  diffWorkspaceSnapshots,
} from '../src/index';

const tempDirectories: string[] = [];

async function createTempRepo(): Promise<string> {
  const repoRoot = await mkdtemp(resolve(tmpdir(), 'gdh-artifacts-test-'));

  tempDirectories.push(repoRoot);

  execFileSync('git', ['init'], { cwd: repoRoot });
  await writeFile(resolve(repoRoot, '.gitignore'), 'runs/local/**\n!runs/local/.gitkeep\n', 'utf8');
  await mkdir(resolve(repoRoot, 'runs', 'local'), { recursive: true });
  await writeFile(resolve(repoRoot, 'runs', 'local', '.gitkeep'), '', 'utf8');
  await writeFile(resolve(repoRoot, 'README.md'), '# Temp Repo\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repoRoot });
  execFileSync(
    'git',
    ['-c', 'user.name=GDH', '-c', 'user.email=gdh@example.invalid', 'commit', '-m', 'init'],
    {
      cwd: repoRoot,
    },
  );

  return repoRoot;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('createArtifactStore', () => {
  it('writes run files and appends events', async () => {
    const repoRoot = await createTempRepo();
    const store = createArtifactStore({ repoRoot, runId: 'run-test' });

    await store.initialize();
    await store.writeJsonArtifact('normalized-spec', 'spec.normalized.json', { ok: true });
    await store.appendEvent({
      id: 'evt-1',
      runId: 'run-test',
      timestamp: '2026-03-16T20:00:00.000Z',
      type: 'run.created',
      payload: { ok: true },
    });

    const specArtifact = await readFile(
      resolve(store.runDirectory, 'spec.normalized.json'),
      'utf8',
    );
    const eventsArtifact = await readFile(resolve(store.runDirectory, 'events.jsonl'), 'utf8');

    expect(specArtifact).toContain('"ok": true');
    expect(eventsArtifact).toContain('"type":"run.created"');
    expect(store.listArtifacts().map((artifact) => artifact.path)).toEqual(
      expect.arrayContaining([
        resolve(store.runDirectory, 'spec.normalized.json'),
        resolve(store.runDirectory, 'events.jsonl'),
      ]),
    );
  }, 20_000);
});

describe('workspace snapshots', () => {
  it('captures changed files while excluding run artifacts', async () => {
    const repoRoot = await createTempRepo();
    const store = createArtifactStore({ repoRoot, runId: 'run-test' });

    await store.initialize();

    const excludedRunPrefix = createRunRelativeDirectory(repoRoot, store.runDirectory);
    const before = await captureWorkspaceSnapshot(repoRoot, {
      excludePrefixes: [excludedRunPrefix],
    });

    await mkdir(resolve(repoRoot, 'docs'), { recursive: true });
    await writeFile(resolve(repoRoot, 'README.md'), '# Temp Repo\nUpdated\n', 'utf8');
    await writeFile(resolve(repoRoot, 'docs', 'change.md'), '# Change\n', 'utf8');
    await writeFile(resolve(store.runDirectory, 'run.json'), '{}\n', 'utf8');

    const after = await captureWorkspaceSnapshot(repoRoot, {
      excludePrefixes: [excludedRunPrefix],
    });
    const changedFiles = diffWorkspaceSnapshots(before, after);
    const patch = await createDiffPatch(before, after, changedFiles);

    expect(changedFiles.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'README.md', status: 'modified' }),
        expect.objectContaining({ path: 'docs/change.md', status: 'added' }),
      ]),
    );
    expect(
      changedFiles.files.find((file) => file.path.includes('runs/local/run-test/run.json')),
    ).toBe(undefined);
    expect(patch).toContain('README.md');
    expect(patch).toContain('docs/change.md');
  });

  it('tolerates tracked files that are already missing from a dirty worktree', async () => {
    const repoRoot = await createTempRepo();

    await writeFile(resolve(repoRoot, 'tracked.md'), '# tracked\n', 'utf8');
    execFileSync('git', ['add', 'tracked.md'], { cwd: repoRoot });
    await rm(resolve(repoRoot, 'tracked.md'));

    const snapshot = await captureWorkspaceSnapshot(repoRoot);

    expect(snapshot.entries.has('tracked.md')).toBe(false);
    expect(snapshot.entries.has('README.md')).toBe(true);
  });

  it('captures a lightweight workspace continuity snapshot', async () => {
    const repoRoot = await createTempRepo();
    const expectedArtifactPath = resolve(repoRoot, 'runs', 'local', '.gitkeep');

    const snapshot = await captureWorkspaceState(repoRoot, {
      expectedArtifactPaths: [expectedArtifactPath, resolve(repoRoot, 'missing.json')],
      knownRunChangedFiles: ['README.md'],
    });

    expect(snapshot.repoRoot).toBe(repoRoot);
    expect(snapshot.expectedArtifactPaths).toContain(expectedArtifactPath);
    expect(snapshot.expectedArtifactPaths).not.toContain(resolve(repoRoot, 'missing.json'));
    expect(snapshot.knownRunChangedFiles).toEqual(['README.md']);
  });

  it('captures git status paths without truncating the first path character', async () => {
    const repoRoot = await createTempRepo();

    await mkdir(resolve(repoRoot, 'docs'), { recursive: true });
    await writeFile(resolve(repoRoot, 'README.md'), '# Temp Repo\nUpdated\n', 'utf8');
    await writeFile(resolve(repoRoot, 'docs', 'change.md'), '# Change\n', 'utf8');

    const snapshot = await captureWorkspaceState(repoRoot);

    expect(snapshot.gitAvailable).toBe(true);
    expect(snapshot.changedFiles).toEqual(expect.arrayContaining(['README.md', 'docs/change.md']));
  });
});
