import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface MarkdownLinkIssue {
  column: number;
  line: number;
  message: string;
  target: string;
}

const markdownLinkPattern = /!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const allowedExternalLinkPattern = /^(?:https?:|mailto:|tel:|data:|#)/i;
const absoluteFilesystemLinkPattern = /^(?:\/|[A-Za-z]:[\\/]|file:)/;

function resolveLineAndColumn(
  content: string,
  index: number,
): {
  column: number;
  line: number;
} {
  const lines = content.slice(0, index).split('\n');
  const line = lines.length;
  const column = (lines.at(-1)?.length ?? 0) + 1;

  return {
    column,
    line,
  };
}

function splitMarkdownTarget(target: string): { path: string } {
  const hashIndex = target.indexOf('#');

  if (hashIndex === -1) {
    return {
      path: target,
    };
  }

  return {
    path: target.slice(0, hashIndex),
  };
}

export async function collectMarkdownLinkIssues(input: {
  content: string;
  filePath: string;
  rootDirectory: string;
}): Promise<MarkdownLinkIssue[]> {
  const issues: MarkdownLinkIssue[] = [];

  for (const match of input.content.matchAll(markdownLinkPattern)) {
    const target = match[1];
    const index = match.index ?? 0;

    if (!target || allowedExternalLinkPattern.test(target)) {
      continue;
    }

    const location = resolveLineAndColumn(input.content, index);

    if (absoluteFilesystemLinkPattern.test(target)) {
      issues.push({
        ...location,
        message:
          'Markdown links must be repo-relative or external. Absolute filesystem and root-relative links are not portable.',
        target,
      });
      continue;
    }

    const { path } = splitMarkdownTarget(target);

    if (!path) {
      continue;
    }

    const resolvedTargetPath = resolve(dirname(input.filePath), path);

    try {
      await access(resolvedTargetPath);
    } catch {
      issues.push({
        ...location,
        message: 'Markdown link target does not exist.',
        target,
      });
    }
  }

  return issues;
}
