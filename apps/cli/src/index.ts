import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import {
  captureWorkspaceSnapshot,
  createArtifactStore,
  createDiffPatch,
  createRunRelativeDirectory,
  diffWorkspaceSnapshots,
} from '@gdh/artifact-store';
import {
  type ApprovalMode,
  type ApprovalPacket,
  type ApprovalResolution,
  type ArtifactReference,
  type CommandCapture,
  CommandCaptureSchema,
  createPlanFromSpec,
  createRunEvent,
  createRunRecord,
  normalizeMarkdownSpec,
  type PolicyDecision,
  type Run,
  type RunEventType,
  type RunnerKind,
  type RunnerResult,
  RunnerResultSchema,
  updateRunStatus,
} from '@gdh/domain';
import {
  createApprovalPacket,
  createApprovalResolutionRecord,
  createPolicyAudit,
  evaluatePolicy,
  generateImpactPreview,
  loadPolicyPackFromFile,
  renderApprovalPacketMarkdown,
} from '@gdh/policy-engine';
import { createReviewPacket, renderReviewPacketMarkdown } from '@gdh/review-packets';
import {
  createCodexCliRunner,
  createFakeRunner,
  defaultRunnerDefaults,
  type Runner,
} from '@gdh/runner-codex';
import { createIsoTimestamp, createRunId, findRepoRoot } from '@gdh/shared';
import { Command } from 'commander';

const supportedRunnerValues = ['codex-cli', 'fake'] as const;
const supportedApprovalModeValues = ['interactive', 'fail'] as const;

export interface RunCommandOptions {
  approvalMode?: ApprovalMode;
  approvalResolver?: ApprovalResolver;
  cwd?: string;
  json?: boolean;
  policyPath?: string;
  runner?: (typeof supportedRunnerValues)[number];
}

export interface RunCommandSummary {
  approvalPacketPath?: string;
  approvalResolution?: ApprovalResolution;
  artifactCount: number;
  artifactsDirectory: string;
  changedFiles: string[];
  commandsExecuted: Array<{
    command: string;
    isPartial: boolean;
    provenance: string;
  }>;
  exitCode: number;
  policyAuditPath: string;
  policyDecision: PolicyDecision;
  reviewPacketPath: string;
  runId: string;
  specTitle: string;
  status: Run['status'];
  summary: string;
}

export type ApprovalResolver = (packet: ApprovalPacket) => Promise<ApprovalResolution>;

function assertSupportedRunner(
  value: string,
): asserts value is (typeof supportedRunnerValues)[number] {
  if (!supportedRunnerValues.includes(value as (typeof supportedRunnerValues)[number])) {
    throw new Error(
      `Unsupported runner "${value}". Expected one of: ${supportedRunnerValues.join(', ')}.`,
    );
  }
}

function assertSupportedApprovalMode(
  value: string,
): asserts value is (typeof supportedApprovalModeValues)[number] {
  if (
    !supportedApprovalModeValues.includes(value as (typeof supportedApprovalModeValues)[number])
  ) {
    throw new Error(
      `Unsupported approval mode "${value}". Expected one of: ${supportedApprovalModeValues.join(', ')}.`,
    );
  }
}

async function assertReadableFile(filePath: string): Promise<void> {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new Error(`File "${filePath}" does not exist or is not readable.`);
  }
}

function createRunner(kind: (typeof supportedRunnerValues)[number]): Runner {
  return kind === 'fake' ? createFakeRunner() : createCodexCliRunner();
}

function createEmptyCommandCapture(note: string): CommandCapture {
  return CommandCaptureSchema.parse({
    commands: [],
    completeness: 'complete',
    notes: [note],
    source: 'governed_cli',
  });
}

function createSkippedRunnerResult(summary: string): RunnerResult {
  return RunnerResultSchema.parse({
    artifactsProduced: [],
    commandCapture: createEmptyCommandCapture(
      'The write-capable runner did not execute because the policy gate stopped the run first.',
    ),
    durationMs: 0,
    exitCode: 0,
    limitations: [
      'Execution did not start because the policy gate stopped or paused the run before write-capable execution.',
    ],
    metadata: {
      executed: false,
    },
    prompt: '',
    reportedChangedFiles: [],
    reportedChangedFilesCompleteness: 'complete',
    reportedChangedFilesNotes: ['No changed files were reported because execution never started.'],
    status: 'blocked',
    stderr: '',
    stdout: '',
    summary,
  });
}

function mapRunnerResultToRunStatus(status: RunnerResult['status']): Run['status'] {
  return status === 'completed' ? 'completed' : 'failed';
}

function eventTypeForRunnerStatus(status: RunnerResult['status']): RunEventType {
  return status === 'completed' ? 'runner.completed' : 'runner.failed';
}

function eventTypeForFinalRunStatus(status: Run['status']): RunEventType | null {
  if (status === 'completed') {
    return 'run.completed';
  }

  if (status === 'failed' || status === 'cancelled') {
    return 'run.failed';
  }

  return null;
}

function exitCodeForRunStatus(status: Run['status']): number {
  if (status === 'completed') {
    return 0;
  }

  if (status === 'awaiting_approval') {
    return 2;
  }

  return 1;
}

function formatTerminalSummary(summary: RunCommandSummary): string {
  return [
    `Run ${summary.status}: ${summary.runId}`,
    `Spec: ${summary.specTitle}`,
    `Summary: ${summary.summary}`,
    `Policy decision: ${summary.policyDecision}`,
    `Approval resolution: ${summary.approvalResolution ?? 'not_required'}`,
    `Artifacts: ${summary.artifactsDirectory}`,
    `Review packet: ${summary.reviewPacketPath}`,
    `Policy audit: ${summary.policyAuditPath}`,
    summary.approvalPacketPath
      ? `Approval packet: ${summary.approvalPacketPath}`
      : 'Approval packet: none',
    `Changed files: ${summary.changedFiles.length > 0 ? summary.changedFiles.join(', ') : 'none'}`,
    `Commands captured: ${
      summary.commandsExecuted.length > 0
        ? summary.commandsExecuted
            .map((command) => `${command.command} [${command.provenance}]`)
            .join(', ')
        : 'none'
    }`,
  ].join('\n');
}

function defaultApprovalMode(): ApprovalMode {
  return process.stdin.isTTY && process.stdout.isTTY ? 'interactive' : 'fail';
}

function formatApprovalPromptSummary(packet: ApprovalPacket): string {
  return [
    `Approval required for run ${packet.runId}`,
    `Approval ID: ${packet.id}`,
    `Spec: ${packet.specTitle}`,
    `Summary: ${packet.decisionSummary}`,
    `Affected paths: ${packet.affectedPaths.length > 0 ? packet.affectedPaths.join(', ') : 'none'}`,
    `Predicted commands: ${
      packet.predictedCommands.length > 0 ? packet.predictedCommands.join(', ') : 'none'
    }`,
    `Why: ${
      packet.whyApprovalIsRequired.length > 0
        ? packet.whyApprovalIsRequired.join(' | ')
        : 'No explicit reason recorded.'
    }`,
  ].join('\n');
}

async function promptForApproval(packet: ApprovalPacket): Promise<ApprovalResolution> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log(formatApprovalPromptSummary(packet));

    while (true) {
      const answer = (await readline.question('Approve this run? [approve/deny]: '))
        .trim()
        .toLowerCase();

      if (['a', 'approve', 'approved', 'y', 'yes'].includes(answer)) {
        return 'approved';
      }

      if (['d', 'deny', 'denied', 'n', 'no'].includes(answer)) {
        return 'denied';
      }
    }
  } finally {
    readline.close();
  }
}

async function persistRunStatus(
  artifactStore: ReturnType<typeof createArtifactStore>,
  run: Run,
): Promise<ArtifactReference> {
  return artifactStore.writeRun(run);
}

export async function runSpecFile(
  specFile: string,
  options: RunCommandOptions = {},
): Promise<RunCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const runnerKind = options.runner ?? 'codex-cli';
  const approvalMode = options.approvalMode ?? defaultApprovalMode();

  assertSupportedRunner(runnerKind);
  assertSupportedApprovalMode(approvalMode);

  const repoRoot = await findRepoRoot(cwd);
  const absoluteSpecPath = resolve(cwd, specFile);
  const absolutePolicyPath = resolve(
    cwd,
    options.policyPath ?? resolve(repoRoot, 'policies/default.policy.yaml'),
  );

  await assertReadableFile(absoluteSpecPath);
  await assertReadableFile(absolutePolicyPath);

  const sourceContent = await readFile(absoluteSpecPath, 'utf8');
  const normalizedSpec = normalizeMarkdownSpec({
    content: sourceContent,
    repoRoot,
    sourcePath: absoluteSpecPath,
  });
  const plan = createPlanFromSpec(normalizedSpec);
  const { pack: policyPack, path: loadedPolicyPath } =
    await loadPolicyPackFromFile(absolutePolicyPath);
  const runId = createRunId(normalizedSpec.title);
  const artifactStore = createArtifactStore({
    repoRoot,
    runId,
  });

  await artifactStore.initialize();

  const excludedRunPrefix = createRunRelativeDirectory(repoRoot, artifactStore.runDirectory);
  const beforeSnapshot = await captureWorkspaceSnapshot(repoRoot, {
    excludePrefixes: [excludedRunPrefix],
  });
  let run = createRunRecord({
    approvalMode,
    approvalPolicy: policyPack.defaults.approvalPolicy,
    createdAt: createIsoTimestamp(),
    model: defaultRunnerDefaults.model,
    networkAccess: policyPack.defaults.networkAccess,
    plan,
    policyPackName: policyPack.name,
    policyPackPath: loadedPolicyPath,
    policyPackVersion: policyPack.version,
    repoRoot,
    runDirectory: artifactStore.runDirectory,
    runId,
    runner: runnerKind as RunnerKind,
    sandboxMode: policyPack.defaults.sandboxMode,
    spec: normalizedSpec,
  });

  const emitEvent = async (
    type: RunEventType,
    payload: Record<string, unknown>,
  ): Promise<ArtifactReference> => {
    return artifactStore.appendEvent(createRunEvent(run.id, type, payload));
  };

  await persistRunStatus(artifactStore, run);
  await emitEvent('run.created', {
    approvalMode,
    planId: plan.id,
    policyPackName: policyPack.name,
    policyPackPath: loadedPolicyPath,
    policyPackVersion: policyPack.version,
    runDirectory: artifactStore.runDirectory,
    runner: run.runner,
    specId: normalizedSpec.id,
  });

  const normalizedSpecArtifact = await artifactStore.writeJsonArtifact(
    'normalized-spec',
    'spec.normalized.json',
    normalizedSpec,
    'Normalized markdown spec for this run.',
  );
  await emitEvent('spec.normalized', {
    artifactPath: normalizedSpecArtifact.path,
    inferredFields: normalizedSpec.inferredFields,
    normalizationNotes: normalizedSpec.normalizationNotes,
  });

  run = updateRunStatus(run, 'planning');
  await persistRunStatus(artifactStore, run);

  const planArtifact = await artifactStore.writeJsonArtifact(
    'plan',
    'plan.json',
    plan,
    'Deterministic governed-run plan.',
  );
  await emitEvent('plan.created', {
    artifactPath: planArtifact.path,
    doneConditions: plan.doneConditions,
    taskUnitCount: plan.taskUnits.length,
  });

  const impactPreview = generateImpactPreview({
    networkAccess: policyPack.defaults.networkAccess,
    plan,
    runId,
    sandboxMode: policyPack.defaults.sandboxMode,
    spec: normalizedSpec,
  });
  const impactPreviewArtifact = await artifactStore.writeJsonArtifact(
    'impact-preview',
    'impact-preview.json',
    impactPreview,
    'Read-only impact preview generated before write-capable execution.',
  );
  await emitEvent('impact_preview.created', {
    actionKinds: impactPreview.actionKinds,
    artifactPath: impactPreviewArtifact.path,
    requestedNetworkAccess: impactPreview.requestedNetworkAccess,
    requestedSandboxMode: impactPreview.requestedSandboxMode,
  });

  const policyInputArtifact = await artifactStore.writeJsonArtifact(
    'policy-input',
    'policy.input.json',
    {
      approvalMode,
      impactPreview,
      policyPack: {
        defaults: policyPack.defaults,
        name: policyPack.name,
        path: loadedPolicyPath,
        version: policyPack.version,
      },
      specId: normalizedSpec.id,
    },
    'Policy evaluation input snapshot.',
  );
  const policyDecision = evaluatePolicy({
    approvalMode,
    impactPreview,
    policyPack,
    policyPackPath: loadedPolicyPath,
    spec: normalizedSpec,
  });
  run = updateRunStatus(run, 'running', policyDecision.reasons[0]?.summary ?? undefined);
  await persistRunStatus(artifactStore, run);

  const policyDecisionArtifact = await artifactStore.writeJsonArtifact(
    'policy-decision',
    'policy.decision.json',
    policyDecision,
    'Structured policy decision for the impact preview.',
  );
  await emitEvent('policy.evaluated', {
    artifactPath: policyDecisionArtifact.path,
    decision: policyDecision.decision,
    matchedRuleIds: policyDecision.matchedRules.map((rule) => rule.ruleId),
  });

  let approvalPacket: ApprovalPacket | undefined;
  let approvalPacketArtifact: ArtifactReference | undefined;
  let approvalPacketMarkdownArtifact: ArtifactReference | undefined;
  let approvalResolution: ApprovalResolution | undefined;
  let runnerResult: RunnerResult | undefined;
  let executedRunner = false;

  if (policyDecision.decision === 'prompt') {
    approvalPacket = createApprovalPacket({
      artifactPaths: [
        normalizedSpecArtifact.path,
        planArtifact.path,
        impactPreviewArtifact.path,
        policyInputArtifact.path,
        policyDecisionArtifact.path,
      ],
      impactPreview,
      policyDecision,
      runId: run.id,
      spec: normalizedSpec,
    });
    const approvalMarkdown = renderApprovalPacketMarkdown(approvalPacket);

    approvalPacketArtifact = await artifactStore.writeJsonArtifact(
      'approval-packet',
      'approval-packet.json',
      approvalPacket,
      'Machine-readable approval packet for a prompted run.',
    );
    approvalPacketMarkdownArtifact = await artifactStore.writeTextArtifact(
      'approval-packet-markdown',
      'approval-packet.md',
      approvalMarkdown,
      'markdown',
      'Human-readable approval packet for a prompted run.',
    );

    run = updateRunStatus(run, 'awaiting_approval', approvalPacket.decisionSummary);
    await persistRunStatus(artifactStore, run);
    await emitEvent('approval.requested', {
      approvalPacketId: approvalPacket.id,
      artifactPaths: [approvalPacketArtifact.path, approvalPacketMarkdownArtifact.path],
      decision: policyDecision.decision,
    });

    if (approvalMode === 'interactive') {
      const resolveApproval = options.approvalResolver ?? promptForApproval;

      approvalResolution = await resolveApproval(approvalPacket);

      const approvalResolutionRecord = createApprovalResolutionRecord({
        approvalPacketId: approvalPacket.id,
        notes:
          approvalResolution === 'approved'
            ? ['Approval granted from the interactive CLI flow.']
            : ['Approval denied from the interactive CLI flow.'],
        resolution: approvalResolution,
        runId: run.id,
      });
      await artifactStore.writeJsonArtifact(
        'approval-resolution',
        'approval-resolution.json',
        approvalResolutionRecord,
        'Recorded approval resolution for this run.',
      );

      if (approvalResolution === 'approved') {
        run = updateRunStatus(
          run,
          'running',
          'Approval granted; write-capable execution may proceed.',
        );
        await persistRunStatus(artifactStore, run);
        await emitEvent('approval.granted', {
          approvalPacketId: approvalPacket.id,
          resolution: approvalResolution,
        });
      } else {
        run = updateRunStatus(
          run,
          'cancelled',
          'Approval denied; the run stopped before execution.',
        );
        await persistRunStatus(artifactStore, run);
        await emitEvent('approval.denied', {
          approvalPacketId: approvalPacket.id,
          resolution: approvalResolution,
        });
        runnerResult = createSkippedRunnerResult(
          `Approval "${approvalPacket.id}" was denied; the governed run stopped before execution.`,
        );
      }
    } else {
      runnerResult = createSkippedRunnerResult(
        `Approval "${approvalPacket.id}" is required. Re-run with --approval-mode interactive to review it.`,
      );
    }
  } else if (policyDecision.decision === 'forbid') {
    run = updateRunStatus(
      run,
      'failed',
      policyDecision.reasons[0]?.summary ?? 'Policy pack forbids this run from executing.',
    );
    await persistRunStatus(artifactStore, run);
    await emitEvent('policy.blocked', {
      decision: policyDecision.decision,
      matchedRuleIds: policyDecision.matchedRules.map((rule) => rule.ruleId),
    });
    runnerResult = createSkippedRunnerResult(
      policyDecision.reasons[0]?.summary ?? 'Policy pack forbids this run from executing.',
    );
  }

  if (!runnerResult && (policyDecision.decision === 'allow' || approvalResolution === 'approved')) {
    const runner = createRunner(runnerKind);

    executedRunner = true;
    await emitEvent('runner.started', {
      approvalPolicy: run.approvalPolicy,
      model: run.model,
      networkAccess: run.networkAccess,
      runner: runner.kind,
      sandboxMode: run.sandboxMode,
    });

    runnerResult = await (async () => {
      try {
        return await runner.execute({
          approvalPacket,
          impactPreview,
          plan,
          policyDecision,
          priorArtifacts: artifactStore.listArtifacts(),
          repoRoot,
          run,
          runDirectory: artifactStore.runDirectory,
          spec: normalizedSpec,
          verificationRequirements: [],
        });
      } catch (error) {
        return RunnerResultSchema.parse({
          artifactsProduced: [],
          commandCapture: createEmptyCommandCapture(
            'The runner threw before a structured command capture was available.',
          ),
          durationMs: 0,
          exitCode: -1,
          limitations: ['The runner threw before returning a structured result.'],
          metadata: {},
          prompt: '',
          reportedChangedFiles: [],
          reportedChangedFilesCompleteness: 'unknown',
          reportedChangedFilesNotes: ['The runner failed before reporting changed files.'],
          status: 'failed',
          stderr: error instanceof Error ? (error.stack ?? error.message) : String(error),
          stdout: '',
          summary: error instanceof Error ? error.message : 'Runner execution failed unexpectedly.',
        });
      }
    })();

    const runnerPromptArtifact = await artifactStore.writeTextArtifact(
      'runner-prompt',
      'runner.prompt.md',
      runnerResult.prompt,
      'markdown',
      'Prompt prepared for the write-capable runner.',
    );
    const stdoutArtifact = await artifactStore.writeTextArtifact(
      'runner-stdout',
      'runner.stdout.log',
      runnerResult.stdout,
      'text',
      'Raw runner stdout.',
    );
    const stderrArtifact = await artifactStore.writeTextArtifact(
      'runner-stderr',
      'runner.stderr.log',
      runnerResult.stderr,
      'text',
      'Raw runner stderr.',
    );
    const commandCaptureArtifact = await artifactStore.writeJsonArtifact(
      'commands-executed',
      'commands-executed.json',
      runnerResult.commandCapture,
      'Captured executed commands with provenance and completeness.',
    );
    const runnerResultArtifact = await artifactStore.writeJsonArtifact(
      'runner-result',
      'runner.result.json',
      runnerResult,
      'Structured runner result with logs and metadata.',
    );

    await emitEvent(eventTypeForRunnerStatus(runnerResult.status), {
      artifactPaths: [
        runnerPromptArtifact.path,
        stdoutArtifact.path,
        stderrArtifact.path,
        commandCaptureArtifact.path,
        runnerResultArtifact.path,
      ],
      durationMs: runnerResult.durationMs,
      exitCode: runnerResult.exitCode,
      status: runnerResult.status,
    });

    run = updateRunStatus(
      run,
      mapRunnerResultToRunStatus(runnerResult.status),
      runnerResult.summary,
    );
    await persistRunStatus(artifactStore, run);
  }

  if (!runnerResult) {
    runnerResult = createSkippedRunnerResult(
      'The governed run stopped before write-capable execution.',
    );
  }

  if (!executedRunner) {
    await artifactStore.writeJsonArtifact(
      'commands-executed',
      'commands-executed.json',
      runnerResult.commandCapture,
      'Captured executed commands with provenance and completeness.',
    );
    await artifactStore.writeJsonArtifact(
      'runner-result',
      'runner.result.json',
      runnerResult,
      'Structured synthetic runner result for a blocked or pending run.',
    );
  }

  const afterSnapshot = await captureWorkspaceSnapshot(repoRoot, {
    excludePrefixes: [excludedRunPrefix],
  });
  const changedFiles = diffWorkspaceSnapshots(beforeSnapshot, afterSnapshot);
  const diffPatch = await createDiffPatch(beforeSnapshot, afterSnapshot, changedFiles);
  const changedFilesArtifact = await artifactStore.writeJsonArtifact(
    'changed-files',
    'changed-files.json',
    changedFiles,
    'Changed files derived from before/after workspace snapshots.',
  );
  const diffArtifact = await artifactStore.writeTextArtifact(
    'diff',
    'diff.patch',
    diffPatch,
    'patch',
    'Patch derived from workspace snapshot differences.',
  );
  await emitEvent('diff.captured', {
    artifactPath: changedFilesArtifact.path,
    changedFiles: changedFiles.files.map((file) => ({
      path: file.path,
      status: file.status,
    })),
    diffPath: diffArtifact.path,
  });

  const policyAudit = createPolicyAudit({
    approvalResolution,
    changedFiles,
    commandCapture: runnerResult.commandCapture,
    impactPreview,
    policyDecision,
    policyPack,
    spec: normalizedSpec,
  });
  const policyAuditArtifact = await artifactStore.writeJsonArtifact(
    'policy-audit',
    'policy-audit.json',
    policyAudit,
    'Post-run policy audit based on actual changed files and captured commands.',
  );

  if (executedRunner && run.status === 'completed' && policyAudit.status === 'policy_breach') {
    run = updateRunStatus(run, 'failed', policyAudit.summary);
    await persistRunStatus(artifactStore, run);
    await emitEvent('policy.blocked', {
      artifactPath: policyAuditArtifact.path,
      source: 'postrun_audit',
      status: policyAudit.status,
    });
  }

  const reviewPacket = createReviewPacket({
    approvalResolution,
    artifacts: artifactStore.listArtifacts(),
    changedFiles,
    plan,
    policyAudit,
    policyDecision,
    run,
    runnerResult,
    spec: normalizedSpec,
    verificationStatus: 'not_run',
  });
  const reviewPacketMarkdown = renderReviewPacketMarkdown(reviewPacket);
  const reviewPacketJsonArtifact = await artifactStore.writeJsonArtifact(
    'review-packet-json',
    'review-packet.json',
    reviewPacket,
    'Structured review packet.',
  );
  const reviewPacketMarkdownArtifact = await artifactStore.writeTextArtifact(
    'review-packet-markdown',
    'review-packet.md',
    reviewPacketMarkdown,
    'markdown',
    'Human-readable review packet.',
  );
  await emitEvent('review_packet.generated', {
    artifactPaths: [reviewPacketJsonArtifact.path, reviewPacketMarkdownArtifact.path],
    verificationStatus: reviewPacket.verificationStatus,
  });

  const finalEventType = eventTypeForFinalRunStatus(run.status);

  if (finalEventType) {
    await emitEvent(finalEventType, {
      reviewPacketPath: reviewPacketMarkdownArtifact.path,
      status: run.status,
      summary: run.summary,
    });
  }

  return {
    approvalPacketPath: approvalPacketMarkdownArtifact?.path,
    approvalResolution,
    artifactCount: artifactStore.listArtifacts().length,
    artifactsDirectory: artifactStore.runDirectory,
    changedFiles: changedFiles.files.map((file) => file.path),
    commandsExecuted: runnerResult.commandCapture.commands.map((command) => ({
      command: command.command,
      isPartial: command.isPartial,
      provenance: command.provenance,
    })),
    exitCode: exitCodeForRunStatus(run.status),
    policyAuditPath: policyAuditArtifact.path,
    policyDecision: policyDecision.decision,
    reviewPacketPath: reviewPacketMarkdownArtifact.path,
    runId: run.id,
    specTitle: normalizedSpec.title,
    status: run.status,
    summary: run.summary ?? runnerResult.summary,
  };
}

export function createProgram(): Command {
  const program = new Command();

  program.name('cp').description('Governed delivery control plane CLI').version('0.2.0');

  program
    .command('run')
    .description('Normalize a spec and start a governed run')
    .argument('<spec-file>', 'Path to a local spec file')
    .option('--runner <runner>', 'Runner implementation to use', 'codex-cli')
    .option(
      '--approval-mode <mode>',
      'Approval handling mode (interactive or fail)',
      defaultApprovalMode(),
    )
    .option(
      '--policy <policy-file>',
      'Policy pack to evaluate before write-capable execution',
      'policies/default.policy.yaml',
    )
    .option('--json', 'Emit the final summary as JSON')
    .action(
      async (
        specFile: string,
        commandOptions: {
          approvalMode?: string;
          json?: boolean;
          policy?: string;
          runner?: string;
        },
      ) => {
        try {
          const runner = commandOptions.runner ?? 'codex-cli';
          const approvalMode = commandOptions.approvalMode ?? defaultApprovalMode();

          assertSupportedRunner(runner);
          assertSupportedApprovalMode(approvalMode);

          const summary = await runSpecFile(specFile, {
            approvalMode,
            cwd: process.cwd(),
            json: commandOptions.json,
            policyPath: commandOptions.policy,
            runner,
          });

          if (commandOptions.json) {
            console.log(JSON.stringify(summary, null, 2));
          } else {
            console.log(formatTerminalSummary(summary));
          }

          process.exitCode = summary.exitCode;
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      },
    );

  program
    .command('resume')
    .description('Resume a governed run')
    .argument('<run-id>', 'Run identifier')
    .action((runId: string) => {
      console.log(`Resume is not implemented yet for governed run "${runId}".`);
      process.exitCode = 1;
    });

  program
    .command('approve')
    .description('Approve or reject a pending approval packet')
    .argument('<approval-id>', 'Approval packet identifier')
    .option('--yes', 'Approve the packet')
    .option('--no', 'Reject the packet')
    .action((approvalId: string) => {
      console.log(
        `Approvals are session-local in Phase 2. Re-run the owning spec with --approval-mode interactive to resolve "${approvalId}".`,
      );
      process.exitCode = 1;
    });

  program
    .command('verify')
    .description('Run verification for a governed run')
    .argument('<run-id>', 'Run identifier')
    .action((runId: string) => {
      console.log(`Verify is not implemented yet for run "${runId}".`);
      process.exitCode = 1;
    });

  program
    .command('report')
    .description('Generate a review packet')
    .argument('<run-id>', 'Run identifier')
    .action((runId: string) => {
      console.log(`Report regeneration is not implemented yet for run "${runId}".`);
      process.exitCode = 1;
    });

  program
    .command('benchmark')
    .description('Run a benchmark suite')
    .argument('<suite>', 'Benchmark suite name')
    .action((suite: string) => {
      console.log(`Benchmark is not implemented yet for suite "${suite}".`);
      process.exitCode = 1;
    });

  const githubCommand = program.command('github').description('GitHub integration commands');

  githubCommand
    .command('draft-pr')
    .description('Open a draft pull request for a completed run')
    .argument('<run-id>', 'Run identifier')
    .action((runId: string) => {
      console.log(`GitHub draft PR flow is not implemented yet for run "${runId}".`);
      process.exitCode = 1;
    });

  return program;
}

export async function run(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

const entrypoint = process.argv[1];

if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void run();
}
