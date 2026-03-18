import {
  type ApprovalPacket,
  type ApprovalResolution,
  type ArtifactReference,
  type ChangedFileCapture,
  type ClaimVerificationSummary,
  type Plan,
  type PolicyAuditResult,
  type PolicyEvaluation,
  type ReviewPacket,
  ReviewPacketSchema,
  type Run,
  type RunCompletionDecision,
  type RunGithubState,
  type RunnerResult,
  type Spec,
  type VerificationCommandResult,
  type VerificationStatus,
} from '@gdh/domain';
import { hasUnsupportedCertaintyClaim } from '@gdh/shared';

export interface ReviewPacketInput {
  approvalPacket?: ApprovalPacket;
  approvalResolution?: ApprovalResolution;
  artifacts: ArtifactReference[];
  changedFiles: ChangedFileCapture;
  claimVerification: ClaimVerificationSummary;
  plan: Plan;
  policyAudit?: PolicyAuditResult;
  policyDecision: PolicyEvaluation;
  run: Run;
  runCompletion: RunCompletionDecision;
  githubState?: RunGithubState;
  runStatus?: Run['status'];
  runnerResult: RunnerResult;
  spec: Spec;
  verificationCommands: VerificationCommandResult[];
  verificationStatus: VerificationStatus;
  verificationSummary: string;
  verifiedAt?: string;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
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

function buildOverview(input: ReviewPacketInput): string {
  const mandatoryChecks = input.verificationCommands.filter((command) => command.mandatory);
  const passedMandatoryChecks = mandatoryChecks.filter((command) => command.status === 'passed');

  return [
    `Requested objective recorded in spec "${input.spec.title}"`,
    `Files changed: ${input.changedFiles.files.length}`,
    `Mandatory verification commands passed: ${passedMandatoryChecks.length}/${mandatoryChecks.length}`,
    `Verification status: ${input.verificationStatus}`,
  ].join(' | ');
}

function buildRunnerReportedSummary(summary: string): string {
  if (!summary.trim()) {
    return 'The runner did not return a non-empty summary.';
  }

  if (hasUnsupportedCertaintyClaim(summary)) {
    return 'The raw runner summary included unsupported certainty language, so this packet relies on the structured change, policy, and verification evidence instead.';
  }

  return summary;
}

function buildApprovalSection(input: ReviewPacketInput): ReviewPacket['approvals'] {
  const required = input.policyDecision.requiredApprovalMode !== null;

  if (!required) {
    return {
      required: false,
      status: 'not_required',
      summary: 'The policy decision did not require a human approval step for this run.',
      approvalPacketId: undefined,
    };
  }

  if (!input.approvalResolution) {
    return {
      required: true,
      status: 'pending',
      summary: 'The policy decision required approval, but no approval resolution was recorded.',
      approvalPacketId: input.approvalPacket?.id,
    };
  }

  return {
    required: true,
    status: input.approvalResolution,
    summary:
      input.approvalResolution === 'approved'
        ? 'The policy decision required approval and an approval resolution was recorded as approved.'
        : `The policy decision required approval and the recorded resolution was ${input.approvalResolution}.`,
    approvalPacketId: input.approvalPacket?.id,
  };
}

function buildVerificationFailures(commands: VerificationCommandResult[]): string[] {
  return commands
    .filter((command) => command.mandatory && command.status !== 'passed')
    .map((command) => `${command.phase}: ${command.command}`);
}

function buildRollbackHint(changedFiles: ChangedFileCapture): string {
  if (changedFiles.files.length === 0) {
    return 'No non-artifact file changes were captured, so there is no rollback target beyond the run artifacts themselves.';
  }

  const fileList = changedFiles.files.map((file) => file.path).join(', ');

  return `Inspect diff.patch and revert the touched paths manually or with git restore if needed: ${fileList}`;
}

function renderBulletList(items: string[], fallback: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : `- ${fallback}`;
}

export function createReviewPacket(input: ReviewPacketInput): ReviewPacket {
  const policyAudit = input.policyAudit;
  const runnerSummarySanitized =
    buildRunnerReportedSummary(input.runnerResult.summary) !== input.runnerResult.summary;
  const risks = unique([
    ...input.spec.riskHints,
    ...input.policyDecision.reasons.map((reason) => reason.summary),
    ...(policyAudit ? [policyAudit.summary] : []),
  ]);
  const limitations = unique([
    ...input.runnerResult.limitations,
    ...(runnerSummarySanitized
      ? [
          'The raw runner summary used unsupported certainty language and was replaced with an evidence-based note in this packet.',
        ]
      : []),
    ...(policyAudit && policyAudit.status !== 'clean' ? [policyAudit.summary] : []),
    ...(input.claimVerification.failedClaims > 0 ? [input.claimVerification.summary] : []),
    ...(input.runCompletion.canComplete ? [] : [input.runCompletion.summary]),
  ]);

  return ReviewPacketSchema.parse({
    id: `review-${input.run.id}`,
    runId: input.run.id,
    title: `Review Packet: ${input.spec.title}`,
    specTitle: input.spec.title,
    runStatus: input.runStatus ?? input.runCompletion.finalStatus,
    packetStatus: input.runCompletion.canComplete ? 'ready' : 'verification_failed',
    objective: input.spec.objective,
    overview: buildOverview(input),
    planSummary: input.plan.summary,
    runnerReportedSummary: buildRunnerReportedSummary(input.runnerResult.summary),
    filesChanged: input.changedFiles.files.map((file) => file.path),
    commandsExecuted: input.runnerResult.commandCapture.commands,
    checksRun: input.verificationCommands,
    artifactPaths: input.artifacts.map((artifact) => artifact.path),
    diffSummary: diffSummaryLines(input.changedFiles),
    policy: {
      decision: input.policyDecision.decision,
      summary:
        input.policyDecision.reasons[0]?.summary ??
        input.policyDecision.notes[0] ??
        'No policy summary was recorded.',
      auditStatus: policyAudit?.status ?? 'clean',
      auditSummary:
        policyAudit?.summary ??
        'Policy audit did not record any unexpected paths or commands after the run.',
      matchedRuleIds: input.policyDecision.matchedRules.map((rule) => rule.ruleId),
    },
    approvals: buildApprovalSection(input),
    risks,
    limitations,
    openQuestions: input.plan.openQuestions,
    verification: {
      status: input.verificationStatus,
      summary: input.verificationSummary,
      mandatoryFailures: buildVerificationFailures(input.verificationCommands),
      lastVerifiedAt: input.verifiedAt,
    },
    claimVerification: input.claimVerification,
    rollbackHint: buildRollbackHint(input.changedFiles),
    github: input.githubState
      ? {
          issue: input.githubState.issue,
          branch: input.githubState.branch,
          pullRequest: input.githubState.pullRequest,
        }
      : undefined,
    createdAt: input.verifiedAt ?? input.run.updatedAt,
  });
}

export function renderReviewPacketMarkdown(packet: ReviewPacket): string {
  return [
    `# ${packet.title}`,
    '',
    `- Run ID: ${packet.runId}`,
    `- Spec title: ${packet.specTitle}`,
    `- Run status: ${packet.runStatus}`,
    `- Packet status: ${packet.packetStatus}`,
    `- Verification status: ${packet.verification.status}`,
    '',
    '## Objective',
    packet.objective,
    '',
    '## Overview',
    packet.overview,
    '',
    '## Plan Summary',
    packet.planSummary,
    '',
    '## Files Changed',
    renderBulletList(packet.filesChanged, 'No non-artifact file changes were captured.'),
    '',
    '## Runner Commands Executed',
    renderBulletList(
      packet.commandsExecuted.map((command) => {
        const suffix = command.isPartial ? ' (partial)' : '';
        return `${command.command} [${command.provenance}]${suffix}`;
      }),
      'No commands were captured.',
    ),
    '',
    '## Tests / Checks Run',
    renderBulletList(
      packet.checksRun.map(
        (command) =>
          `${command.phase} | ${command.mandatory ? 'mandatory' : 'optional'} | ${command.status} | ${command.command}`,
      ),
      'No verification commands were recorded.',
    ),
    '',
    '## Runner-Reported Summary',
    packet.runnerReportedSummary,
    '',
    '## Policy Decisions',
    `- Decision: ${packet.policy.decision}`,
    `- Summary: ${packet.policy.summary}`,
    `- Policy audit status: ${packet.policy.auditStatus}`,
    `- Policy audit summary: ${packet.policy.auditSummary}`,
    `- Matched rules: ${packet.policy.matchedRuleIds.length > 0 ? packet.policy.matchedRuleIds.join(', ') : 'none'}`,
    '',
    '## Approvals Required And Granted',
    `- Required: ${packet.approvals.required ? 'yes' : 'no'}`,
    `- Status: ${packet.approvals.status}`,
    `- Summary: ${packet.approvals.summary}`,
    `- Approval packet ID: ${packet.approvals.approvalPacketId ?? 'n/a'}`,
    '',
    '## Risks',
    renderBulletList(
      packet.risks,
      'No explicit risks were recorded beyond the default governed-run caveats.',
    ),
    '',
    '## Open Questions',
    renderBulletList(packet.openQuestions, 'No open questions were recorded.'),
    '',
    '## Verification Summary',
    `- Status: ${packet.verification.status}`,
    `- Summary: ${packet.verification.summary}`,
    `- Last verified at: ${packet.verification.lastVerifiedAt ?? 'not recorded'}`,
    renderBulletList(
      packet.verification.mandatoryFailures,
      'No mandatory verification command failures were recorded.',
    ),
    '',
    '## Claim Verification Summary',
    `- Status: ${packet.claimVerification.status}`,
    `- Summary: ${packet.claimVerification.summary}`,
    `- Claims checked: ${packet.claimVerification.totalClaims}`,
    `- Claims passed: ${packet.claimVerification.passedClaims}`,
    `- Claims failed: ${packet.claimVerification.failedClaims}`,
    renderBulletList(
      packet.claimVerification.results
        .filter((result) => result.status === 'failed')
        .map((result) => `${result.claim} — ${result.reason}`),
      'No unsupported claims were detected.',
    ),
    '',
    '## Limitations / Unresolved Issues',
    renderBulletList(packet.limitations, 'No explicit limitations were recorded.'),
    '',
    '## Rollback / Revert Hint',
    packet.rollbackHint,
    '',
    ...(packet.github
      ? [
          '## GitHub Delivery State',
          `- Issue: ${
            packet.github.issue
              ? `${packet.github.issue.repo.fullName}#${packet.github.issue.issueNumber}`
              : 'n/a'
          }`,
          `- Branch: ${packet.github.branch?.name ?? 'n/a'}`,
          `- Draft PR: ${
            packet.github.pullRequest
              ? `#${packet.github.pullRequest.pullRequestNumber} (${packet.github.pullRequest.url})`
              : 'not published'
          }`,
          '',
        ]
      : []),
    '## Artifact Paths',
    renderBulletList(packet.artifactPaths, 'No artifacts were recorded.'),
  ].join('\n');
}

export function renderDraftPullRequestBody(packet: ReviewPacket): string {
  const verificationLines = [
    `- Verification status: ${packet.verification.status}`,
    `- Verification summary: ${packet.verification.summary}`,
    `- Claim verification: ${packet.claimVerification.status} (${packet.claimVerification.passedClaims}/${packet.claimVerification.totalClaims} claims passed)`,
    `- Mandatory failures: ${
      packet.verification.mandatoryFailures.length > 0
        ? packet.verification.mandatoryFailures.join(', ')
        : 'none'
    }`,
  ];
  const approvalLines = [
    `- Approval required: ${packet.approvals.required ? 'yes' : 'no'}`,
    `- Approval status: ${packet.approvals.status}`,
    `- Approval summary: ${packet.approvals.summary}`,
    `- Policy decision: ${packet.policy.decision}`,
    `- Policy audit: ${packet.policy.auditStatus} — ${packet.policy.auditSummary}`,
  ];
  const changeSummary = [
    `- ${packet.overview}`,
    `- ${packet.runnerReportedSummary}`,
    ...packet.diffSummary.map((line) => `- ${line}`),
  ];

  return [
    `# ${packet.specTitle}`,
    '',
    '## Objective',
    packet.objective,
    '',
    '## Summary Of Changes',
    ...changeSummary,
    '',
    '## Files Changed',
    ...(packet.filesChanged.length > 0
      ? packet.filesChanged.map((filePath) => `- ${filePath}`)
      : ['- No non-artifact file changes were captured.']),
    '',
    '## Verification Summary',
    ...verificationLines,
    '',
    '## Approvals And Policy',
    ...approvalLines,
    '',
    '## Risks And Open Questions',
    ...(packet.risks.length > 0
      ? packet.risks.map((risk) => `- ${risk}`)
      : ['- No explicit risks recorded.']),
    ...(packet.openQuestions.length > 0
      ? packet.openQuestions.map((question) => `- Open question: ${question}`)
      : ['- No open questions recorded.']),
    '',
    '## Limitations',
    ...(packet.limitations.length > 0
      ? packet.limitations.map((item) => `- ${item}`)
      : ['- No explicit limitations recorded.']),
    '',
    '## Artifacts',
    ...packet.artifactPaths.slice(0, 8).map((artifactPath) => `- ${artifactPath}`),
    ...(packet.artifactPaths.length > 8
      ? [`- Additional artifacts recorded locally: ${packet.artifactPaths.length - 8}`]
      : []),
    '',
    '## Rollback Hint',
    packet.rollbackHint,
  ].join('\n');
}

export function renderDraftPullRequestComment(packet: ReviewPacket): string {
  return [
    `Governed review packet synced for run \`${packet.runId}\`.`,
    '',
    `Verification: ${packet.verification.status} — ${packet.verification.summary}`,
    `Policy: ${packet.policy.decision} — ${packet.policy.auditStatus}`,
    `Approval: ${packet.approvals.status}`,
    '',
    'Artifacts:',
    ...packet.artifactPaths.slice(0, 6).map((artifactPath) => `- ${artifactPath}`),
  ].join('\n');
}
