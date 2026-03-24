import type {
  ApprovalMode,
  ApprovalPacket,
  ApprovalResolution,
  FailureRecord,
  PolicyDecision,
  Run,
  RunStage,
  VerificationStatus,
  WorkspaceCompatibility,
} from '@gdh/domain';
import type { BenchmarkCaseExecutionInput, BenchmarkCaseExecutionSummary } from '@gdh/evals';
import type { GithubAdapter, GithubConfig } from '@gdh/github-adapter';

export const supportedRunnerValues = ['codex-cli', 'fake'] as const;
export const supportedApprovalModeValues = ['interactive', 'fail'] as const;

export type ApprovalResolver = (packet: ApprovalPacket) => Promise<ApprovalResolution>;
export type ProgressReporter = (update: { message: string; stage: RunStage }) => void;

export interface RunCommandOptions {
  approvalMode?: ApprovalMode;
  approvalResolver?: ApprovalResolver;
  cwd?: string;
  githubAdapter?: GithubAdapter;
  githubConfig?: GithubConfig;
  githubIssue?: string;
  json?: boolean;
  policyPath?: string;
  progressReporter?: ProgressReporter;
  runner?: (typeof supportedRunnerValues)[number];
}

export interface RunCommandSummary {
  approvalPacketPath?: string;
  approvalResolution?: ApprovalResolution;
  artifactCount: number;
  artifactsDirectory: string;
  changedFiles: string[];
  commandsExecuted: Array<{
    command: string;
    isPartial: boolean;
    provenance: string;
  }>;
  exitCode: number;
  policyAuditPath: string;
  policyDecision?: PolicyDecision;
  reviewPacketPath: string;
  runId: string;
  specTitle: string;
  status: Run['status'];
  summary: string;
  manifestPath?: string;
  currentStage?: RunStage;
  lastCompletedStage?: RunStage;
  nextStage?: RunStage;
  latestProgressSummary?: string;
  resumeEligible?: boolean;
  resumeSummary?: string;
  continuityStatus?: WorkspaceCompatibility;
  verificationResultPath?: string;
  verificationStatus: VerificationStatus;
}

export interface GithubCommandOptions {
  baseBranch?: string;
  branchName?: string;
  commentId?: number;
  cwd?: string;
  githubAdapter?: GithubAdapter;
  githubConfig?: GithubConfig;
}

export interface GithubCommandSummary {
  artifactsDirectory: string;
  branchName?: string;
  commentCount?: number;
  iterationInputPath?: string;
  iterationRequestCount?: number;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  runId: string;
  status: 'blocked' | 'created' | 'inspected' | 'synced';
  summary: string;
}

export interface BenchmarkCommandSummary {
  artifactsDirectory: string;
  baselineLabel?: string;
  benchmarkRunId: string;
  caseCount: number;
  comparisonReportPath?: string;
  exitCode: number;
  governedRuns: Array<{
    caseId: string;
    runDirectory: string;
    runId: string;
  }>;
  passedCaseCount: number;
  regressionResultPath?: string;
  regressionStatus?: 'passed' | 'failed';
  score: number;
  status: 'completed' | 'failed';
  suiteId?: string;
  summary: string;
  targetId: string;
  targetKind: 'case' | 'suite';
}

export interface FailureLogCommandSummary {
  category: FailureRecord['category'];
  failureId: string;
  markdownReportPath: string;
  recordPath: string;
  severity: FailureRecord['severity'];
  sourceSurface: FailureRecord['sourceSurface'];
  status: FailureRecord['status'];
  summary: string;
  summaryPath: string;
  title: string;
}

export interface FailureListCommandSummary {
  matchedCount: number;
  records: FailureRecord[];
  summary: string;
  totalCount: number;
}

export interface FailureSummaryCommandSummary {
  activeRecords: number;
  markdownReportPath: string;
  summary: string;
  summaryPath: string;
  totalRecords: number;
}

export interface OptimizationCommandSummary {
  artifactsDirectory: string;
  baselineArtifactPath?: string;
  baselineLabel?: string;
  benchmarkRunId?: string;
  benchmarkRunPath?: string;
  benchmarkTarget: string;
  blockedPaths: string[];
  candidateId: string;
  comparisonReportPath?: string;
  decision: 'keep' | 'reject';
  decisionPath: string;
  exitCode: number;
  optimizationRunId: string;
  regressionResultPath?: string;
  regressionStatus?: 'passed' | 'failed';
  score?: number;
  scoreDelta?: number | null;
  status: 'blocked' | 'completed' | 'failed';
  summary: string;
  surfaceIds: string[];
}

export type { BenchmarkCaseExecutionInput, BenchmarkCaseExecutionSummary };
