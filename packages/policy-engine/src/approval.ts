import type {
  ApprovalPacket,
  ApprovalResolution,
  ApprovalResolutionRecord,
  ImpactPreview,
  PolicyEvaluation,
  Spec,
} from '@gdh/domain';
import { ApprovalPacketSchema, ApprovalResolutionRecordSchema } from '@gdh/domain';
import { createStableId, unique } from './shared.js';

export interface ApprovalPacketInput {
  artifactPaths: string[];
  createdAt?: string;
  impactPreview: ImpactPreview;
  policyDecision: PolicyEvaluation;
  runId: string;
  spec: Spec;
}

export interface CreateApprovalResolutionRecordInput {
  actor?: string;
  approvalPacketId: string;
  createdAt?: string;
  notes?: string[];
  resolution: ApprovalResolution;
  runId: string;
}

export function createApprovalPacket(input: ApprovalPacketInput): ApprovalPacket {
  return ApprovalPacketSchema.parse({
    affectedPaths: input.policyDecision.affectedPaths,
    artifactPaths: input.artifactPaths,
    assumptions: input.impactPreview.uncertaintyNotes,
    createdAt: input.createdAt ?? new Date().toISOString(),
    decisionSummary: `Policy pack "${input.policyDecision.policyPackName}" requires human approval before write-capable execution can continue.`,
    id: createStableId(
      'approval',
      `${input.runId}:${input.spec.id}:${input.policyDecision.policyPackName}:${input.policyDecision.decision}`,
    ),
    matchedRules: input.policyDecision.matchedRules,
    mitigationNotes: [
      'If denied, the run stops before the write-capable runner executes.',
      `If approved, the run continues with sandbox "${input.policyDecision.sandboxMode}" and network ${input.policyDecision.networkAccess ? 'enabled' : 'disabled'}.`,
    ],
    policyDecision: input.policyDecision.decision,
    predictedCommands: input.policyDecision.matchedCommands,
    resolution: undefined,
    riskSummary: unique([
      ...input.spec.riskHints,
      ...input.policyDecision.reasons.map((reason) => reason.summary),
    ]),
    runId: input.runId,
    specTitle: input.spec.title,
    whyApprovalIsRequired: input.policyDecision.reasons.map((reason) => reason.summary),
  });
}

function renderBulletList(items: string[], fallback: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : `- ${fallback}`;
}

export function renderApprovalPacketMarkdown(packet: ApprovalPacket): string {
  return [
    `# Approval Packet: ${packet.specTitle}`,
    '',
    `- Approval ID: ${packet.id}`,
    `- Run ID: ${packet.runId}`,
    `- Policy decision: ${packet.policyDecision}`,
    `- Summary: ${packet.decisionSummary}`,
    '',
    '## Why Approval Is Required',
    renderBulletList(packet.whyApprovalIsRequired, 'No explicit reasons were recorded.'),
    '',
    '## Affected Paths',
    renderBulletList(packet.affectedPaths, 'No affected paths were predicted.'),
    '',
    '## Predicted Commands',
    renderBulletList(packet.predictedCommands, 'No commands were predicted.'),
    '',
    '## Matched Policy Rules',
    renderBulletList(
      packet.matchedRules.map((rule) => {
        const dimensions = rule.matchedOn.join(', ') || 'fallback';
        const reason = rule.reason ? ` — ${rule.reason}` : '';
        return `${rule.ruleId} [${rule.decision}] via ${dimensions}${reason}`;
      }),
      'No explicit policy rules were matched.',
    ),
    '',
    '## Risk Summary',
    renderBulletList(packet.riskSummary, 'No additional risk summary was recorded.'),
    '',
    '## Assumptions / Uncertainty',
    renderBulletList(packet.assumptions, 'No explicit uncertainty notes were recorded.'),
    '',
    '## Recommendation / Mitigations',
    renderBulletList(packet.mitigationNotes, 'No mitigation guidance was recorded.'),
    '',
    '## Artifact References',
    renderBulletList(packet.artifactPaths, 'No artifact references were recorded.'),
  ].join('\n');
}

export function createApprovalResolutionRecord(
  input: CreateApprovalResolutionRecordInput,
): ApprovalResolutionRecord {
  return ApprovalResolutionRecordSchema.parse({
    actor: input.actor ?? 'interactive-cli',
    approvalPacketId: input.approvalPacketId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    id: createStableId(
      'approval-resolution',
      `${input.runId}:${input.approvalPacketId}:${input.resolution}`,
    ),
    notes: input.notes ?? [],
    resolution: input.resolution,
    runId: input.runId,
  });
}
