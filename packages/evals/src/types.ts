import type {
  ApprovalMode,
  BenchmarkCase,
  BenchmarkRun,
  ComparisonReport,
  PolicyDecision,
  RegressionResult,
  RunStatus,
  VerificationStatus,
} from '@gdh/domain';

export interface BenchmarkCaseExecutionInput {
  approvalMode: ApprovalMode;
  cwd: string;
  policyPath?: string;
  runner: BenchmarkCase['execution']['runner'];
  specPath: string;
}

export interface BenchmarkCaseExecutionSummary {
  artifactsDirectory: string;
  policyDecision?: PolicyDecision;
  reviewPacketPath: string;
  runId: string;
  status: RunStatus;
  summary: string;
  verificationStatus: VerificationStatus;
}

export type BenchmarkCaseExecutor = (
  input: BenchmarkCaseExecutionInput,
) => Promise<BenchmarkCaseExecutionSummary>;

export interface BenchmarkTargetRunRequest {
  ciSafe?: boolean;
  executeCase?: BenchmarkCaseExecutor;
  repoRoot: string;
  targetId: string;
}

export interface BenchmarkTargetRunResult {
  artifactsDirectory: string;
  benchmarkRun: BenchmarkRun;
  comparisonReport?: ComparisonReport;
  exitCode: number;
  regressionResult?: RegressionResult;
}

export interface BenchmarkRunComparisonRequest {
  againstBaseline?: boolean;
  lhs: string;
  repoRoot: string;
  rhs?: string;
}

export interface BenchmarkComparisonResult {
  benchmarkRun: BenchmarkRun;
  comparisonReport: ComparisonReport;
  regressionResult: RegressionResult;
}

export interface BenchmarkTargetService {
  runTarget(input: BenchmarkTargetRunRequest): Promise<BenchmarkTargetRunResult>;
  compareRunArtifacts(input: BenchmarkRunComparisonRequest): Promise<BenchmarkComparisonResult>;
}
