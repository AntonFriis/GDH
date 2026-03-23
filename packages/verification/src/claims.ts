import type {
  ApprovalPacket,
  ApprovalResolution,
  ChangedFileCapture,
  ClaimCheckResult,
  ClaimVerificationSummary,
  CommandCapture,
  PacketCompletenessResult,
  PolicyAuditResult,
  PolicyEvaluation,
  ReviewPacket,
  RunnerResult,
  VerificationCheck,
  VerificationCommandResult,
  VerificationStatus,
} from '@gdh/domain';
import { PacketCompletenessResultSchema } from '@gdh/domain';
import { matchesUnsupportedCertaintyClaimRule, unsupportedCertaintyClaimRules } from '@gdh/shared';
import { createCheck, createClaimResult, createEvidence } from './builders.js';

const disallowedClaimRules = unsupportedCertaintyClaimRules;

export function createEmptyClaimVerificationSummary(): ClaimVerificationSummary {
  return {
    status: 'passed',
    summary: 'Claim verification has not run yet.',
    totalClaims: 0,
    passedClaims: 0,
    failedClaims: 0,
    results: [],
  };
}

export function verifyReviewPacketClaims(input: {
  approvalPacket?: ApprovalPacket;
  approvalResolution?: ApprovalResolution;
  changedFiles: ChangedFileCapture;
  commandCapture: CommandCapture;
  packet: ReviewPacket;
  policyAudit?: PolicyAuditResult;
  policyDecision: PolicyEvaluation;
  runnerResult: RunnerResult;
  verificationCommands: VerificationCommandResult[];
  verificationStatus: VerificationStatus;
}): ClaimVerificationSummary {
  const results: ClaimCheckResult[] = [];
  const changedPaths = new Set(input.changedFiles.files.map((file) => file.path));
  const executedCommands = new Set(input.commandCapture.commands.map((command) => command.command));
  const verificationCommandsByKey = new Map(
    input.verificationCommands.map((command) => [`${command.phase}:${command.command}`, command]),
  );

  for (const filePath of input.packet.filesChanged) {
    const status = changedPaths.has(filePath) ? 'passed' : 'failed';

    results.push(
      createClaimResult(`${input.packet.runId}:file:${filePath}`, {
        category: 'files_changed',
        claim: `Review packet lists changed file "${filePath}".`,
        status,
        reason:
          status === 'passed'
            ? 'The changed-files artifact records this path.'
            : 'The changed-files artifact does not contain this path.',
        field: 'filesChanged',
        evidence: [
          createEvidence('artifact', 'Changed files artifact', {
            value: input.changedFiles.files.map((file) => file.path).join(', '),
          }),
        ],
      }),
    );
  }

  for (const command of input.packet.commandsExecuted) {
    const status = executedCommands.has(command.command) ? 'passed' : 'failed';

    results.push(
      createClaimResult(`${input.packet.runId}:runner-command:${command.command}`, {
        category: 'commands_executed',
        claim: `Review packet lists executed command "${command.command}".`,
        status,
        reason:
          status === 'passed'
            ? 'The runner command capture records this command.'
            : 'The runner command capture does not contain this command.',
        field: 'commandsExecuted',
        evidence: [
          createEvidence('artifact', 'Runner command capture', {
            value: input.commandCapture.commands.map((item) => item.command).join(', '),
          }),
        ],
      }),
    );
  }

  for (const command of input.packet.checksRun) {
    const key = `${command.phase}:${command.command}`;
    const source = verificationCommandsByKey.get(key);
    const status =
      source && source.status === command.status && source.mandatory === command.mandatory
        ? 'passed'
        : 'failed';

    results.push(
      createClaimResult(`${input.packet.runId}:verification-command:${key}`, {
        category: 'checks_executed',
        claim: `Review packet records verification command "${command.command}" as ${command.status}.`,
        status,
        reason:
          status === 'passed'
            ? 'The verification result contains the same command, phase, and status.'
            : 'The verification result does not support this command outcome.',
        field: 'checksRun',
        evidence: source
          ? source.evidence
          : [createEvidence('note', 'Verification command missing from result payload')],
      }),
    );
  }

  const expectedApprovalStatus =
    input.policyDecision.requiredApprovalMode === null
      ? 'not_required'
      : (input.approvalResolution ?? 'pending');
  const approvalPass =
    input.packet.approvals.required === (input.policyDecision.requiredApprovalMode !== null) &&
    input.packet.approvals.status === expectedApprovalStatus &&
    input.packet.approvals.approvalPacketId === input.approvalPacket?.id;

  results.push(
    createClaimResult(`${input.packet.runId}:approvals`, {
      category: 'approvals',
      claim:
        'Review packet approval section matches the policy decision and recorded approval state.',
      status: approvalPass ? 'passed' : 'failed',
      reason: approvalPass
        ? 'Approval requirements and resolution match the recorded policy artifacts.'
        : 'Approval requirements or resolution do not match the recorded policy artifacts.',
      field: 'approvals',
      evidence: [
        createEvidence('artifact', 'Policy decision artifact', {
          value: input.policyDecision.decision,
        }),
        createEvidence('artifact', 'Approval packet artifact', {
          value: input.approvalPacket?.id ?? 'none',
        }),
      ],
    }),
  );

  const policyPass =
    input.packet.policy.decision === input.policyDecision.decision &&
    input.packet.policy.summary ===
      (input.policyDecision.reasons[0]?.summary ??
        input.policyDecision.notes[0] ??
        'No policy summary was recorded.') &&
    input.packet.policy.auditStatus === (input.policyAudit?.status ?? 'clean') &&
    input.packet.policy.auditSummary ===
      (input.policyAudit?.summary ??
        'Policy audit did not record any unexpected paths or commands after the run.');

  results.push(
    createClaimResult(`${input.packet.runId}:policy`, {
      category: 'policy',
      claim:
        'Review packet policy section matches the recorded policy decision and post-run audit.',
      status: policyPass ? 'passed' : 'failed',
      reason: policyPass
        ? 'Policy decision and policy audit details match the structured artifacts.'
        : 'Policy decision or policy audit details do not match the structured artifacts.',
      field: 'policy',
      evidence: [
        createEvidence('artifact', 'Policy decision artifact', {
          value: input.policyDecision.decision,
        }),
      ],
    }),
  );

  const verificationPass = input.packet.verification.status === input.verificationStatus;
  results.push(
    createClaimResult(`${input.packet.runId}:verification-status`, {
      category: 'verification_status',
      claim: `Review packet verification status is "${input.packet.verification.status}".`,
      status: verificationPass ? 'passed' : 'failed',
      reason: verificationPass
        ? 'The review packet verification status matches the aggregated verification decision.'
        : 'The review packet verification status does not match the aggregated verification decision.',
      field: 'verification.status',
      evidence: [
        createEvidence('run_field', 'Aggregated verification status', {
          value: input.verificationStatus,
        }),
      ],
    }),
  );

  const scannedFields: Array<{ field: string; value: string }> = [
    { field: 'overview', value: input.packet.overview },
    { field: 'runnerReportedSummary', value: input.packet.runnerReportedSummary },
    { field: 'verification.summary', value: input.packet.verification.summary },
  ];

  for (const field of scannedFields) {
    const failures = disallowedClaimRules.filter((rule) =>
      matchesUnsupportedCertaintyClaimRule(field.value, rule),
    );

    if (failures.length === 0) {
      results.push(
        createClaimResult(`${input.packet.runId}:unsupported:${field.field}`, {
          category: 'unsupported_claim',
          claim: `Field "${field.field}" does not contain unsupported certainty claims.`,
          status: 'passed',
          reason: 'No unsupported certainty phrases were detected in this narrative field.',
          field: field.field,
          evidence: [createEvidence('packet_field', field.field, { value: field.value })],
        }),
      );
      continue;
    }

    for (const failure of failures) {
      results.push(
        createClaimResult(`${input.packet.runId}:unsupported:${field.field}:${failure.pattern}`, {
          category: 'unsupported_claim',
          claim: `Field "${field.field}" contains the unsupported phrase "${failure.pattern.source}".`,
          status: 'failed',
          reason: failure.reason,
          field: field.field,
          evidence: [createEvidence('packet_field', field.field, { value: field.value })],
        }),
      );
    }
  }

  const rawRunnerSummaryFailures = disallowedClaimRules.filter((rule) =>
    matchesUnsupportedCertaintyClaimRule(input.runnerResult.summary, rule),
  );

  if (rawRunnerSummaryFailures.length === 0) {
    results.push(
      createClaimResult(`${input.packet.runId}:unsupported:runnerResult.summary`, {
        category: 'unsupported_claim',
        claim: 'The raw runner summary does not contain unsupported certainty claims.',
        status: 'passed',
        reason: 'No unsupported certainty phrases were detected in the runner result summary.',
        field: 'runnerResult.summary',
        evidence: [
          createEvidence('run_field', 'runnerResult.summary', {
            value: input.runnerResult.summary,
          }),
        ],
      }),
    );
  } else {
    for (const failure of rawRunnerSummaryFailures) {
      results.push(
        createClaimResult(
          `${input.packet.runId}:unsupported:runnerResult.summary:${failure.pattern}`,
          {
            category: 'unsupported_claim',
            claim: `The raw runner summary contains the unsupported phrase "${failure.pattern.source}".`,
            status: 'failed',
            reason: failure.reason,
            field: 'runnerResult.summary',
            evidence: [
              createEvidence('run_field', 'runnerResult.summary', {
                value: input.runnerResult.summary,
              }),
            ],
          },
        ),
      );
    }
  }

  const passedClaims = results.filter((result) => result.status === 'passed').length;
  const failedClaims = results.length - passedClaims;

  return {
    status: failedClaims === 0 ? 'passed' : 'failed',
    summary:
      failedClaims === 0
        ? 'All review packet claims matched the recorded evidence.'
        : `${failedClaims} review packet claim(s) were unsupported by the recorded evidence.`,
    totalClaims: results.length,
    passedClaims,
    failedClaims,
    results,
  };
}

export function checkReviewPacketCompleteness(packet: ReviewPacket): PacketCompletenessResult {
  const requiredSections = [
    'objective',
    'plan_summary',
    'files_changed',
    'tests_checks_run',
    'policy_decisions',
    'approvals',
    'risks',
    'open_questions',
    'verification_summary',
    'claim_verification_summary',
    'rollback_hint',
  ];
  const missingSections: string[] = [];
  const incompleteSections: string[] = [];

  if (!packet.objective.trim()) {
    missingSections.push('objective');
  }

  if (!packet.planSummary.trim()) {
    missingSections.push('plan_summary');
  }

  if (packet.checksRun.length === 0) {
    incompleteSections.push('tests_checks_run');
  }

  if (!packet.policy.summary.trim()) {
    missingSections.push('policy_decisions');
  }

  if (!packet.approvals.summary.trim()) {
    missingSections.push('approvals');
  }

  if (!packet.verification.summary.trim()) {
    missingSections.push('verification_summary');
  }

  if (!packet.claimVerification.summary.trim() || packet.claimVerification.totalClaims === 0) {
    incompleteSections.push('claim_verification_summary');
  }

  if (!packet.rollbackHint.trim()) {
    missingSections.push('rollback_hint');
  }

  return PacketCompletenessResultSchema.parse({
    status: missingSections.length === 0 && incompleteSections.length === 0 ? 'passed' : 'failed',
    summary:
      missingSections.length === 0 && incompleteSections.length === 0
        ? 'The review packet contains the required Phase 3 sections.'
        : 'The review packet is missing required sections or contains incomplete required sections.',
    requiredSections,
    missingSections,
    incompleteSections,
  });
}

export function createClaimSummaryCheck(
  runId: string,
  claimVerification: ClaimVerificationSummary,
): VerificationCheck {
  const startedAt = new Date().toISOString();
  const completedAt = startedAt;

  return createCheck(`${runId}:claim-verification`, {
    name: 'review_packet.claim_verification',
    mandatory: true,
    status: claimVerification.failedClaims === 0 ? 'passed' : 'failed',
    summary: claimVerification.summary,
    details: claimVerification.results
      .filter((result) => result.status === 'failed')
      .map((result) => `${result.field ?? result.category}: ${result.reason}`),
    evidence: claimVerification.results.flatMap((result) => result.evidence),
    startedAt,
    completedAt,
  });
}

export function createPacketCompletenessCheck(
  runId: string,
  packetCompleteness: PacketCompletenessResult,
): VerificationCheck {
  const startedAt = new Date().toISOString();
  const completedAt = startedAt;

  return createCheck(`${runId}:packet-completeness`, {
    name: 'review_packet.completeness',
    mandatory: true,
    status: packetCompleteness.status === 'passed' ? 'passed' : 'failed',
    summary: packetCompleteness.summary,
    details: [
      ...packetCompleteness.missingSections.map((section) => `missing:${section}`),
      ...packetCompleteness.incompleteSections.map((section) => `incomplete:${section}`),
    ],
    evidence: [
      createEvidence('note', 'Packet completeness summary', {
        value: packetCompleteness.summary,
      }),
    ],
    startedAt,
    completedAt,
  });
}
