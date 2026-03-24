import type { ApprovalMode, ApprovalPacket, Run, RunEventType, RunnerResult } from '@gdh/domain';
import { CommandCaptureSchema, RunnerResultSchema } from '@gdh/domain';
import type {
  BenchmarkCommandSummary,
  FailureListCommandSummary,
  FailureLogCommandSummary,
  FailureSummaryCommandSummary,
  GithubCommandSummary,
  RunCommandSummary,
} from './types.js';

export function createEmptyCommandCapture(note: string) {
  return CommandCaptureSchema.parse({
    commands: [],
    completeness: 'complete',
    notes: [note],
    source: 'governed_cli',
  });
}

export function createSkippedRunnerResult(summary: string): RunnerResult {
  return RunnerResultSchema.parse({
    artifactsProduced: [],
    commandCapture: createEmptyCommandCapture(
      'The write-capable runner did not execute because the policy gate stopped the run first.',
    ),
    durationMs: 0,
    exitCode: 0,
    limitations: [
      'Execution did not start because the policy gate stopped or paused the run before write-capable execution.',
    ],
    metadata: {
      executed: false,
    },
    prompt: '',
    reportedChangedFiles: [],
    reportedChangedFilesCompleteness: 'complete',
    reportedChangedFilesNotes: ['No changed files were reported because execution never started.'],
    status: 'blocked',
    stderr: '',
    stdout: '',
    summary,
  });
}

export function eventTypeForRunnerStatus(status: RunnerResult['status']): RunEventType {
  return status === 'completed' ? 'runner.completed' : 'runner.failed';
}

export function eventTypeForFinalRunStatus(status: Run['status']): RunEventType | null {
  if (status === 'completed') {
    return 'run.completed';
  }

  if (status === 'failed' || status === 'cancelled' || status === 'abandoned') {
    return 'run.failed';
  }

  return null;
}

export function exitCodeForRunStatus(status: Run['status']): number {
  if (status === 'completed') {
    return 0;
  }

  if (status === 'awaiting_approval') {
    return 2;
  }

  if (status === 'resumable') {
    return 3;
  }

  return 1;
}

export function formatTerminalSummary(summary: RunCommandSummary): string {
  return [
    `Run ${summary.status}: ${summary.runId}`,
    `Spec: ${summary.specTitle}`,
    `Summary: ${summary.summary}`,
    `Policy decision: ${summary.policyDecision ?? 'not_evaluated'}`,
    `Verification status: ${summary.verificationStatus}`,
    `Approval resolution: ${summary.approvalResolution ?? 'not_required'}`,
    summary.currentStage ? `Current stage: ${summary.currentStage}` : 'Current stage: unknown',
    summary.lastCompletedStage
      ? `Last completed stage: ${summary.lastCompletedStage}`
      : 'Last completed stage: none',
    summary.nextStage ? `Next stage: ${summary.nextStage}` : 'Next stage: none',
    summary.resumeSummary
      ? `Resume: ${summary.resumeSummary}`
      : `Resume eligible: ${summary.resumeEligible ? 'yes' : 'no'}`,
    `Artifacts: ${summary.artifactsDirectory}`,
    summary.manifestPath ? `Manifest: ${summary.manifestPath}` : 'Manifest: none',
    `Review packet: ${summary.reviewPacketPath}`,
    `Policy audit: ${summary.policyAuditPath}`,
    summary.verificationResultPath
      ? `Verification result: ${summary.verificationResultPath}`
      : 'Verification result: none',
    summary.approvalPacketPath
      ? `Approval packet: ${summary.approvalPacketPath}`
      : 'Approval packet: none',
    `Changed files: ${summary.changedFiles.length > 0 ? summary.changedFiles.join(', ') : 'none'}`,
    `Commands captured: ${
      summary.commandsExecuted.length > 0
        ? summary.commandsExecuted
            .map((command) => `${command.command} [${command.provenance}]`)
            .join(', ')
        : 'none'
    }`,
  ].join('\n');
}

export function formatGithubCommandSummary(summary: GithubCommandSummary): string {
  return [
    `GitHub ${summary.status}: ${summary.runId}`,
    `Summary: ${summary.summary}`,
    summary.branchName ? `Branch: ${summary.branchName}` : 'Branch: none',
    summary.pullRequestNumber
      ? `Draft PR: #${summary.pullRequestNumber} (${summary.pullRequestUrl ?? 'no URL recorded'})`
      : 'Draft PR: none',
    summary.commentCount !== undefined ? `Comments fetched: ${summary.commentCount}` : null,
    summary.iterationRequestCount !== undefined
      ? `Iteration requests: ${summary.iterationRequestCount}`
      : null,
    summary.iterationInputPath
      ? `Iteration input: ${summary.iterationInputPath}`
      : 'Iteration input: none',
    `Artifacts: ${summary.artifactsDirectory}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

export function formatBenchmarkCommandSummary(summary: BenchmarkCommandSummary): string {
  return [
    `Benchmark ${summary.status}: ${summary.benchmarkRunId}`,
    `Target: ${summary.targetKind} ${summary.targetId}`,
    summary.suiteId ? `Suite: ${summary.suiteId}` : 'Suite: none',
    `Summary: ${summary.summary}`,
    `Score: ${summary.score.toFixed(2)}`,
    `Cases passed: ${summary.passedCaseCount}/${summary.caseCount}`,
    summary.baselineLabel ? `Baseline: ${summary.baselineLabel}` : 'Baseline: none',
    summary.regressionStatus
      ? `Regression status: ${summary.regressionStatus}`
      : 'Regression status: not_compared',
    summary.comparisonReportPath
      ? `Comparison report: ${summary.comparisonReportPath}`
      : 'Comparison report: none',
    summary.regressionResultPath
      ? `Regression result: ${summary.regressionResultPath}`
      : 'Regression result: none',
    summary.governedRuns.length > 0 ? 'Governed runs:' : 'Governed runs: none',
    ...summary.governedRuns.map(
      (governedRun) =>
        `- ${governedRun.caseId}: ${governedRun.runId} (${governedRun.runDirectory})`,
    ),
    `Artifacts: ${summary.artifactsDirectory}`,
  ].join('\n');
}

export function formatFailureLogCommandSummary(summary: FailureLogCommandSummary): string {
  return [
    `Failure logged: ${summary.failureId}`,
    `Title: ${summary.title}`,
    `Category: ${summary.category}`,
    `Severity: ${summary.severity}`,
    `Source surface: ${summary.sourceSurface}`,
    `Status: ${summary.status}`,
    `Summary: ${summary.summary}`,
    `Record: ${summary.recordPath}`,
    `Summary JSON: ${summary.summaryPath}`,
    `Summary report: ${summary.markdownReportPath}`,
  ].join('\n');
}

export function formatFailureListCommandSummary(summary: FailureListCommandSummary): string {
  return [
    `Failure records: ${summary.matchedCount}/${summary.totalCount} matched`,
    `Summary: ${summary.summary}`,
    summary.records.length > 0 ? 'Records:' : 'Records: none',
    ...summary.records.map(
      (record) =>
        `- ${record.id} [${record.status} / ${record.severity} / ${record.category}] ${record.title}`,
    ),
  ].join('\n');
}

export function formatFailureSummaryCommandSummary(summary: FailureSummaryCommandSummary): string {
  return [
    `Failure summary generated: ${summary.totalRecords} record(s)`,
    `Active records: ${summary.activeRecords}`,
    `Summary: ${summary.summary}`,
    `Summary JSON: ${summary.summaryPath}`,
    `Summary report: ${summary.markdownReportPath}`,
  ].join('\n');
}

export function defaultApprovalMode(): ApprovalMode {
  return process.stdin.isTTY && process.stdout.isTTY ? 'interactive' : 'fail';
}

export function formatApprovalPromptSummary(packet: ApprovalPacket): string {
  return [
    `Approval required for run ${packet.runId}`,
    `Approval ID: ${packet.id}`,
    `Spec: ${packet.specTitle}`,
    `Summary: ${packet.decisionSummary}`,
    `Affected paths: ${packet.affectedPaths.length > 0 ? packet.affectedPaths.join(', ') : 'none'}`,
    `Predicted commands: ${
      packet.predictedCommands.length > 0 ? packet.predictedCommands.join(', ') : 'none'
    }`,
    `Why: ${
      packet.whyApprovalIsRequired.length > 0
        ? packet.whyApprovalIsRequired.join(' | ')
        : 'No explicit reason recorded.'
    }`,
  ].join('\n');
}
