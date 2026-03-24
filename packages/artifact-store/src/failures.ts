import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import {
  type FailureRecord,
  type FailureRecordLink,
  FailureRecordSchema,
  type FailureSummary,
  FailureSummarySchema,
  failureCategoryValues,
  failureRecordStatusValues,
  failureSeverityValues,
  failureSourceSurfaceValues,
} from '@gdh/domain';
import { createIsoTimestamp, createRunId } from '@gdh/shared';

function normalizeRelativePath(value: string): string {
  return value.replaceAll('\\', '/');
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const normalizedParent = resolve(parentPath);
  const normalizedCandidate = resolve(candidatePath);
  const relativePath = relative(normalizedParent, normalizedCandidate);

  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes(':'));
}

function humanizeIdentifier(value: string): string {
  return value
    .replaceAll(/[-_./]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function sortCountEntries<T extends string>(
  values: readonly T[],
  counts: Map<string, number>,
): Array<{ label: string; count: number }> {
  return values.map((label) => ({ label, count: counts.get(label) ?? 0 }));
}

function buildCounts<T extends string>(
  values: readonly T[],
  records: FailureRecord[],
  selector: (record: FailureRecord) => T,
): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();

  for (const record of records) {
    const label = selector(record);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return sortCountEntries(values, counts);
}

function isActiveFailureStatus(status: FailureRecord['status']): boolean {
  return status !== 'resolved' && status !== 'wont_fix';
}

export interface FailureStoreOptions {
  repoRoot: string;
  failuresRoot?: string;
}

export interface StoredFailureRecord {
  path: string;
  record: FailureRecord;
}

export interface FailureSummaryArtifacts {
  markdownPath: string;
  recordCount: number;
  summary: FailureSummary;
  summaryPath: string;
}

export interface CreateFailureRecordInput {
  benchmarkRunId?: string;
  category: FailureRecord['category'];
  description: string;
  id?: string;
  links?: FailureRecordLink[];
  owner?: string;
  reproductionNotes?: string;
  runId?: string;
  severity: FailureRecord['severity'];
  sourceSurface: FailureRecord['sourceSurface'];
  status?: FailureRecord['status'];
  suspectedCause?: string;
  timestamp?: string;
  title: string;
}

export function resolveFailuresRoot(repoRoot: string, failuresRoot?: string): string {
  return resolve(failuresRoot ?? resolve(repoRoot, 'reports', 'failures'));
}

export function resolveFailureRecordsDirectory(repoRoot: string, failuresRoot?: string): string {
  return resolve(resolveFailuresRoot(repoRoot, failuresRoot), 'records');
}

export function resolveFailureSummaryPath(repoRoot: string, failuresRoot?: string): string {
  return resolve(resolveFailuresRoot(repoRoot, failuresRoot), 'summary.latest.json');
}

export function resolveFailureSummaryMarkdownPath(repoRoot: string, failuresRoot?: string): string {
  return resolve(resolveFailuresRoot(repoRoot, failuresRoot), 'summary.latest.md');
}

export function toFailureLinkPath(repoRoot: string, path: string): string {
  const resolvedPath = resolve(repoRoot, path);

  if (isPathInside(repoRoot, resolvedPath)) {
    return normalizeRelativePath(relative(repoRoot, resolvedPath));
  }

  return normalizeRelativePath(path);
}

export function createFailureRecord(input: CreateFailureRecordInput): FailureRecord {
  return FailureRecordSchema.parse({
    id: input.id ?? createRunId(`failure-${input.title}`),
    timestamp: input.timestamp ?? createIsoTimestamp(),
    category: input.category,
    severity: input.severity,
    sourceSurface: input.sourceSurface,
    runId: input.runId,
    benchmarkRunId: input.benchmarkRunId,
    title: input.title,
    description: input.description,
    reproductionNotes: input.reproductionNotes ?? '',
    suspectedCause: input.suspectedCause,
    status: input.status ?? 'open',
    owner: input.owner ?? 'unassigned',
    links: input.links ?? [],
  });
}

export async function writeFailureRecord(
  options: FailureStoreOptions,
  record: FailureRecord,
): Promise<string> {
  const recordsDirectory = resolveFailureRecordsDirectory(options.repoRoot, options.failuresRoot);
  const recordPath = resolve(recordsDirectory, `${record.id}.json`);

  await mkdir(recordsDirectory, { recursive: true });
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  return recordPath;
}

export async function listFailureRecords(
  options: FailureStoreOptions,
): Promise<StoredFailureRecord[]> {
  const recordsDirectory = resolveFailureRecordsDirectory(options.repoRoot, options.failuresRoot);
  let entries: string[] = [];

  try {
    entries = (await readdir(recordsDirectory))
      .filter((entry) => entry.endsWith('.json'))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    entries = [];
  }

  const records = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(recordsDirectory, entry);
      const rawValue = JSON.parse(await readFile(path, 'utf8'));

      return {
        path,
        record: FailureRecordSchema.parse(rawValue),
      };
    }),
  );

  return records.sort((left, right) => right.record.timestamp.localeCompare(left.record.timestamp));
}

export function createFailureSummary(
  records: FailureRecord[],
  generatedAt = createIsoTimestamp(),
): FailureSummary {
  const sortedRecords = [...records].sort((left, right) =>
    right.timestamp.localeCompare(left.timestamp),
  );

  return FailureSummarySchema.parse({
    generatedAt,
    totalRecords: sortedRecords.length,
    activeRecords: sortedRecords.filter((record) => isActiveFailureStatus(record.status)).length,
    countsByCategory: buildCounts(
      failureCategoryValues,
      sortedRecords,
      (record) => record.category,
    ),
    countsBySeverity: buildCounts(
      failureSeverityValues,
      sortedRecords,
      (record) => record.severity,
    ),
    countsBySourceSurface: buildCounts(
      failureSourceSurfaceValues,
      sortedRecords,
      (record) => record.sourceSurface,
    ),
    countsByStatus: buildCounts(
      failureRecordStatusValues,
      sortedRecords,
      (record) => record.status,
    ),
    latestRecords: sortedRecords.slice(0, 10),
  });
}

export function renderFailureSummaryMarkdown(summary: FailureSummary): string {
  const lines: string[] = [
    '# Failure Summary',
    '',
    `Generated: ${summary.generatedAt}`,
    `Total records: ${summary.totalRecords}`,
    `Active records: ${summary.activeRecords}`,
    '',
    '## Counts By Category',
    '',
  ];

  for (const entry of summary.countsByCategory) {
    lines.push(`- ${humanizeIdentifier(entry.label)}: ${entry.count}`);
  }

  lines.push('', '## Counts By Severity', '');

  for (const entry of summary.countsBySeverity) {
    lines.push(`- ${humanizeIdentifier(entry.label)}: ${entry.count}`);
  }

  lines.push('', '## Counts By Status', '');

  for (const entry of summary.countsByStatus) {
    lines.push(`- ${humanizeIdentifier(entry.label)}: ${entry.count}`);
  }

  lines.push('', '## Counts By Source Surface', '');

  for (const entry of summary.countsBySourceSurface) {
    lines.push(`- ${humanizeIdentifier(entry.label)}: ${entry.count}`);
  }

  lines.push('', '## Latest Records', '');

  if (summary.latestRecords.length === 0) {
    lines.push('No failure records have been logged yet.');
    return `${lines.join('\n')}\n`;
  }

  for (const record of summary.latestRecords) {
    lines.push(
      `- [${record.id}] ${record.title} (${humanizeIdentifier(record.category)} / ${humanizeIdentifier(record.severity)} / ${humanizeIdentifier(record.status)})`,
    );
    lines.push(`  Timestamp: ${record.timestamp}`);
    lines.push(`  Surface: ${humanizeIdentifier(record.sourceSurface)}`);

    if (record.runId) {
      lines.push(`  Run: ${record.runId}`);
    }

    if (record.benchmarkRunId) {
      lines.push(`  Benchmark: ${record.benchmarkRunId}`);
    }

    if (record.links.length > 0) {
      lines.push(
        `  Links: ${record.links.map((link) => `${link.label} (${link.path})`).join(', ')}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

export async function writeFailureSummaryArtifacts(
  options: FailureStoreOptions,
): Promise<FailureSummaryArtifacts> {
  const records = await listFailureRecords(options);
  const summary = createFailureSummary(records.map((entry) => entry.record));
  const failuresRoot = resolveFailuresRoot(options.repoRoot, options.failuresRoot);
  const summaryPath = resolveFailureSummaryPath(options.repoRoot, options.failuresRoot);
  const markdownPath = resolveFailureSummaryMarkdownPath(options.repoRoot, options.failuresRoot);

  await mkdir(failuresRoot, { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, renderFailureSummaryMarkdown(summary), 'utf8');

  return {
    summary,
    recordCount: records.length,
    summaryPath,
    markdownPath,
  };
}

export function defaultFailureLinkLabel(path: string): string {
  return basename(path) || path;
}
