import { resolve } from 'node:path';
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
  PolicyPack,
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
  policyPackDefaults: PolicyPack['defaults'];
}

export interface AuditRunInput {
  approvalResolution?: ApprovalResolution;
  changedFiles: ChangedFileCapture;
  commandCapture: CommandCapture;
  createdAt?: string;
  policyPackPath: string;
  priorResult: EvaluateSpecResult;
  spec: Spec;
}

export async function evaluateSpec(input: EvaluateSpecInput): Promise<EvaluateSpecResult> {
  const loadedPolicyPack = await loadPolicyPackFromFile(input.policyPackPath);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const heuristics = await loadImpactPreviewHeuristics(input.repoRoot);
  const impactPreview = generateImpactPreview({
    createdAt,
    heuristics,
    networkAccess: loadedPolicyPack.pack.defaults.networkAccess,
    plan: input.plan,
    runId: input.runId,
    sandboxMode: loadedPolicyPack.pack.defaults.sandboxMode,
    spec: input.spec,
  });
  const policyDecision = evaluatePolicy({
    approvalMode: input.approvalMode,
    createdAt,
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
      policyPackDefaults: loadedPolicyPack.pack.defaults,
    };
  }

  const packet = createApprovalPacket({
    artifactPaths: input.artifactPaths ?? [],
    createdAt,
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
    policyPackDefaults: loadedPolicyPack.pack.defaults,
  };
}

export async function auditRun(input: AuditRunInput): Promise<PolicyAuditResult> {
  const policyPackPath = resolve(input.policyPackPath);
  const recordedPolicyPackPath = resolve(input.priorResult.policyDecision.policyPackPath);

  if (policyPackPath !== recordedPolicyPackPath) {
    throw new Error(
      `Audit policy pack path mismatch: expected ${recordedPolicyPackPath} but received ${policyPackPath}.`,
    );
  }

  const { pack } = await loadPolicyPackFromFile(policyPackPath);

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
