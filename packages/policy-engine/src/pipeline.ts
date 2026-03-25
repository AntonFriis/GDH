import type {
  ApprovalMode,
  ApprovalPacket,
  ApprovalResolution,
  ChangedFileCapture,
  CommandCapture,
  ImpactPreview,
  Plan,
  PolicyAuditResult,
  PolicyEvaluation,
  Spec,
} from '@gdh/domain';
import { createApprovalPacket, renderApprovalPacketMarkdown } from './approval.js';
import { createPolicyAudit } from './audit.js';
import { loadImpactPreviewHeuristics } from './heuristics.js';
import { loadPolicyPackFromFile } from './loading.js';
import { evaluatePolicy } from './matching.js';
import { generateImpactPreview } from './preview.js';

export interface EvaluateSpecInput {
  approvalMode: ApprovalMode;
  artifactPaths?: string[];
  createdAt?: string;
  plan: Plan;
  policyPackPath: string;
  repoRoot: string;
  runId: string;
  spec: Spec;
}

export interface EvaluateSpecResult {
  approval: {
    markdown: string;
    packet: ApprovalPacket;
  } | null;
  impactPreview: ImpactPreview;
  policyDecision: PolicyEvaluation;
}

export interface AuditRunInput {
  approvalResolution?: ApprovalResolution;
  changedFiles: ChangedFileCapture;
  commandCapture: CommandCapture;
  createdAt?: string;
  priorResult: EvaluateSpecResult;
  spec: Spec;
}

export async function evaluateSpec(input: EvaluateSpecInput): Promise<EvaluateSpecResult> {
  const loadedPolicyPack = await loadPolicyPackFromFile(input.policyPackPath);
  const heuristics = await loadImpactPreviewHeuristics(input.repoRoot);
  const impactPreview = generateImpactPreview({
    createdAt: input.createdAt,
    heuristics,
    networkAccess: loadedPolicyPack.pack.defaults.networkAccess,
    plan: input.plan,
    runId: input.runId,
    sandboxMode: loadedPolicyPack.pack.defaults.sandboxMode,
    spec: input.spec,
  });
  const policyDecision = evaluatePolicy({
    approvalMode: input.approvalMode,
    createdAt: input.createdAt,
    impactPreview,
    policyPack: loadedPolicyPack.pack,
    policyPackPath: loadedPolicyPack.path,
    spec: input.spec,
  });

  if (policyDecision.decision !== 'prompt') {
    return {
      approval: null,
      impactPreview,
      policyDecision,
    };
  }

  const packet = createApprovalPacket({
    artifactPaths: input.artifactPaths ?? [],
    createdAt: input.createdAt,
    impactPreview,
    policyDecision,
    runId: input.runId,
    spec: input.spec,
  });

  return {
    approval: {
      markdown: renderApprovalPacketMarkdown(packet),
      packet,
    },
    impactPreview,
    policyDecision,
  };
}

export async function auditRun(input: AuditRunInput): Promise<PolicyAuditResult> {
  const { pack } = await loadPolicyPackFromFile(input.priorResult.policyDecision.policyPackPath);

  return createPolicyAudit({
    approvalResolution: input.approvalResolution,
    changedFiles: input.changedFiles,
    commandCapture: input.commandCapture,
    createdAt: input.createdAt,
    impactPreview: input.priorResult.impactPreview,
    policyDecision: input.priorResult.policyDecision,
    policyPack: pack,
    spec: input.spec,
  });
}
