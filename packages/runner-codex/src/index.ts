import type {
  ApprovalPacket,
  ApprovalPolicy,
  ArtifactReference,
  Plan,
  SandboxMode,
  Spec,
  TaskUnit,
} from '@gdh/domain';
import { createIsoTimestamp } from '@gdh/shared';

export interface RunnerContext {
  repoRoot: string;
  planSummary: string;
  task: TaskUnit;
  policyDecision: {
    decision: 'allow' | 'require_approval' | 'block';
    reason: string;
  };
  priorArtifacts: ArtifactReference[];
  verificationRequirements: string[];
}

export interface RunnerResult {
  status: 'completed' | 'blocked' | 'failed';
  summary: string;
  changedFiles: string[];
  commandsExecuted: string[];
  artifactsProduced: ArtifactReference[];
  approvalNeeded?: ApprovalPacket;
}

export interface Runner {
  plan(spec: Spec): Promise<Plan>;
  execute(context: RunnerContext): Promise<RunnerResult>;
  resume(runId: string): Promise<RunnerResult>;
}

export interface RunnerDefaults {
  model: string;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  networkAccess: boolean;
}

export const defaultRunnerDefaults: RunnerDefaults = {
  model: 'gpt-5.4',
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  networkAccess: false,
};

function createPhaseZeroPlan(spec: Spec): Plan {
  return {
    id: `plan-${spec.id}`,
    specId: spec.id,
    summary: `Phase 0 placeholder plan for "${spec.title}".`,
    milestones: [
      {
        id: `milestone-${spec.id}-phase1`,
        title: 'Implement the first local governed run loop',
        description:
          'Phase 0 only prepares the workspace and interfaces. Real planning and execution begin in Phase 1.',
        status: 'pending',
      },
    ],
    assumptions: [
      'Codex CLI is the bootstrap execution path.',
      'Network access stays off by default.',
    ],
    openQuestions: ['Which low-risk smoke task should seed the first end-to-end run?'],
    verificationSteps: ['pnpm lint', 'pnpm typecheck', 'pnpm test'],
    generatedAt: createIsoTimestamp(),
  };
}

function createBlockedResult(summary: string): RunnerResult {
  return {
    status: 'blocked',
    summary,
    changedFiles: [],
    commandsExecuted: [],
    artifactsProduced: [],
  };
}

export class PhaseZeroCodexCliRunner implements Runner {
  async plan(spec: Spec): Promise<Plan> {
    return createPhaseZeroPlan(spec);
  }

  async execute(context: RunnerContext): Promise<RunnerResult> {
    return createBlockedResult(
      `Phase 0 bootstrap only: "${context.task.title}" is scaffolded but the governed Codex execution loop is not implemented yet.`,
    );
  }

  async resume(runId: string): Promise<RunnerResult> {
    return createBlockedResult(
      `Phase 0 bootstrap only: run "${runId}" cannot be resumed until the Phase 1 local run loop exists.`,
    );
  }
}

export class PhaseZeroCodexSdkRunner extends PhaseZeroCodexCliRunner {}

export function createCodexCliRunner(): Runner {
  return new PhaseZeroCodexCliRunner();
}

export function createCodexSdkRunner(): Runner {
  return new PhaseZeroCodexSdkRunner();
}
