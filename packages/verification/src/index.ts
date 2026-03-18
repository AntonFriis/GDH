import { exec as execCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ArtifactStore } from '@gdh/artifact-store';
import { listArtifactReferencesFromRunDirectory } from '@gdh/artifact-store';
import {
  type ApprovalPacket,
  type ApprovalResolution,
  type ChangedFileCapture,
  type ClaimCategory,
  type ClaimCheckResult,
  type ClaimVerificationSummary,
  type CommandCapture,
  type PacketCompletenessResult,
  PacketCompletenessResultSchema,
  type Plan,
  type PolicyAuditResult,
  type PolicyEvaluation,
  type ReviewPacket,
  type Run,
  type RunCompletionDecision,
  RunCompletionDecisionSchema,
  type RunEventType,
  type RunnerResult,
  type Spec,
  type VerificationCheck,
  VerificationCheckSchema,
  type VerificationCheckStatus,
  type VerificationCommandPhase,
  type VerificationCommandResult,
  VerificationCommandResultSchema,
  type VerificationEvidence,
  type VerificationResult,
  VerificationResultSchema,
  type VerificationStatus,
} from '@gdh/domain';
import { createReviewPacket, renderReviewPacketMarkdown } from '@gdh/review-packets';
import { unsupportedCertaintyClaimRules } from '@gdh/shared';

const execAsync = promisify(execCallback);

export interface VerificationCommandSet {
  preflight: string[];
  postrun: string[];
  optional: string[];
}

export interface LoadedVerificationConfig {
  commands: VerificationCommandSet;
  path: string;
}

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

export const defaultVerificationCommandSet: VerificationCommandSet = {
  preflight: ['pnpm lint', 'pnpm typecheck'],
  postrun: ['pnpm test'],
  optional: ['pnpm test:e2e'],
};

const disallowedClaimRules = unsupportedCertaintyClaimRules;

function createStableId(prefix: string, seed: string): string {
  return `${prefix}-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function createEvidence(
  kind: VerificationEvidence['kind'],
  label: string,
  options?: { path?: string; value?: string },
): VerificationEvidence {
  return {
    kind,
    label,
    path: options?.path,
    value: options?.value,
  };
}

function createCheck(
  seed: string,
  input: {
    name: string;
    mandatory: boolean;
    status: VerificationCheckStatus;
    summary: string;
    details?: string[];
    evidence?: VerificationEvidence[];
    startedAt: string;
    completedAt: string;
  },
): VerificationCheck {
  return VerificationCheckSchema.parse({
    id: createStableId('verification-check', seed),
    name: input.name,
    mandatory: input.mandatory,
    status: input.status,
    summary: input.summary,
    details: input.details ?? [],
    evidence: input.evidence ?? [],
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  });
}

function createClaimResult(
  seed: string,
  input: {
    category: ClaimCategory;
    claim: string;
    status: ClaimCheckResult['status'];
    reason: string;
    field?: string;
    evidence?: VerificationEvidence[];
  },
): ClaimCheckResult {
  return {
    id: createStableId('claim-check', seed),
    category: input.category,
    claim: input.claim,
    status: input.status,
    reason: input.reason,
    field: input.field,
    evidence: input.evidence ?? [],
  };
}

function normalizeCommandList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item).trim()).filter(Boolean);
}

export async function loadVerificationConfig(
  repoRoot: string,
  configPath = resolve(repoRoot, 'gdh.config.json'),
): Promise<LoadedVerificationConfig> {
  try {
    const raw = JSON.parse(await readFile(configPath, 'utf8')) as {
      verification?: Partial<VerificationCommandSet>;
    };

    return {
      commands: {
        preflight: normalizeCommandList(raw.verification?.preflight),
        postrun: normalizeCommandList(raw.verification?.postrun),
        optional: normalizeCommandList(raw.verification?.optional),
      },
      path: configPath,
    };
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;

    if (fileError.code === 'ENOENT') {
      return {
        commands: defaultVerificationCommandSet,
        path: configPath,
      };
    }

    throw new Error(
      `Could not load verification config from "${configPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function describeVerificationScope(
  commands: VerificationCommandSet = defaultVerificationCommandSet,
): string[] {
  return [...commands.preflight, ...commands.postrun, ...commands.optional];
}

async function emitCheckStarted(
  emitEvent: VerificationRunInput['emitEvent'],
  check: { id: string; name: string; mandatory: boolean },
): Promise<void> {
  await emitEvent?.('verification.check.started', {
    checkId: check.id,
    mandatory: check.mandatory,
    name: check.name,
  });
}

async function emitCheckCompleted(
  emitEvent: VerificationRunInput['emitEvent'],
  check: VerificationCheck,
): Promise<void> {
  await emitEvent?.('verification.check.completed', {
    checkId: check.id,
    mandatory: check.mandatory,
    name: check.name,
    status: check.status,
    summary: check.summary,
  });
}

async function evaluateCheck(
  input: VerificationRunInput,
  descriptor: {
    idSeed: string;
    mandatory: boolean;
    name: string;
  },
  evaluator: () => Promise<{
    details?: string[];
    evidence?: VerificationEvidence[];
    status: VerificationCheckStatus;
    summary: string;
  }>,
): Promise<VerificationCheck> {
  const startedAt = new Date().toISOString();
  const checkId = createStableId('verification-check', descriptor.idSeed);

  await emitCheckStarted(input.emitEvent, {
    id: checkId,
    name: descriptor.name,
    mandatory: descriptor.mandatory,
  });

  const result = await evaluator();
  const completedAt = new Date().toISOString();
  const check = createCheck(descriptor.idSeed, {
    ...result,
    mandatory: descriptor.mandatory,
    name: descriptor.name,
    startedAt,
    completedAt,
  });

  await emitCheckCompleted(input.emitEvent, check);
  return check;
}

async function runVerificationCommand(
  input: VerificationRunInput,
  phase: VerificationCommandPhase,
  command: string,
  index: number,
  mandatory: boolean,
): Promise<{ check: VerificationCheck; result: VerificationCommandResult }> {
  const startedAt = new Date().toISOString();
  const seed = `${input.run.id}:${phase}:${index}:${command}`;
  const checkId = createStableId('verification-command-check', seed);

  await emitCheckStarted(input.emitEvent, {
    id: checkId,
    name: `verification.command.${phase}.${index + 1}`,
    mandatory,
  });

  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  const startedMs = Date.now();

  try {
    const result = await execAsync(command, {
      cwd: input.repoRoot,
      maxBuffer: 20 * 1024 * 1024,
    });

    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const failure = error as Error & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };

    stdout = failure.stdout ?? '';
    stderr = failure.stderr ?? failure.stack ?? failure.message;
    exitCode = typeof failure.code === 'number' ? failure.code : 1;
  }

  const durationMs = Date.now() - startedMs;
  const stdoutArtifact = await input.artifactStore.writeTextArtifact(
    'verification-command-stdout',
    `verification/commands/${phase}-${index + 1}.stdout.log`,
    stdout,
    'text',
    `Stdout for verification command "${command}".`,
  );
  const stderrArtifact = await input.artifactStore.writeTextArtifact(
    'verification-command-stderr',
    `verification/commands/${phase}-${index + 1}.stderr.log`,
    stderr,
    'text',
    `Stderr for verification command "${command}".`,
  );
  const completedAt = new Date().toISOString();
  const status: VerificationCheckStatus = exitCode === 0 ? 'passed' : 'failed';
  const summary =
    status === 'passed'
      ? `Verification command "${command}" passed.`
      : `Verification command "${command}" failed with exit code ${exitCode}.`;
  const evidence = [
    createEvidence('command', `Verification command ${command}`, {
      value: `${phase}:${mandatory ? 'mandatory' : 'optional'}`,
    }),
    createEvidence('artifact', 'Verification command stdout', { path: stdoutArtifact.path }),
    createEvidence('artifact', 'Verification command stderr', { path: stderrArtifact.path }),
  ];

  const result = VerificationCommandResultSchema.parse({
    id: createStableId('verification-command', seed),
    command,
    phase,
    mandatory,
    status,
    exitCode,
    durationMs,
    summary,
    stdoutArtifactPath: stdoutArtifact.path,
    stderrArtifactPath: stderrArtifact.path,
    startedAt,
    completedAt,
    evidence,
  });
  const check = createCheck(seed, {
    name: `verification.command.${phase}.${index + 1}`,
    mandatory,
    status,
    summary,
    details: [command],
    evidence,
    startedAt,
    completedAt,
  });

  await emitCheckCompleted(input.emitEvent, check);
  return { check, result };
}

function createEmptyClaimVerificationSummary(): ClaimVerificationSummary {
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
    const failures = disallowedClaimRules.filter((rule) => rule.pattern.test(field.value));

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
    rule.pattern.test(input.runnerResult.summary),
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

function createClaimSummaryCheck(
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

function createPacketCompletenessCheck(
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

function decideRunCompletion(checks: VerificationCheck[]): RunCompletionDecision {
  const blockingChecks = checks.filter((check) => check.mandatory && check.status === 'failed');

  return RunCompletionDecisionSchema.parse({
    finalStatus: blockingChecks.length === 0 ? 'completed' : 'failed',
    canComplete: blockingChecks.length === 0,
    summary:
      blockingChecks.length === 0
        ? 'Verification passed and the run can be marked completed.'
        : `Verification failed because ${blockingChecks.length} mandatory check(s) did not pass.`,
    blockingCheckIds: blockingChecks.map((check) => check.id),
    blockingReasons: blockingChecks.map((check) => check.summary),
  });
}

async function createArtifactCompletenessCheck(
  input: VerificationRunInput,
  commandResults: VerificationCommandResult[],
): Promise<VerificationCheck> {
  return evaluateCheck(
    input,
    {
      idSeed: `${input.run.id}:artifact-completeness`,
      mandatory: true,
      name: 'artifacts.completeness',
    },
    async () => {
      const artifacts = await listArtifactReferencesFromRunDirectory(
        input.run.id,
        input.run.runDirectory,
      );
      const artifactPaths = new Set(artifacts.map((artifact) => artifact.path));
      const expectedPaths = [
        'run.json',
        'events.jsonl',
        'spec.normalized.json',
        'plan.json',
        'impact-preview.json',
        'policy.input.json',
        'policy.decision.json',
        'runner.result.json',
        'commands-executed.json',
        'changed-files.json',
        'diff.patch',
        'policy-audit.json',
        'verification.checks.json',
        'claim-checks.json',
        'packet-completeness.json',
        'review-packet.json',
        'review-packet.md',
      ].map((relativePath) => resolve(input.run.runDirectory, relativePath));

      if (input.policyDecision.requiredApprovalMode !== null) {
        expectedPaths.push(resolve(input.run.runDirectory, 'approval-packet.json'));
        expectedPaths.push(resolve(input.run.runDirectory, 'approval-packet.md'));
      }

      if (input.approvalResolution) {
        expectedPaths.push(resolve(input.run.runDirectory, 'approval-resolution.json'));
      }

      for (const command of commandResults) {
        if (command.stdoutArtifactPath) {
          expectedPaths.push(command.stdoutArtifactPath);
        }

        if (command.stderrArtifactPath) {
          expectedPaths.push(command.stderrArtifactPath);
        }
      }

      const missingPaths = expectedPaths.filter((path) => !artifactPaths.has(path));

      return {
        status: missingPaths.length === 0 ? 'passed' : 'failed',
        summary:
          missingPaths.length === 0
            ? 'All expected run and verification artifacts are present.'
            : `${missingPaths.length} expected artifact(s) were missing from the run directory.`,
        details: missingPaths,
        evidence: [
          createEvidence('artifact', 'Run artifact inventory', {
            value: artifacts.map((artifact) => artifact.path).join(', '),
          }),
        ],
      };
    },
  );
}

function verificationStatusFromDecision(decision: RunCompletionDecision): VerificationStatus {
  return decision.canComplete ? 'passed' : 'failed';
}

export async function runVerification(input: VerificationRunInput): Promise<VerificationRunOutput> {
  const verificationConfig = await loadVerificationConfig(input.repoRoot, input.configPath);
  const commandResults: VerificationCommandResult[] = [];
  const baseChecks: VerificationCheck[] = [];

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
            status: 'failed',
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
          status: failingMandatoryCommands.length === 0 ? 'passed' : 'failed',
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
            status: 'passed',
            summary: 'The run produced an explicit empty diff artifact and no changed files.',
            evidence: [createEvidence('artifact', 'Diff artifact', { path: diffArtifactPath })],
          };
        }

        return {
          status: hasDiffHeaders ? 'passed' : 'failed',
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
          status: missingApproval || policyBreach ? 'failed' : 'passed',
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
