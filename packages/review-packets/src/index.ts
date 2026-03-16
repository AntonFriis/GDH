import {
  type ApprovalResolution,
  type ArtifactReference,
  type ChangedFileCapture,
  type Plan,
  type PolicyAuditResult,
  type PolicyEvaluation,
  type ReviewPacket,
  ReviewPacketSchema,
  type Run,
  type RunnerResult,
  type Spec,
  type VerificationStatus,
} from '@gdh/domain';

export interface ReviewPacketInput {
  approvalResolution?: ApprovalResolution;
  artifacts: ArtifactReference[];
  changedFiles: ChangedFileCapture;
  plan: Plan;
  policyAudit?: PolicyAuditResult;
  policyDecision: PolicyEvaluation;
  run: Run;
  runnerResult: RunnerResult;
  spec: Spec;
  verificationStatus?: VerificationStatus;
}

function diffSummaryLines(changedFiles: ChangedFileCapture): string[] {
  const counts = changedFiles.files.reduce(
    (summary, file) => {
      summary[file.status] += 1;
      return summary;
    },
    { added: 0, modified: 0, deleted: 0 },
  );
  const fileList = changedFiles.files.slice(0, 8).map((file) => `${file.status}: ${file.path}`);
  const summary = [
    `${changedFiles.files.length} file(s) changed`,
    `${counts.added} added`,
    `${counts.modified} modified`,
    `${counts.deleted} deleted`,
  ];

  return changedFiles.files.length > 0
    ? summary.concat(fileList)
    : ['No non-artifact file changes were captured.'];
}

export function createReviewPacket(input: ReviewPacketInput): ReviewPacket {
  const verificationStatus = input.verificationStatus ?? 'not_run';
  const limitations = [...input.runnerResult.limitations];
  const policyAudit = input.policyAudit;

  if (verificationStatus === 'not_run') {
    limitations.push('Automated verification beyond the Phase 2 policy audit was not run yet.');
  }

  if (policyAudit?.status === 'scope_drift') {
    limitations.push(policyAudit.summary);
  }

  if (policyAudit?.status === 'policy_breach') {
    limitations.push(policyAudit.summary);
  }

  return ReviewPacketSchema.parse({
    id: `review-${input.run.id}`,
    runId: input.run.id,
    title: `Review Packet: ${input.spec.title}`,
    specTitle: input.spec.title,
    status: input.runnerResult.status,
    planSummary: input.plan.summary,
    runnerSummary: input.runnerResult.summary,
    changedFiles: input.changedFiles.files.map((file) => file.path),
    commandsExecuted: input.runnerResult.commandCapture.commands,
    artifactPaths: input.artifacts.map((artifact) => artifact.path),
    diffSummary: diffSummaryLines(input.changedFiles),
    policyDecision: input.policyDecision.decision,
    policySummary:
      input.policyDecision.reasons[0]?.summary ??
      input.policyDecision.notes[0] ??
      'No policy summary was recorded.',
    approvalResolution: input.approvalResolution,
    policyAuditStatus: policyAudit?.status ?? 'clean',
    policyAuditSummary:
      policyAudit?.summary ??
      'Policy audit did not record any unexpected paths or commands after the run.',
    limitations: [...new Set(limitations)],
    openQuestions: input.plan.openQuestions,
    verificationStatus,
    createdAt: input.run.updatedAt,
  });
}

function renderBulletList(items: string[], fallback: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : `- ${fallback}`;
}

export function renderReviewPacketMarkdown(packet: ReviewPacket): string {
  return [
    `# ${packet.title}`,
    '',
    `- Run ID: ${packet.runId}`,
    `- Spec title: ${packet.specTitle}`,
    `- Status: ${packet.status}`,
    `- Verification status: ${packet.verificationStatus}`,
    '',
    '## Plan Summary',
    packet.planSummary,
    '',
    '## Changed Files',
    renderBulletList(packet.changedFiles, 'No non-artifact file changes were captured.'),
    '',
    '## Commands Executed',
    renderBulletList(
      packet.commandsExecuted.map((command) => {
        const suffix = command.isPartial ? ' (partial)' : '';
        return `${command.command} [${command.provenance}]${suffix}`;
      }),
      'No commands were captured.',
    ),
    '',
    '## Runner Summary',
    packet.runnerSummary,
    '',
    '## Artifact Paths',
    renderBulletList(packet.artifactPaths, 'No artifacts were recorded.'),
    '',
    '## Diff Summary',
    renderBulletList(packet.diffSummary, 'No diff summary was available.'),
    '',
    '## Policy Decision',
    `- Decision: ${packet.policyDecision}`,
    `- Summary: ${packet.policySummary}`,
    `- Approval resolution: ${packet.approvalResolution ?? 'not_required'}`,
    '',
    '## Policy Audit',
    `- Status: ${packet.policyAuditStatus}`,
    `- Summary: ${packet.policyAuditSummary}`,
    '',
    '## Limitations / Unresolved Issues',
    renderBulletList(packet.limitations, 'No explicit limitations were recorded.'),
    '',
    '## Open Questions',
    renderBulletList(packet.openQuestions, 'No open questions were recorded.'),
  ].join('\n');
}
