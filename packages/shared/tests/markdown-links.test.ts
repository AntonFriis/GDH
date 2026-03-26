import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectMarkdownLinkIssues } from '../src/index';

describe('collectMarkdownLinkIssues', () => {
  it('accepts existing repo-relative links from nested docs', async () => {
    const rootDirectory = await mkdtemp(resolve(tmpdir(), 'gdh-links-ok-'));
    const docsDirectory = resolve(rootDirectory, 'docs');
    const reportsDirectory = resolve(rootDirectory, 'reports');

    await mkdir(docsDirectory, { recursive: true });
    await mkdir(reportsDirectory, { recursive: true });
    await writeFile(resolve(rootDirectory, 'README.md'), '# Root\n', 'utf8');
    await writeFile(resolve(reportsDirectory, 'benchmark-summary.md'), '# Report\n', 'utf8');

    const issues = await collectMarkdownLinkIssues({
      content:
        '[README](../README.md)\n[Benchmark](../reports/benchmark-summary.md)\n[Anchor](#known-limitations)\n',
      filePath: resolve(docsDirectory, 'guide.md'),
      rootDirectory,
    });

    expect(issues).toEqual([]);
  });

  it('flags absolute filesystem links', async () => {
    const rootDirectory = await mkdtemp(resolve(tmpdir(), 'gdh-links-abs-'));

    const issues = await collectMarkdownLinkIssues({
      content: '[Bad](/workspace/GDH/docs/architecture-overview.md)\n',
      filePath: resolve(rootDirectory, 'README.md'),
      rootDirectory,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('not portable');
  });

  it('flags broken repo-relative links', async () => {
    const rootDirectory = await mkdtemp(resolve(tmpdir(), 'gdh-links-missing-'));
    await writeFile(resolve(rootDirectory, 'README.md'), '# Root\n', 'utf8');

    const issues = await collectMarkdownLinkIssues({
      content: '[Missing](docs/does-not-exist.md)\n',
      filePath: resolve(rootDirectory, 'README.md'),
      rootDirectory,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('does not exist');
  });
});
