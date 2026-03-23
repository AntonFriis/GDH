import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function execGit(
  repoRoot: string,
  args: string[],
): Promise<{ stderr: string; stdout: string }> {
  try {
    const result = await execFileAsync('git', args, {
      cwd: repoRoot,
      maxBuffer: 20 * 1024 * 1024,
      encoding: 'utf8',
    });

    return {
      stderr: result.stderr ?? '',
      stdout: result.stdout ?? '',
    };
  } catch (error) {
    const failure = error as Error & {
      code?: number;
      stderr?: string;
      stdout?: string;
    };
    const command = ['git', ...args].join(' ');
    const details =
      [failure.stderr, failure.stdout, failure.message].filter(Boolean).join('\n').trim() ||
      'Git command failed.';

    throw new Error(`${command} failed: ${details}`);
  }
}

function parseGitStatusPath(line: string): string | undefined {
  if (!line.trim()) {
    return undefined;
  }

  const pathPortion = line.slice(3).trim();

  if (!pathPortion) {
    return undefined;
  }

  return pathPortion.includes(' -> ') ? pathPortion.split(' -> ').at(-1)?.trim() : pathPortion;
}

export async function listDirtyWorkingTreePaths(repoRoot: string): Promise<string[]> {
  const { stdout } = await execGit(repoRoot, ['status', '--short', '--untracked-files=all']);

  return stdout
    .split(/\r?\n/)
    .map(parseGitStatusPath)
    .filter((value): value is string => Boolean(value));
}

export async function currentBranchName(repoRoot: string): Promise<string> {
  const { stdout } = await execGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return stdout.trim();
}

export async function localBranchExists(repoRoot: string, branchName: string): Promise<boolean> {
  try {
    await execGit(repoRoot, ['rev-parse', '--verify', `refs/heads/${branchName}`]);
    return true;
  } catch {
    return false;
  }
}

export async function checkoutBranch(
  repoRoot: string,
  branchName: string,
  options?: boolean | { create?: boolean; startPoint?: string },
): Promise<void> {
  const normalizedOptions = typeof options === 'boolean' ? { create: options } : options;
  const args = normalizedOptions?.create
    ? [
        'checkout',
        '-b',
        branchName,
        ...(normalizedOptions.startPoint ? [normalizedOptions.startPoint] : []),
      ]
    : ['checkout', branchName];
  await execGit(repoRoot, args);
}

export async function stagePaths(repoRoot: string, paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }

  await execGit(repoRoot, ['add', '--', ...paths]);
}

export async function hasStagedChanges(repoRoot: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['diff', '--cached', '--quiet', '--exit-code'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    });
    return false;
  } catch (error) {
    const failure = error as Error & { code?: number };

    if (failure.code === 1) {
      return true;
    }

    throw error;
  }
}

export async function commitStagedChanges(repoRoot: string, message: string): Promise<void> {
  await execGit(repoRoot, [
    '-c',
    'user.name=GDH',
    '-c',
    'user.email=gdh@example.invalid',
    'commit',
    '-m',
    message,
  ]);
}

export async function pushBranchToOrigin(repoRoot: string, branchName: string): Promise<void> {
  await execGit(repoRoot, ['push', '--set-upstream', 'origin', branchName]);
}

export async function readOriginRemoteUrl(repoRoot: string): Promise<string> {
  const { stdout } = await execGit(repoRoot, ['remote', 'get-url', 'origin']);
  return stdout.trim();
}

export async function readGitHead(repoRoot: string): Promise<string> {
  const { stdout } = await execGit(repoRoot, ['rev-parse', 'HEAD']);
  return stdout.trim();
}

export function parseGithubRemoteUrl(value: string): { owner: string; repo: string } | undefined {
  const trimmed = value.trim();
  const httpsMatch =
    /^https:\/\/github\.com\/(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(
      trimmed,
    );

  if (httpsMatch?.groups) {
    const owner = httpsMatch.groups.owner;
    const repo = httpsMatch.groups.repo;

    if (!owner || !repo) {
      return undefined;
    }

    return {
      owner,
      repo,
    };
  }

  const sshMatch =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)(?<owner>[A-Za-z0-9_.-]+)\/(?<repo>[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(
      trimmed,
    );

  if (sshMatch?.groups) {
    const owner = sshMatch.groups.owner;
    const repo = sshMatch.groups.repo;

    if (!owner || !repo) {
      return undefined;
    }

    return {
      owner,
      repo,
    };
  }

  return undefined;
}

export async function isGitAncestorCommit(
  repoRoot: string,
  potentialAncestor: string,
  descendant: string,
): Promise<boolean> {
  try {
    await execGit(repoRoot, ['merge-base', '--is-ancestor', potentialAncestor, descendant]);
    return true;
  } catch {
    return false;
  }
}
