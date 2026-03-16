import type { BenchmarkCase, benchmarkSuiteValues } from '@gdh/benchmark-cases';

export const graderNames = [
  'task_completion',
  'tests_passing',
  'policy_violations',
  'review_packet_fidelity',
  'artifact_completeness',
  'latency',
  'human_intervention_count',
] as const;

export interface BenchmarkScore {
  grader: (typeof graderNames)[number];
  score: number;
  notes?: string;
}

export interface BenchmarkResult {
  caseId: string;
  suite: (typeof benchmarkSuiteValues)[number];
  success: boolean;
  scores: BenchmarkScore[];
  latencyMs: number;
  costUsd?: number;
}

export interface Grader {
  name: (typeof graderNames)[number];
  grade(caseDefinition: BenchmarkCase): Promise<BenchmarkScore>;
}

export function createLedgerKey(caseDefinition: BenchmarkCase, configHash: string): string {
  return `${caseDefinition.suite}:${caseDefinition.id}:${configHash}`;
}
