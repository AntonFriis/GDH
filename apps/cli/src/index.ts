import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  captureWorkspaceSnapshot,
  createArtifactStore,
  createDiffPatch,
  createRunRelativeDirectory,
  diffWorkspaceSnapshots,
} from '@gdh/artifact-store';
import {
  type ArtifactReference,
  createArtifactReference,
  createPlanFromSpec,
  createRunEvent,
  createRunRecord,
  normalizeMarkdownSpec,
  type Run,
  type RunEventType,
  type RunnerKind,
  updateRunStatus,
} from '@gdh/domain';
import { resolvePhaseOnePolicy } from '@gdh/policy-engine';
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

export interface RunCommandOptions {
  cwd?: string;
  json?: boolean;
  runner?: (typeof supportedRunnerValues)[number];
}

export interface RunCommandSummary {
  artifactCount: number;
  artifactsDirectory: string;
  changedFiles: string[];
  commandsExecuted: Array<{
    command: string;
    isPartial: boolean;
    provenance: string;
  }>;
  reviewPacketPath: string;
  runId: string;
  specTitle: string;
  status: Run['status'];
  summary: string;
}

function assertSupportedRunner(
  value: string,
): asserts value is (typeof supportedRunnerValues)[number] {
  if (!supportedRunnerValues.includes(value as (typeof supportedRunnerValues)[number])) {
    throw new Error(
      `Unsupported runner "${value}". Expected one of: ${supportedRunnerValues.join(', ')}.`,
    );
  }
}

async function assertReadableFile(filePath: string): Promise<void> {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new Error(`Spec file "${filePath}" does not exist or is not readable.`);
  }
}

function createRunner(kind: (typeof supportedRunnerValues)[number]): Runner {
  return kind === 'fake' ? createFakeRunner() : createCodexCliRunner();
}

function mapRunnerResultToRunStatus(status: 'completed' | 'blocked' | 'failed'): Run['status'] {
  return status === 'completed' ? 'completed' : 'failed';
}

function eventTypeForRunnerStatus(status: 'completed' | 'blocked' | 'failed'): RunEventType {
  return status === 'completed' ? 'runner.completed' : 'runner.failed';
}

function eventTypeForFinalRunStatus(status: Run['status']): RunEventType {
  return status === 'completed' ? 'run.completed' : 'run.failed';
}

function formatTerminalSummary(summary: RunCommandSummary): string {
  return [
    `Run ${summary.status}: ${summary.runId}`,
    `Spec: ${summary.specTitle}`,
    `Summary: ${summary.summary}`,
    `Artifacts: ${summary.artifactsDirectory}`,
    `Review packet: ${summary.reviewPacketPath}`,
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

function createFallbackCommandCapture() {
  return {
    source: 'cli_fallback',
    completeness: 'unknown' as const,
    notes: ['The runner failed before a structured command capture was available.'],
    commands: [],
  };
}

export async function runSpecFile(
  specFile: string,
  options: RunCommandOptions = {},
): Promise<RunCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const runnerKind = options.runner ?? 'codex-cli';

  assertSupportedRunner(runnerKind);

  const repoRoot = await findRepoRoot(cwd);
  const absoluteSpecPath = resolve(cwd, specFile);

  await assertReadableFile(absoluteSpecPath);

  const sourceContent = await readFile(absoluteSpecPath, 'utf8');
  const normalizedSpec = normalizeMarkdownSpec({
    content: sourceContent,
    repoRoot,
    sourcePath: absoluteSpecPath,
  });
  const policy = resolvePhaseOnePolicy(normalizedSpec);
  const plan = createPlanFromSpec(normalizedSpec);
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
    runId,
    spec: normalizedSpec,
    plan,
    runner: runnerKind as RunnerKind,
    model: defaultRunnerDefaults.model,
    sandboxMode: policy.sandboxMode,
    approvalPolicy: policy.approvalPolicy,
    repoRoot,
    runDirectory: artifactStore.runDirectory,
    createdAt: createIsoTimestamp(),
  });

  const emitEvent = async (
    type: RunEventType,
    payload: Record<string, unknown>,
  ): Promise<ArtifactReference> => {
    return artifactStore.appendEvent(createRunEvent(run.id, type, payload));
  };

  await artifactStore.writeRun(run);
  await emitEvent('run.created', {
    runner: run.runner,
    specId: normalizedSpec.id,
    planId: plan.id,
    runDirectory: artifactStore.runDirectory,
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
  await artifactStore.writeRun(run);

  const planArtifact = await artifactStore.writeJsonArtifact(
    'plan',
    'plan.json',
    plan,
    'Deterministic Phase 1 execution plan.',
  );
  await emitEvent('plan.created', {
    artifactPath: planArtifact.path,
    taskUnitCount: plan.taskUnits.length,
    doneConditions: plan.doneConditions,
  });

  run = updateRunStatus(run, 'running');
  await artifactStore.writeRun(run);

  const runner = createRunner(runnerKind);
  await emitEvent('runner.started', {
    runner: runner.kind,
    model: run.model,
    sandboxMode: run.sandboxMode,
    approvalPolicy: run.approvalPolicy,
  });

  const runnerResult = await (async () => {
    try {
      return await runner.execute({
        repoRoot,
        runDirectory: artifactStore.runDirectory,
        spec: normalizedSpec,
        plan,
        run,
        verificationRequirements: [],
        priorArtifacts: artifactStore.listArtifacts(),
        policy,
      });
    } catch (error) {
      return {
        status: 'failed' as const,
        summary: error instanceof Error ? error.message : 'Runner execution failed unexpectedly.',
        exitCode: -1,
        durationMs: 0,
        prompt: '',
        stdout: '',
        stderr: error instanceof Error ? (error.stack ?? error.message) : String(error),
        commandCapture: createFallbackCommandCapture(),
        reportedChangedFiles: [],
        reportedChangedFilesCompleteness: 'unknown' as const,
        reportedChangedFilesNotes: ['The runner failed before reporting changed files.'],
        limitations: ['The runner threw before returning a structured result.'],
        artifactsProduced: [],
        metadata: {},
      };
    }
  })();

  const promptArtifact = await artifactStore.writeTextArtifact(
    'runner-prompt',
    'runner.prompt.md',
    runnerResult.prompt,
    'markdown',
    'Prompt sent to the runner.',
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
    'Structured runner result with logs, capture notes, and metadata.',
  );

  await emitEvent(eventTypeForRunnerStatus(runnerResult.status), {
    artifactPaths: [
      promptArtifact.path,
      stdoutArtifact.path,
      stderrArtifact.path,
      commandCaptureArtifact.path,
      runnerResultArtifact.path,
    ],
    durationMs: runnerResult.durationMs,
    exitCode: runnerResult.exitCode,
    status: runnerResult.status,
  });

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
    diffPath: diffArtifact.path,
    changedFiles: changedFiles.files.map((file) => ({
      path: file.path,
      status: file.status,
    })),
  });

  run = updateRunStatus(run, mapRunnerResultToRunStatus(runnerResult.status), runnerResult.summary);
  await artifactStore.writeRun(run);

  const reviewPacketPath = resolve(artifactStore.runDirectory, 'review-packet.md');
  const reviewPacketJsonPath = resolve(artifactStore.runDirectory, 'review-packet.json');
  const projectedReviewArtifacts = [
    createArtifactReference(run.id, 'review-packet-json', reviewPacketJsonPath, 'json'),
    createArtifactReference(run.id, 'review-packet-markdown', reviewPacketPath, 'markdown'),
  ];
  const reviewPacket = createReviewPacket({
    artifacts: [...artifactStore.listArtifacts(), ...projectedReviewArtifacts],
    changedFiles,
    plan,
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
    'Structured conservative review packet.',
  );
  const reviewPacketMarkdownArtifact = await artifactStore.writeTextArtifact(
    'review-packet-markdown',
    'review-packet.md',
    reviewPacketMarkdown,
    'markdown',
    'Human-readable conservative review packet.',
  );

  await emitEvent('review_packet.generated', {
    artifactPaths: [reviewPacketJsonArtifact.path, reviewPacketMarkdownArtifact.path],
    verificationStatus: reviewPacket.verificationStatus,
  });
  await emitEvent(eventTypeForFinalRunStatus(run.status), {
    summary: run.summary,
    status: run.status,
    reviewPacketPath: reviewPacketMarkdownArtifact.path,
  });

  return {
    artifactCount: artifactStore.listArtifacts().length,
    artifactsDirectory: artifactStore.runDirectory,
    changedFiles: changedFiles.files.map((file) => file.path),
    commandsExecuted: runnerResult.commandCapture.commands.map((command) => ({
      command: command.command,
      isPartial: command.isPartial,
      provenance: command.provenance,
    })),
    reviewPacketPath: reviewPacketMarkdownArtifact.path,
    runId: run.id,
    specTitle: normalizedSpec.title,
    status: run.status,
    summary: runnerResult.summary,
  };
}

export function createProgram(): Command {
  const program = new Command();

  program.name('cp').description('Governed delivery control plane CLI').version('0.1.0');

  program
    .command('run')
    .description('Normalize a spec and start a governed run')
    .argument('<spec-file>', 'Path to a local spec file')
    .option('--runner <runner>', 'Runner implementation to use', 'codex-cli')
    .option('--json', 'Emit the final summary as JSON')
    .action(async (specFile: string, commandOptions: { json?: boolean; runner?: string }) => {
      try {
        const runner = commandOptions.runner ?? 'codex-cli';

        assertSupportedRunner(runner);

        const summary = await runSpecFile(specFile, {
          cwd: process.cwd(),
          json: commandOptions.json,
          runner,
        });

        if (commandOptions.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(formatTerminalSummary(summary));
        }

        if (summary.status !== 'completed') {
          process.exitCode = 1;
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  program
    .command('resume')
    .description('Resume a governed run')
    .argument('<run-id>', 'Run identifier')
    .action((runId: string) => {
      console.log(`Resume is not implemented in Phase 1 for run "${runId}".`);
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
        `Approve is not implemented in Phase 1. Approval flow begins in Phase 2 for "${approvalId}".`,
      );
      process.exitCode = 1;
    });

  program
    .command('verify')
    .description('Run verification for a governed run')
    .argument('<run-id>', 'Run identifier')
    .action((runId: string) => {
      console.log(`Verify is not implemented in Phase 1 for run "${runId}".`);
      process.exitCode = 1;
    });

  program
    .command('report')
    .description('Generate a review packet')
    .argument('<run-id>', 'Run identifier')
    .action((runId: string) => {
      console.log(`Report is not implemented in Phase 1 for run "${runId}".`);
      process.exitCode = 1;
    });

  program
    .command('benchmark')
    .description('Run a benchmark suite')
    .argument('<suite>', 'Benchmark suite name')
    .action((suite: string) => {
      console.log(`Benchmark is not implemented in Phase 1 for suite "${suite}".`);
      process.exitCode = 1;
    });

  const githubCommand = program.command('github').description('GitHub integration commands');

  githubCommand
    .command('draft-pr')
    .description('Open a draft pull request for a completed run')
    .argument('<run-id>', 'Run identifier')
    .action((runId: string) => {
      console.log(`GitHub draft PR flow is not implemented in Phase 1 for run "${runId}".`);
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
