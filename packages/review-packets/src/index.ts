import {
  type ArtifactReference,
  type ChangedFileCapture,
  type Plan,
  type ReviewPacket,
  ReviewPacketSchema,
  type Run,
  type RunnerResult,
  type Spec,
  type VerificationStatus,
} from '@gdh/domain';

export interface ReviewPacketInput {
  artifacts: ArtifactReference[];
  changedFiles: ChangedFileCapture;
  plan: Plan;
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

  if (verificationStatus === 'not_run') {
    limitations.push('Automated verification was not run in Phase 1.');
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
    '## Limitations / Unresolved Issues',
    renderBulletList(packet.limitations, 'No explicit limitations were recorded.'),
    '',
    '## Open Questions',
    renderBulletList(packet.openQuestions, 'No open questions were recorded.'),
  ].join('\n');
}
