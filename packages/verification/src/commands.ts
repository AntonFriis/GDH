import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  VerificationCheck,
  VerificationCheckStatus,
  VerificationCommandPhase,
  VerificationCommandResult,
  VerificationEvidence,
} from '@gdh/domain';
import { VerificationCommandResultSchema } from '@gdh/domain';
import { createCheck, createEvidence, createStableId } from './builders.js';
import type { VerificationRunInput } from './orchestrator.js';

const execAsync = promisify(execCallback);

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

export async function evaluateCheck(
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

export async function runVerificationCommand(
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
