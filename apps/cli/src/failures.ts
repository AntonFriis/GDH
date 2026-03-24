import {
  createFailureRecord,
  defaultFailureLinkLabel,
  listFailureRecords,
  toFailureLinkPath,
  writeFailureRecord,
  writeFailureSummaryArtifacts,
} from '@gdh/artifact-store';
import type { FailureRecord } from '@gdh/domain';
import { findRepoRoot } from '@gdh/shared';
import type {
  FailureListCommandSummary,
  FailureLogCommandSummary,
  FailureSummaryCommandSummary,
} from './types.js';

export interface LogFailureOptions {
  benchmarkRunId?: string;
  category: FailureRecord['category'];
  cwd?: string;
  description: string;
  id?: string;
  links?: string[];
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

export interface ListFailureOptions {
  category?: FailureRecord['category'];
  cwd?: string;
  owner?: string;
  severity?: FailureRecord['severity'];
  sourceSurface?: FailureRecord['sourceSurface'];
  status?: FailureRecord['status'];
}

function matchesFailureFilters(record: FailureRecord, options: ListFailureOptions): boolean {
  return (
    (!options.category || record.category === options.category) &&
    (!options.severity || record.severity === options.severity) &&
    (!options.sourceSurface || record.sourceSurface === options.sourceSurface) &&
    (!options.status || record.status === options.status) &&
    (!options.owner || record.owner === options.owner)
  );
}

export async function logFailureRecord(
  options: LogFailureOptions,
): Promise<FailureLogCommandSummary> {
  const repoRoot = await findRepoRoot(options.cwd ?? process.cwd());
  const record = createFailureRecord({
    benchmarkRunId: options.benchmarkRunId,
    category: options.category,
    description: options.description,
    id: options.id,
    links: (options.links ?? []).map((path) => ({
      label: defaultFailureLinkLabel(path),
      path: toFailureLinkPath(repoRoot, path),
    })),
    owner: options.owner,
    reproductionNotes: options.reproductionNotes,
    runId: options.runId,
    severity: options.severity,
    sourceSurface: options.sourceSurface,
    status: options.status,
    suspectedCause: options.suspectedCause,
    timestamp: options.timestamp,
    title: options.title,
  });
  const recordPath = await writeFailureRecord({ repoRoot }, record);
  const summaryArtifacts = await writeFailureSummaryArtifacts({ repoRoot });

  return {
    failureId: record.id,
    title: record.title,
    category: record.category,
    severity: record.severity,
    sourceSurface: record.sourceSurface,
    status: record.status,
    summary: `Recorded failure "${record.title}" and refreshed the failure summary artifacts.`,
    recordPath,
    summaryPath: summaryArtifacts.summaryPath,
    markdownReportPath: summaryArtifacts.markdownPath,
  };
}

export async function listRecordedFailures(
  options: ListFailureOptions = {},
): Promise<FailureListCommandSummary> {
  const repoRoot = await findRepoRoot(options.cwd ?? process.cwd());
  const storedRecords = await listFailureRecords({ repoRoot });
  const records = storedRecords
    .map((entry) => entry.record)
    .filter((record) => matchesFailureFilters(record, options));

  return {
    totalCount: storedRecords.length,
    matchedCount: records.length,
    records,
    summary:
      records.length === storedRecords.length
        ? 'Listed all recorded failures.'
        : 'Listed the filtered subset of recorded failures.',
  };
}

export async function generateFailureSummary(
  options: { cwd?: string } = {},
): Promise<FailureSummaryCommandSummary> {
  const repoRoot = await findRepoRoot(options.cwd ?? process.cwd());
  const summaryArtifacts = await writeFailureSummaryArtifacts({ repoRoot });

  return {
    totalRecords: summaryArtifacts.summary.totalRecords,
    activeRecords: summaryArtifacts.summary.activeRecords,
    summary: 'Generated the latest JSON and Markdown failure summaries.',
    summaryPath: summaryArtifacts.summaryPath,
    markdownReportPath: summaryArtifacts.markdownPath,
  };
}
