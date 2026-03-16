import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  type ArtifactReference,
  type ChangedFileCapture,
  type ChangedFileRecord,
  createArtifactReference,
  type Run,
  type RunEvent,
} from '@gdh/domain';
import { createIsoTimestamp } from '@gdh/shared';

const execFileAsync = promisify(execFile);

interface WorkspaceSnapshotEntry {
  path: string;
  hash: string;
  content: Buffer;
}

export interface WorkspaceSnapshot {
  capturedAt: string;
  entries: Map<string, WorkspaceSnapshotEntry>;
}

export interface FileArtifactStoreOptions {
  repoRoot: string;
  runId: string;
  runsRoot?: string;
}

export interface ArtifactStore {
  readonly repoRoot: string;
  readonly runDirectory: string;
  readonly runId: string;
  initialize(): Promise<void>;
  writeRun(run: Run): Promise<ArtifactReference>;
  appendEvent(event: RunEvent): Promise<ArtifactReference>;
  writeJsonArtifact<T>(
    kind: string,
    relativePath: string,
    value: T,
    summary?: string,
  ): Promise<ArtifactReference>;
  writeTextArtifact(
    kind: string,
    relativePath: string,
    value: string,
    format: ArtifactReference['format'],
    summary?: string,
  ): Promise<ArtifactReference>;
  listArtifacts(): ArtifactReference[];
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll('\\', '/');
}

function artifactFormatForPath(relativePath: string): ArtifactReference['format'] {
  if (relativePath.endsWith('.json')) {
    return 'json';
  }

  if (relativePath.endsWith('.jsonl')) {
    return 'jsonl';
  }

  if (relativePath.endsWith('.md')) {
    return 'markdown';
  }

  if (relativePath.endsWith('.patch')) {
    return 'patch';
  }

  return 'text';
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

function createBufferHash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

async function listRepoFiles(repoRoot: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: repoRoot,
      maxBuffer: 20 * 1024 * 1024,
      encoding: 'utf8',
    },
  );

  return stdout
    .split('\0')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normalizeRelativePath);
}

function shouldExcludePath(filePath: string, excludePrefixes: string[]): boolean {
  return excludePrefixes.some(
    (prefix) => filePath === prefix || filePath.startsWith(`${prefix.replace(/\/+$/, '')}/`),
  );
}

export async function captureWorkspaceSnapshot(
  repoRoot: string,
  options?: { excludePrefixes?: string[] },
): Promise<WorkspaceSnapshot> {
  const excludePrefixes = (options?.excludePrefixes ?? []).map(normalizeRelativePath);
  const entries = new Map<string, WorkspaceSnapshotEntry>();
  const filePaths = await listRepoFiles(repoRoot);

  for (const filePath of filePaths) {
    if (shouldExcludePath(filePath, excludePrefixes)) {
      continue;
    }

    const absolutePath = resolve(repoRoot, filePath);
    const content = await readFile(absolutePath);

    entries.set(filePath, {
      path: filePath,
      hash: createBufferHash(content),
      content,
    });
  }

  return {
    capturedAt: createIsoTimestamp(),
    entries,
  };
}

export function diffWorkspaceSnapshots(
  beforeSnapshot: WorkspaceSnapshot,
  afterSnapshot: WorkspaceSnapshot,
): ChangedFileCapture {
  const files: ChangedFileRecord[] = [];
  const allPaths = new Set<string>([
    ...beforeSnapshot.entries.keys(),
    ...afterSnapshot.entries.keys(),
  ]);

  for (const filePath of [...allPaths].sort()) {
    const beforeEntry = beforeSnapshot.entries.get(filePath);
    const afterEntry = afterSnapshot.entries.get(filePath);

    if (!beforeEntry && afterEntry) {
      files.push({
        path: filePath,
        status: 'added',
        beforeHash: null,
        afterHash: afterEntry.hash,
      });
      continue;
    }

    if (beforeEntry && !afterEntry) {
      files.push({
        path: filePath,
        status: 'deleted',
        beforeHash: beforeEntry.hash,
        afterHash: null,
      });
      continue;
    }

    if (beforeEntry && afterEntry && beforeEntry.hash !== afterEntry.hash) {
      files.push({
        path: filePath,
        status: 'modified',
        beforeHash: beforeEntry.hash,
        afterHash: afterEntry.hash,
      });
    }
  }

  return {
    source: 'workspace_snapshot',
    notes: [
      'Changed files were derived from before/after workspace snapshots using git-tracked and non-ignored files.',
    ],
    files,
  };
}

async function writeSnapshotContent(
  rootDirectory: string,
  relativePath: string,
  entry: WorkspaceSnapshotEntry | undefined,
): Promise<string> {
  const outputPath = resolve(rootDirectory, relativePath);

  if (!entry) {
    return '/dev/null';
  }

  await ensureParentDirectory(outputPath);
  await writeFile(outputPath, entry.content);
  return outputPath;
}

async function diffFiles(
  beforePath: string,
  afterPath: string,
  relativePath: string,
): Promise<string> {
  const rewriteDiffPaths = (output: string): string => {
    return output
      .replaceAll(`a/${beforePath}`, `a/${relativePath}`)
      .replaceAll(`b/${afterPath}`, `b/${relativePath}`)
      .replaceAll(beforePath, relativePath)
      .replaceAll(afterPath, relativePath);
  };

  try {
    const { stdout } = await execFileAsync(
      'git',
      [
        'diff',
        '--no-index',
        '--binary',
        '--src-prefix',
        'a/',
        '--dst-prefix',
        'b/',
        beforePath,
        afterPath,
      ],
      {
        maxBuffer: 20 * 1024 * 1024,
        encoding: 'utf8',
      },
    );

    return rewriteDiffPaths(stdout);
  } catch (error) {
    const failed = error as NodeJS.ErrnoException & { code?: number; stdout?: string };

    if (failed.code === 1 && typeof failed.stdout === 'string') {
      return rewriteDiffPaths(failed.stdout);
    }

    throw error;
  }
}

export async function createDiffPatch(
  beforeSnapshot: WorkspaceSnapshot,
  afterSnapshot: WorkspaceSnapshot,
  changedFiles: ChangedFileCapture,
): Promise<string> {
  if (changedFiles.files.length === 0) {
    return '';
  }

  const tempDirectory = await mkdtemp(join(tmpdir(), 'gdh-diff-'));
  const beforeRoot = resolve(tempDirectory, 'before');
  const afterRoot = resolve(tempDirectory, 'after');
  const patches: string[] = [];

  try {
    for (const file of changedFiles.files) {
      const beforeEntry = beforeSnapshot.entries.get(file.path);
      const afterEntry = afterSnapshot.entries.get(file.path);
      const beforePath = await writeSnapshotContent(beforeRoot, file.path, beforeEntry);
      const afterPath = await writeSnapshotContent(afterRoot, file.path, afterEntry);
      const patch = await diffFiles(beforePath, afterPath, file.path);

      if (patch.trim()) {
        patches.push(patch.trimEnd());
      }
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }

  return patches.join('\n');
}

class FileArtifactStore implements ArtifactStore {
  readonly repoRoot: string;
  readonly runDirectory: string;
  readonly runId: string;

  private readonly artifactReferences = new Map<string, ArtifactReference>();

  constructor(options: FileArtifactStoreOptions) {
    this.repoRoot = options.repoRoot;
    this.runId = options.runId;
    this.runDirectory = resolve(
      options.runsRoot ?? join(options.repoRoot, 'runs', 'local'),
      options.runId,
    );
  }

  async initialize(): Promise<void> {
    await mkdir(this.runDirectory, { recursive: true });
  }

  listArtifacts(): ArtifactReference[] {
    return [...this.artifactReferences.values()];
  }

  async writeRun(run: Run): Promise<ArtifactReference> {
    return this.writeJsonArtifact('run-record', 'run.json', run, 'Current persisted run record.');
  }

  async appendEvent(event: RunEvent): Promise<ArtifactReference> {
    const artifactPath = resolve(this.runDirectory, 'events.jsonl');

    await this.initialize();
    await ensureParentDirectory(artifactPath);
    await appendFile(artifactPath, `${JSON.stringify(event)}\n`, 'utf8');

    const reference = createArtifactReference(
      this.runId,
      'run-events',
      artifactPath,
      'jsonl',
      createIsoTimestamp(),
      'Structured run lifecycle events.',
    );

    this.artifactReferences.set(artifactPath, reference);
    return reference;
  }

  async writeJsonArtifact<T>(
    kind: string,
    relativePath: string,
    value: T,
    summary?: string,
  ): Promise<ArtifactReference> {
    return this.writeTextArtifact(
      kind,
      relativePath,
      `${JSON.stringify(value, null, 2)}\n`,
      artifactFormatForPath(relativePath),
      summary,
    );
  }

  async writeTextArtifact(
    kind: string,
    relativePath: string,
    value: string,
    format: ArtifactReference['format'],
    summary?: string,
  ): Promise<ArtifactReference> {
    const artifactPath = resolve(this.runDirectory, relativePath);

    await this.initialize();
    await ensureParentDirectory(artifactPath);
    await writeFile(artifactPath, value, 'utf8');

    const reference = createArtifactReference(
      this.runId,
      kind,
      artifactPath,
      format,
      createIsoTimestamp(),
      summary,
    );

    this.artifactReferences.set(artifactPath, reference);
    return reference;
  }
}

export function createArtifactStore(options: FileArtifactStoreOptions): ArtifactStore {
  return new FileArtifactStore(options);
}

export function createRunRelativeDirectory(repoRoot: string, runDirectory: string): string {
  return normalizeRelativePath(relative(repoRoot, runDirectory));
}
