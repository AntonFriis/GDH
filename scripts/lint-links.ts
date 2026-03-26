import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { collectMarkdownLinkIssues } from '../packages/shared/src/index.ts';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const [trackedMarkdownFiles, untrackedMarkdownFiles] = await Promise.all([
    execFileAsync('git', ['ls-files', '--', '*.md'], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 5,
    }),
    execFileAsync('git', ['ls-files', '--others', '--exclude-standard', '--', '*.md'], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 5,
    }),
  ]);

  const relativeMarkdownPaths = [trackedMarkdownFiles.stdout, untrackedMarkdownFiles.stdout]
    .join('\n')
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();

  const issues: string[] = [];

  for (const relativeMarkdownPath of relativeMarkdownPaths) {
    const filePath = resolve(repoRoot, relativeMarkdownPath);
    const content = await readFile(filePath, 'utf8');
    const fileIssues = await collectMarkdownLinkIssues({
      content,
      filePath,
      rootDirectory: repoRoot,
    });

    for (const issue of fileIssues) {
      issues.push(
        `${relative(repoRoot, filePath)}:${issue.line}:${issue.column} ${issue.message} (${issue.target})`,
      );
    }
  }

  if (issues.length > 0) {
    console.error('Markdown link validation failed:\n');

    for (const issue of issues) {
      console.error(`- ${issue}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log(
    `Checked ${relativeMarkdownPaths.length} tracked or working-tree Markdown files. All links are portable.`,
  );
}

void main();
