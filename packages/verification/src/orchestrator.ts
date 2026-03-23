import { resolve } from 'node:path';
import type { ArtifactStore } from '@gdh/artifact-store';
import { listArtifactReferencesFromRunDirectory } from '@gdh/artifact-store';
import type {
  ApprovalPacket,
  ApprovalResolution,
  ChangedFileCapture,
  ClaimVerificationSummary,
  CommandCapture,
  PacketCompletenessResult,
  Plan,
  PolicyAuditResult,
  PolicyEvaluation,
  ReviewPacket,
  Run,
  RunEventType,
  RunnerResult,
  Spec,
  VerificationCommandResult,
  VerificationResult,
} from '@gdh/domain';
import { VerificationResultSchema } from '@gdh/domain';
import { createReviewPacket, renderReviewPacketMarkdown } from '@gdh/review-packets';
import { createEvidence, createStableId, unique } from './builders.js';
import {
  checkReviewPacketCompleteness,
  createClaimSummaryCheck,
  createEmptyClaimVerificationSummary,
  createPacketCompletenessCheck,
  verifyReviewPacketClaims,
} from './claims.js';
import { evaluateCheck, runVerificationCommand } from './commands.js';
import {
  createArtifactCompletenessCheck,
  decideRunCompletion,
  verificationStatusFromDecision,
} from './completion.js';
import { describeVerificationScope, loadVerificationConfig } from './config.js';

export interface VerificationRunInput {
  approvalPacket?: ApprovalPacket;
  approvalResolution?: ApprovalResolution;
  artifactStore: ArtifactStore;
  changedFiles: ChangedFileCapture;
  commandCapture: CommandCapture;
  configPath?: string;
  diffPatch: string;
  emitEvent?: (type: RunEventType, payload: Record<string, unknown>) => Promise<unknown>;
  plan: Plan;
  policyAudit?: PolicyAuditResult;
  policyDecision: PolicyEvaluation;
  repoRoot: string;
  run: Run;
  runnerResult: RunnerResult;
  spec: Spec;
}

export interface VerificationRunOutput {
  claimVerification: ClaimVerificationSummary;
  commandResults: VerificationCommandResult[];
  packetCompleteness: PacketCompletenessResult;
  reviewPacket: ReviewPacket;
  reviewPacketMarkdown: string;
  verificationResult: VerificationResult;
}

export async function runVerification(input: VerificationRunInput): Promise<VerificationRunOutput> {
  const verificationConfig = await loadVerificationConfig(input.repoRoot, input.configPath);
  const commandResults: VerificationCommandResult[] = [];
  const baseChecks = [];

  await input.emitEvent?.('verification.started', {
    configPath: verificationConfig.path,
    runId: input.run.id,
    verificationCommands: describeVerificationScope(verificationConfig.commands),
  });

  for (const [phase, commands] of [
    ['preflight', verificationConfig.commands.preflight],
    ['postrun', verificationConfig.commands.postrun],
    ['optional', verificationConfig.commands.optional],
  ] as const) {
    for (const [index, command] of commands.entries()) {
      const commandRun = await runVerificationCommand(
        input,
        phase,
        command,
        index,
        phase !== 'optional',
      );

      baseChecks.push(commandRun.check);
      commandResults.push(commandRun.result);
    }
  }

  baseChecks.push(
    await evaluateCheck(
      input,
      {
        idSeed: `${input.run.id}:commands-executed`,
        mandatory: true,
        name: 'verification.commands.executed',
      },
      async () => {
        const mandatoryCommands = commandResults.filter((command) => command.mandatory);
        const failingMandatoryCommands = mandatoryCommands.filter(
          (command) => command.status !== 'passed',
        );

        if (mandatoryCommands.length === 0) {
          return {
            status: 'failed' as const,
            summary: 'No mandatory verification commands were configured.',
            details: ['Configure at least one mandatory verification command in gdh.config.json.'],
            evidence: [
              createEvidence('note', 'Verification config path', {
                value: verificationConfig.path,
              }),
            ],
          };
        }

        return {
          status: failingMandatoryCommands.length === 0 ? ('passed' as const) : ('failed' as const),
          summary:
            failingMandatoryCommands.length === 0
              ? 'Configured mandatory verification commands executed successfully.'
              : `${failingMandatoryCommands.length} mandatory verification command(s) failed.`,
          details: failingMandatoryCommands.map((command) => command.command),
          evidence: mandatoryCommands.flatMap((command) => command.evidence),
        };
      },
    ),
  );

  baseChecks.push(
    await evaluateCheck(
      input,
      {
        idSeed: `${input.run.id}:diff-parsable`,
        mandatory: true,
        name: 'diff.present_and_parsable',
      },
      async () => {
        const diffArtifactPath = resolve(input.run.runDirectory, 'diff.patch');
        const hasChanges = input.changedFiles.files.length > 0;
        const hasDiffHeaders = /^diff --git /m.test(input.diffPatch);

        if (!hasChanges && input.diffPatch.trim().length === 0) {
          return {
            status: 'passed' as const,
            summary: 'The run produced an explicit empty diff artifact and no changed files.',
            evidence: [createEvidence('artifact', 'Diff artifact', { path: diffArtifactPath })],
          };
        }

        return {
          status: hasDiffHeaders ? ('passed' as const) : ('failed' as const),
          summary: hasDiffHeaders
            ? 'The run produced a diff artifact with git-style patch headers.'
            : 'The diff artifact was missing or could not be parsed as a git-style patch.',
          details: hasDiffHeaders ? [] : [input.diffPatch.slice(0, 200)],
          evidence: [createEvidence('artifact', 'Diff artifact', { path: diffArtifactPath })],
        };
      },
    ),
  );

  baseChecks.push(
    await evaluateCheck(
      input,
      {
        idSeed: `${input.run.id}:policy-compliance`,
        mandatory: true,
        name: 'policy.compliance',
      },
      async () => {
        const missingApproval =
          input.policyDecision.requiredApprovalMode !== null &&
          input.approvalResolution !== 'approved';
        const policyBreach = input.policyAudit?.status === 'policy_breach';

        return {
          status: missingApproval || policyBreach ? ('failed' as const) : ('passed' as const),
          summary: missingApproval
            ? 'The run required approval, but no approved approval resolution was recorded.'
            : policyBreach
              ? 'The post-run policy audit recorded a policy breach.'
              : input.policyAudit?.status === 'scope_drift'
                ? 'The policy audit recorded scope drift, but no direct policy breach was proven.'
                : 'The recorded policy artifacts do not show a blocking policy breach.',
          details: unique([
            ...(missingApproval ? ['approval_missing'] : []),
            ...(policyBreach ? ['policy_breach'] : []),
            ...(input.policyAudit?.status === 'scope_drift' ? ['scope_drift'] : []),
          ]),
          evidence: [
            createEvidence('artifact', 'Policy decision artifact', {
              path: resolve(input.run.runDirectory, 'policy.decision.json'),
            }),
            createEvidence('artifact', 'Policy audit artifact', {
              path: resolve(input.run.runDirectory, 'policy-audit.json'),
            }),
          ],
        };
      },
    ),
  );

  const provisionalDecision = decideRunCompletion(baseChecks);
  const provisionalStatus = verificationStatusFromDecision(provisionalDecision);
  const provisionalClaimSummary = createEmptyClaimVerificationSummary();
  const provisionalArtifacts = await listArtifactReferencesFromRunDirectory(
    input.run.id,
    input.run.runDirectory,
  );
  const provisionalPacket = createReviewPacket({
    approvalPacket: input.approvalPacket,
    approvalResolution: input.approvalResolution,
    artifacts: provisionalArtifacts,
    changedFiles: input.changedFiles,
    claimVerification: provisionalClaimSummary,
    githubState: input.run.github,
    plan: input.plan,
    policyAudit: input.policyAudit,
    policyDecision: input.policyDecision,
    run: input.run,
    runCompletion: provisionalDecision,
    runnerResult: input.runnerResult,
    spec: input.spec,
    verificationCommands: commandResults,
    verificationStatus: provisionalStatus,
    verificationSummary: provisionalDecision.summary,
    verifiedAt: new Date().toISOString(),
  });

  let claimVerification = verifyReviewPacketClaims({
    approvalPacket: input.approvalPacket,
    approvalResolution: input.approvalResolution,
    changedFiles: input.changedFiles,
    commandCapture: input.commandCapture,
    packet: provisionalPacket,
    policyAudit: input.policyAudit,
    policyDecision: input.policyDecision,
    runnerResult: input.runnerResult,
    verificationCommands: commandResults,
    verificationStatus: provisionalStatus,
  });

  let packetWithClaims = createReviewPacket({
    approvalPacket: input.approvalPacket,
    approvalResolution: input.approvalResolution,
    artifacts: provisionalArtifacts,
    changedFiles: input.changedFiles,
    claimVerification,
    githubState: input.run.github,
    plan: input.plan,
    policyAudit: input.policyAudit,
    policyDecision: input.policyDecision,
    run: input.run,
    runCompletion: provisionalDecision,
    runnerResult: input.runnerResult,
    spec: input.spec,
    verificationCommands: commandResults,
    verificationStatus: provisionalStatus,
    verificationSummary: provisionalDecision.summary,
    verifiedAt: new Date().toISOString(),
  });
  let packetCompleteness = checkReviewPacketCompleteness(packetWithClaims);

  await input.artifactStore.writeJsonArtifact(
    'claim-checks',
    'claim-checks.json',
    claimVerification,
    'Deterministic review-packet claim verification results.',
  );
  await input.artifactStore.writeJsonArtifact(
    'packet-completeness',
    'packet-completeness.json',
    packetCompleteness,
    'Required review-packet section completeness check.',
  );
  await input.artifactStore.writeJsonArtifact(
    'verification-checks',
    'verification.checks.json',
    [
      ...baseChecks,
      createClaimSummaryCheck(input.run.id, claimVerification),
      createPacketCompletenessCheck(input.run.id, packetCompleteness),
    ],
    'Structured verification checks before final completion aggregation.',
  );
  await input.artifactStore.writeJsonArtifact(
    'review-packet-json',
    'review-packet.json',
    packetWithClaims,
    'Structured review packet.',
  );
  await input.artifactStore.writeTextArtifact(
    'review-packet-markdown',
    'review-packet.md',
    renderReviewPacketMarkdown(packetWithClaims),
    'markdown',
    'Human-readable review packet.',
  );

  const artifactCompletenessCheck = await createArtifactCompletenessCheck(input, commandResults);
  let allChecks = [
    ...baseChecks,
    createClaimSummaryCheck(input.run.id, claimVerification),
    createPacketCompletenessCheck(input.run.id, packetCompleteness),
    artifactCompletenessCheck,
  ];
  let finalDecision = decideRunCompletion(allChecks);
  let finalStatus = verificationStatusFromDecision(finalDecision);
  const verifiedAt = new Date().toISOString();
  const finalArtifacts = await listArtifactReferencesFromRunDirectory(
    input.run.id,
    input.run.runDirectory,
  );

  const finalPacketCandidate = createReviewPacket({
    approvalPacket: input.approvalPacket,
    approvalResolution: input.approvalResolution,
    artifacts: finalArtifacts,
    changedFiles: input.changedFiles,
    claimVerification,
    githubState: input.run.github,
    plan: input.plan,
    policyAudit: input.policyAudit,
    policyDecision: input.policyDecision,
    run: input.run,
    runCompletion: finalDecision,
    runnerResult: input.runnerResult,
    spec: input.spec,
    verificationCommands: commandResults,
    verificationStatus: finalStatus,
    verificationSummary: finalDecision.summary,
    verifiedAt,
  });

  claimVerification = verifyReviewPacketClaims({
    approvalPacket: input.approvalPacket,
    approvalResolution: input.approvalResolution,
    changedFiles: input.changedFiles,
    commandCapture: input.commandCapture,
    packet: finalPacketCandidate,
    policyAudit: input.policyAudit,
    policyDecision: input.policyDecision,
    runnerResult: input.runnerResult,
    verificationCommands: commandResults,
    verificationStatus: finalStatus,
  });

  packetWithClaims = createReviewPacket({
    approvalPacket: input.approvalPacket,
    approvalResolution: input.approvalResolution,
    artifacts: finalArtifacts,
    changedFiles: input.changedFiles,
    claimVerification,
    githubState: input.run.github,
    plan: input.plan,
    policyAudit: input.policyAudit,
    policyDecision: input.policyDecision,
    run: input.run,
    runCompletion: finalDecision,
    runnerResult: input.runnerResult,
    spec: input.spec,
    verificationCommands: commandResults,
    verificationStatus: finalStatus,
    verificationSummary: finalDecision.summary,
    verifiedAt,
  });
  packetCompleteness = checkReviewPacketCompleteness(packetWithClaims);

  allChecks = [
    ...baseChecks,
    createClaimSummaryCheck(input.run.id, claimVerification),
    createPacketCompletenessCheck(input.run.id, packetCompleteness),
    artifactCompletenessCheck,
  ];
  finalDecision = decideRunCompletion(allChecks);
  finalStatus = verificationStatusFromDecision(finalDecision);

  packetWithClaims = createReviewPacket({
    approvalPacket: input.approvalPacket,
    approvalResolution: input.approvalResolution,
    artifacts: finalArtifacts,
    changedFiles: input.changedFiles,
    claimVerification,
    githubState: input.run.github,
    plan: input.plan,
    policyAudit: input.policyAudit,
    policyDecision: input.policyDecision,
    run: input.run,
    runCompletion: finalDecision,
    runnerResult: input.runnerResult,
    spec: input.spec,
    verificationCommands: commandResults,
    verificationStatus: finalStatus,
    verificationSummary: finalDecision.summary,
    verifiedAt,
  });

  const reviewPacketMarkdown = renderReviewPacketMarkdown(packetWithClaims);
  await input.artifactStore.writeJsonArtifact(
    'claim-checks',
    'claim-checks.json',
    claimVerification,
    'Deterministic review-packet claim verification results.',
  );
  await input.artifactStore.writeJsonArtifact(
    'packet-completeness',
    'packet-completeness.json',
    packetCompleteness,
    'Required review-packet section completeness check.',
  );
  await input.artifactStore.writeJsonArtifact(
    'review-packet-json',
    'review-packet.json',
    packetWithClaims,
    'Structured review packet.',
  );
  await input.artifactStore.writeTextArtifact(
    'review-packet-markdown',
    'review-packet.md',
    reviewPacketMarkdown,
    'markdown',
    'Human-readable review packet.',
  );
  await input.emitEvent?.('review_packet.generated', {
    artifactPaths: [
      resolve(input.run.runDirectory, 'review-packet.json'),
      resolve(input.run.runDirectory, 'review-packet.md'),
    ],
    verificationStatus: finalStatus,
  });

  const verificationResult = VerificationResultSchema.parse({
    id: createStableId('verification-result', `${input.run.id}:${verifiedAt}:${finalStatus}`),
    runId: input.run.id,
    status: finalStatus,
    summary: finalDecision.summary,
    commands: commandResults,
    checks: allChecks,
    claimVerification,
    packetCompleteness,
    completionDecision: finalDecision,
    createdAt: verifiedAt,
  });
  await input.artifactStore.writeJsonArtifact(
    'verification-checks',
    'verification.checks.json',
    allChecks,
    'Structured verification checks for this run.',
  );
  await input.artifactStore.writeJsonArtifact(
    'verification-result',
    'verification.result.json',
    verificationResult,
    'Aggregated deterministic verification result for this run.',
  );

  if (!finalDecision.canComplete) {
    await input.emitEvent?.('verification.failed', {
      blockingCheckIds: finalDecision.blockingCheckIds,
      runId: input.run.id,
      summary: finalDecision.summary,
    });
  }

  await input.emitEvent?.('verification.completed', {
    blockingCheckIds: finalDecision.blockingCheckIds,
    status: verificationResult.status,
    summary: verificationResult.summary,
    verificationResultPath: resolve(input.run.runDirectory, 'verification.result.json'),
  });

  return {
    claimVerification,
    commandResults,
    packetCompleteness,
    reviewPacket: packetWithClaims,
    reviewPacketMarkdown,
    verificationResult,
  };
}
