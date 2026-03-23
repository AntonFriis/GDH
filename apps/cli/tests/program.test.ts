import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProgram,
  resumeRunId,
  runBenchmarkTargetId,
  runSpecFile,
  showBenchmarkRunId,
  statusRunId,
  verifyRunId,
} from '../src/index';

const tempDirectories: string[] = [];
const benchmarkRunDirectories: string[] = [];
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const defaultPolicyContents = [
  'version: 1',
  'name: test-default',
  'defaults:',
  '  sandbox_mode: workspace-write',
  '  network_access: false',
  '  approval_policy: on-request',
  '  fallback_decision: prompt',
  'rules:',
  '  - id: docs-safe',
  '    match:',
  '      task_classes: [docs]',
  '      paths: ["docs/**", "README.md"]',
  '      actions: [read, write]',
  '    decision: allow',
  '  - id: auth-protected',
  '    match:',
  '      paths: ["src/auth/**"]',
  '      actions: [write]',
  '    decision: prompt',
  '    reason: Auth changes require approval.',
  '  - id: secrets-forbidden',
  '    match:',
  '      paths: [".env", ".env.*"]',
  '      actions: [read, write, secrets_touch]',
  '    decision: forbid',
  '    reason: Secrets are forbidden.',
].join('\n');

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

interface MutableRunFixture {
  [key: string]: unknown;
  currentStage?: string;
  lastCheckpointId?: string;
  lastSuccessfulStage?: string;
  pendingStage?: string;
  status?: string;
  verificationStatus?: string;
}

interface MutableManifestFixture {
  [key: string]: unknown;
  currentStage?: string;
  lastCheckpointId?: string;
  lastSuccessfulStage?: string;
  pendingStage?: string;
  pendingStep?: string;
  status?: string;
  summary?: string;
  verificationState: {
    status?: string;
  };
  workspace: {
    lastSnapshot: {
      repoRoot?: string;
    };
  };
}

async function writeRunFixtureState(
  runDirectory: string,
  updater: (input: {
    manifest: MutableManifestFixture;
    run: MutableRunFixture;
  }) => Promise<void> | void,
): Promise<void> {
  const manifestPath = resolve(runDirectory, 'session.manifest.json');
  const runPath = resolve(runDirectory, 'run.json');
  const manifest = await readJson<MutableManifestFixture>(manifestPath);
  const run = await readJson<MutableRunFixture>(runPath);

  await updater({ manifest, run });

  await writeJson(manifestPath, manifest);
  await writeJson(runPath, run);
}

async function checkpointPathForStage(
  runDirectory: string,
  stage: string,
): Promise<string | undefined> {
  const checkpointDirectory = resolve(runDirectory, 'checkpoints');
  const files = await readdir(checkpointDirectory);

  for (const fileName of files) {
    const checkpoint = await readJson<{ stage?: string }>(resolve(checkpointDirectory, fileName));

    if (checkpoint.stage === stage) {
      return resolve(checkpointDirectory, fileName);
    }
  }

  return undefined;
}

async function createTempRepo(verification?: {
  preflight?: string[];
  postrun?: string[];
  optional?: string[];
}): Promise<string> {
  const repoRoot = await mkdtemp(resolve(tmpdir(), 'gdh-cli-test-'));

  tempDirectories.push(repoRoot);

  execFileSync('git', ['init'], { cwd: repoRoot });
  await mkdir(resolve(repoRoot, 'runs', 'local'), { recursive: true });
  await mkdir(resolve(repoRoot, 'policies'), { recursive: true });
  await mkdir(resolve(repoRoot, 'scripts'), { recursive: true });
  await writeFile(
    resolve(repoRoot, '.gitignore'),
    ['runs/local/**', '!runs/local/.gitkeep', 'node_modules/', 'dist/'].join('\n'),
    'utf8',
  );
  await writeFile(resolve(repoRoot, 'runs', 'local', '.gitkeep'), '', 'utf8');
  await writeFile(resolve(repoRoot, 'README.md'), '# Temp Repo\n', 'utf8');
  await writeFile(resolve(repoRoot, 'AGENTS.md'), '# AGENTS\n', 'utf8');
  await writeFile(resolve(repoRoot, 'PLANS.md'), '# PLANS\n', 'utf8');
  await writeFile(resolve(repoRoot, 'implement.md'), '# implement\n', 'utf8');
  await writeFile(resolve(repoRoot, 'documentation.md'), '# documentation\n', 'utf8');
  await writeFile(
    resolve(repoRoot, 'codex_governed_delivery_handoff_spec.md'),
    '# handoff\n',
    'utf8',
  );
  await mkdir(resolve(repoRoot, '.codex'), { recursive: true });
  await writeFile(resolve(repoRoot, '.codex', 'config.toml'), 'model = "gpt-5.4"\n', 'utf8');
  await writeFile(
    resolve(repoRoot, 'policies', 'default.policy.yaml'),
    defaultPolicyContents,
    'utf8',
  );
  await writeFile(
    resolve(repoRoot, 'scripts', 'pass.mjs'),
    "console.log(process.argv.slice(2).join(' '));\n",
    'utf8',
  );
  await writeFile(
    resolve(repoRoot, 'scripts', 'fail.mjs'),
    "console.error(process.argv.slice(2).join(' '));\nprocess.exit(1);\n",
    'utf8',
  );
  await writeJson(resolve(repoRoot, 'gdh.config.json'), {
    verification: {
      preflight: verification?.preflight ?? [],
      postrun: verification?.postrun ?? [],
      optional: verification?.optional ?? [],
    },
  });
  execFileSync('git', ['add', '.'], { cwd: repoRoot });

  return repoRoot;
}

async function writeSpec(repoRoot: string, fileName: string, objective: string): Promise<string> {
  const specPath = resolve(repoRoot, fileName);

  await writeFile(
    specPath,
    [
      '---',
      'title: CLI Verification Test',
      'task_type: docs',
      'constraints:',
      '  - Keep the change deterministic.',
      'acceptance_criteria:',
      '  - Persist the expected artifacts.',
      '---',
      '',
      '# CLI Verification Test',
      '',
      '## Objective',
      objective,
    ].join('\n'),
    'utf8',
  );

  return specPath;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
  await Promise.all(
    benchmarkRunDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('createProgram', () => {
  it('registers the CLI command surface', () => {
    const program = createProgram();

    expect(program.name()).toBe('gdh');
    expect(program.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining([
        'run',
        'resume',
        'status',
        'approve',
        'verify',
        'pr',
        'report',
        'benchmark',
        'github',
      ]),
    );
  });
});

describe('runSpecFile', () => {
  it('completes a governed run only after deterministic verification passes', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: ['node scripts/pass.mjs e2e'],
    });
    const specPath = await writeSpec(
      repoRoot,
      'success-spec.md',
      'Update `docs/fake-run-output.md` with a short docs-only note.',
    );

    const summary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });
    const events = await readFile(resolve(summary.artifactsDirectory, 'events.jsonl'), 'utf8');
    const runRecord = await readJson<{
      status: string;
      verificationStatus: string;
      verificationResultPath?: string;
      currentStage: string;
      lastCheckpointId?: string;
    }>(resolve(summary.artifactsDirectory, 'run.json'));
    const manifest = await readJson<{
      status: string;
      currentStage: string;
      lastCheckpointId?: string;
      lastProgressSnapshotId?: string;
      resumeEligibility: { eligible: boolean };
    }>(resolve(summary.artifactsDirectory, 'session.manifest.json'));
    const verificationResult = await readJson<{
      status: string;
      completionDecision: { canComplete: boolean };
    }>(resolve(summary.artifactsDirectory, 'verification.result.json'));
    const reviewPacket = await readJson<{
      verification: { status: string };
      claimVerification: { status: string };
      checksRun: Array<{ command: string }>;
    }>(resolve(summary.artifactsDirectory, 'review-packet.json'));

    expect(summary.status).toBe('completed');
    expect(summary.verificationStatus).toBe('passed');
    expect(summary.verificationResultPath).toBeDefined();
    expect(runRecord.status).toBe('completed');
    expect(runRecord.currentStage).toBe('verification_completed');
    expect(runRecord.verificationStatus).toBe('passed');
    expect(runRecord.verificationResultPath).toBe(summary.verificationResultPath);
    expect(manifest.status).toBe('completed');
    expect(manifest.currentStage).toBe('verification_completed');
    expect(manifest.lastCheckpointId).toBeTruthy();
    expect(manifest.lastProgressSnapshotId).toBeTruthy();
    expect(manifest.resumeEligibility.eligible).toBe(false);
    expect(
      await readFile(resolve(summary.artifactsDirectory, 'progress.latest.json'), 'utf8'),
    ).toContain('"stage": "verification_completed"');
    expect(
      (await readdir(resolve(summary.artifactsDirectory, 'checkpoints'))).length,
    ).toBeGreaterThan(0);
    expect(verificationResult.status).toBe('passed');
    expect(verificationResult.completionDecision.canComplete).toBe(true);
    expect(reviewPacket.verification.status).toBe('passed');
    expect(reviewPacket.claimVerification.status).toBe('passed');
    expect(reviewPacket.checksRun.map((check) => check.command)).toEqual(
      expect.arrayContaining([
        'node scripts/pass.mjs lint',
        'node scripts/pass.mjs test',
        'node scripts/pass.mjs e2e',
      ]),
    );
    expect(events).toContain('"type":"verification.started"');
    expect(events).toContain('"type":"verification.completed"');
    expect(events).toContain('"type":"review_packet.generated"');
    expect(events).toContain('"type":"run.completed"');
  }, 20_000);

  it('completes a codex-cli run when the structured output schema is strict-schema compatible', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'codex-cli-spec.md',
      'Update `README.md` with a short docs-only note.',
    );
    const codexPath = resolve(repoRoot, 'scripts', 'codex');

    await writeFile(
      codexPath,
      [
        '#!/usr/bin/env node',
        "const { readFileSync, writeFileSync } = require('node:fs');",
        'const args = process.argv.slice(2);',
        "const schemaPath = args[args.indexOf('--output-schema') + 1];",
        "const lastMessagePath = args[args.indexOf('--output-last-message') + 1];",
        "const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));",
        'const commandItem = schema?.properties?.commandsExecuted?.items;',
        'const notesType = commandItem?.properties?.notes?.type;',
        "if (!Array.isArray(commandItem?.required) || !commandItem.required.includes('notes')) {",
        "  console.error('commandsExecuted.items.required must include notes');",
        '  process.exit(1);',
        '}',
        "if (!Array.isArray(notesType) || !notesType.includes('string') || !notesType.includes('null')) {",
        "  console.error('commandsExecuted.items.properties.notes must be nullable');",
        '  process.exit(1);',
        '}',
        'const metadata = schema?.properties?.metadata;',
        "if (metadata?.type !== 'object' || metadata?.additionalProperties !== false) {",
        "  console.error('metadata must be a closed object');",
        '  process.exit(1);',
        '}',
        'if (!Array.isArray(metadata?.required) || metadata.required.length !== 0) {',
        "  console.error('metadata.required must be an empty array');",
        '  process.exit(1);',
        '}',
        'writeFileSync(',
        '  lastMessagePath,',
        '  `${JSON.stringify(',
        '    {',
        "      status: 'completed',",
        "      summary: 'Structured response emitted.',",
        '      commandsExecuted: [],',
        "      commandsExecutedCompleteness: 'complete',",
        '      reportedChangedFiles: [],',
        "      reportedChangedFilesCompleteness: 'complete',",
        '      limitations: [],',
        '      notes: [],',
        '      metadata: {},',
        '    },',
        '    null,',
        '    2,',
        '  )}\\n`,',
        "  'utf8',",
        ');',
        "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'test-thread' }));",
        "console.log(JSON.stringify({ type: 'turn.started' }));",
      ].join('\n'),
      'utf8',
    );
    execFileSync('chmod', ['+x', codexPath], { cwd: repoRoot });

    const originalPath = process.env.PATH;
    process.env.PATH = `${resolve(repoRoot, 'scripts')}:${originalPath ?? ''}`;

    try {
      const summary = await runSpecFile(specPath, {
        approvalMode: 'fail',
        cwd: repoRoot,
        runner: 'codex-cli',
      });
      const runnerResult = await readJson<{ summary: string }>(
        resolve(summary.artifactsDirectory, 'runner.result.json'),
      );

      expect(summary.status).toBe('completed');
      expect(summary.verificationStatus).toBe('passed');
      expect(runnerResult.summary).toBe('Structured response emitted.');
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('fails the run when a mandatory verification command fails', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/fail.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'failing-verification-spec.md',
      'Update `docs/fake-run-output.md` with a short docs-only note.',
    );

    const summary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });
    const events = await readFile(resolve(summary.artifactsDirectory, 'events.jsonl'), 'utf8');
    const verificationResult = await readJson<{
      status: string;
      completionDecision: { canComplete: boolean };
      commands: Array<{ command: string; status: string; mandatory: boolean }>;
    }>(resolve(summary.artifactsDirectory, 'verification.result.json'));

    expect(summary.status).toBe('failed');
    expect(summary.verificationStatus).toBe('failed');
    expect(summary.exitCode).toBe(1);
    expect(verificationResult.status).toBe('failed');
    expect(verificationResult.completionDecision.canComplete).toBe(false);
    expect(verificationResult.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'node scripts/fail.mjs test',
          mandatory: true,
          status: 'failed',
        }),
      ]),
    );
    expect(events).toContain('"type":"verification.failed"');
    expect(events).toContain('"type":"run.failed"');
  });

  it('fails verification when the packet is incomplete because no mandatory checks were configured', async () => {
    const repoRoot = await createTempRepo({
      preflight: [],
      postrun: [],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'incomplete-packet-spec.md',
      'Update `docs/fake-run-output.md` with a short docs-only note.',
    );

    const summary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });
    const packetCompleteness = await readJson<{
      status: string;
      incompleteSections: string[];
    }>(resolve(summary.artifactsDirectory, 'packet-completeness.json'));
    const verificationResult = await readJson<{
      status: string;
      checks: Array<{ name: string; status: string; summary: string }>;
    }>(resolve(summary.artifactsDirectory, 'verification.result.json'));

    expect(summary.status).toBe('failed');
    expect(summary.verificationStatus).toBe('failed');
    expect(packetCompleteness.status).toBe('failed');
    expect(packetCompleteness.incompleteSections).toContain('tests_checks_run');
    expect(verificationResult.status).toBe('failed');
    expect(verificationResult.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'verification.commands.executed',
          status: 'failed',
          summary: 'No mandatory verification commands were configured.',
        }),
      ]),
    );
  });

  it('fails verification when the raw runner summary contains an unsupported certainty claim', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'unsupported-claim-spec.md',
      'Update `docs/fake-run-output.md` to be production-ready.',
    );

    const summary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });
    const claimChecks = await readJson<{
      status: string;
      results: Array<{ field?: string; status: string; reason: string }>;
    }>(resolve(summary.artifactsDirectory, 'claim-checks.json'));
    const reviewPacket = await readJson<{
      runnerReportedSummary: string;
      limitations: string[];
    }>(resolve(summary.artifactsDirectory, 'review-packet.json'));

    expect(summary.status).toBe('failed');
    expect(summary.verificationStatus).toBe('failed');
    expect(claimChecks.status).toBe('failed');
    expect(claimChecks.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'runnerResult.summary',
          status: 'failed',
        }),
      ]),
    );
    expect(reviewPacket.runnerReportedSummary).not.toContain('production-ready');
    expect(reviewPacket.limitations).toContain(
      'The raw runner summary used unsupported certainty language and was replaced with an evidence-based note in this packet.',
    );
  });

  it('does not fail verification when the objective uses "complete" as a task verb', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'complete-task-verb-spec.md',
      'Update `docs/fake-run-output.md` with a short note that shows the governed run can complete a low-risk docs task end to end.',
    );

    const summary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });
    const claimChecks = await readJson<{
      status: string;
      results: Array<{ field?: string; status: string }>;
    }>(resolve(summary.artifactsDirectory, 'claim-checks.json'));

    expect(summary.status).toBe('completed');
    expect(summary.verificationStatus).toBe('passed');
    expect(claimChecks.status).toBe('passed');
    expect(
      claimChecks.results.find((result) => result.field === 'runnerResult.summary')?.status,
    ).toBe('passed');
  });
});

describe('benchmark CLI flows', () => {
  it('runs the seeded smoke suite, compares against the baseline, and can show the persisted run', async () => {
    const benchmarkSummary = await runBenchmarkTargetId('smoke', {
      ciSafe: true,
      cwd: repoRoot,
    });

    benchmarkRunDirectories.push(benchmarkSummary.artifactsDirectory);

    expect(benchmarkSummary.status).toBe('completed');
    expect(benchmarkSummary.caseCount).toBe(10);
    expect(benchmarkSummary.score).toBe(1);
    expect(benchmarkSummary.baselineLabel).toBe('Smoke baseline 2026-03-23');
    expect(benchmarkSummary.regressionStatus).toBe('passed');
    const showSummary = await showBenchmarkRunId(benchmarkSummary.benchmarkRunId, {
      cwd: repoRoot,
    });

    expect(showSummary.benchmarkRunId).toBe(benchmarkSummary.benchmarkRunId);
    expect(showSummary.caseCount).toBe(10);
  }, 20_000);

  it('runs a fresh benchmark case end to end through the CLI benchmark surface', async () => {
    const benchmarkSummary = await runBenchmarkTargetId('fresh-docs-run-lifecycle-service-rfc', {
      ciSafe: true,
      cwd: repoRoot,
    });

    benchmarkRunDirectories.push(benchmarkSummary.artifactsDirectory);

    expect(benchmarkSummary.status).toBe('completed');
    expect(benchmarkSummary.caseCount).toBe(1);
    expect(benchmarkSummary.suiteId).toBe('fresh');
    expect(benchmarkSummary.targetKind).toBe('case');
    expect(benchmarkSummary.score).toBe(1);
  }, 20_000);
});

describe('verifyRunId', () => {
  it('re-runs verification for an existing run and persists the latest result', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'verify-rerun-spec.md',
      'Update `docs/fake-run-output.md` with a short docs-only note.',
    );

    const initialSummary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });

    await writeJson(resolve(repoRoot, 'gdh.config.json'), {
      verification: {
        preflight: ['node scripts/pass.mjs lint'],
        postrun: ['node scripts/fail.mjs test'],
        optional: [],
      },
    });

    const rerunSummary = await verifyRunId(initialSummary.runId, {
      cwd: repoRoot,
    });
    const events = await readFile(
      resolve(initialSummary.artifactsDirectory, 'events.jsonl'),
      'utf8',
    );
    const runRecord = await readJson<{
      status: string;
      verificationStatus: string;
      verificationResultPath?: string;
    }>(resolve(initialSummary.artifactsDirectory, 'run.json'));
    const verificationResult = await readJson<{
      status: string;
      commands: Array<{ command: string; status: string }>;
    }>(resolve(initialSummary.artifactsDirectory, 'verification.result.json'));

    expect(initialSummary.status).toBe('completed');
    expect(initialSummary.verificationStatus).toBe('passed');
    expect(rerunSummary.status).toBe('failed');
    expect(rerunSummary.verificationStatus).toBe('failed');
    expect(runRecord.status).toBe('failed');
    expect(runRecord.verificationStatus).toBe('failed');
    expect(runRecord.verificationResultPath).toBe(rerunSummary.verificationResultPath);
    expect(verificationResult.status).toBe('failed');
    expect(verificationResult.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'node scripts/fail.mjs test',
          status: 'failed',
        }),
      ]),
    );
    expect(events.match(/"type":"verification.started"/g)).toHaveLength(2);
    expect(events).toContain('"type":"run.failed"');
  });
});

describe('status and resume', () => {
  it('inspects an approval-paused run with durable status output', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'approval-spec.md',
      'Update `src/auth/login.ts` with a deterministic protected note.',
    );

    const runSummary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });
    const statusSummary = await statusRunId(runSummary.runId, {
      cwd: repoRoot,
    });

    expect(runSummary.status).toBe('awaiting_approval');
    expect(statusSummary.status).toBe('awaiting_approval');
    expect(statusSummary.resumeEligible).toBe(true);
    expect(statusSummary.nextStage).toBe('awaiting_approval');
    expect(statusSummary.manifestPath).toContain('session.manifest.json');
    expect(statusSummary.approvalPacketPath).toContain('approval-packet.md');
  });

  it('resumes an approval-paused run and completes it after approval is granted', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'approval-resume-spec.md',
      'Update `src/auth/login.ts` with a deterministic protected note.',
    );

    const pausedSummary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });
    const resumedSummary = await resumeRunId(pausedSummary.runId, {
      approvalResolver: async () => 'approved',
      cwd: repoRoot,
    });
    const manifest = await readJson<{
      status: string;
      verificationState: { status: string };
    }>(resolve(pausedSummary.artifactsDirectory, 'session.manifest.json'));

    expect(resumedSummary.status).toBe('completed');
    expect(resumedSummary.verificationStatus).toBe('passed');
    expect(manifest.status).toBe('completed');
    expect(manifest.verificationState.status).toBe('passed');
  });

  it('keeps approval resolved when the resumed runner fails after approval is granted', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'approval-failed-runner-spec.md',
      'Update `src/auth/login.ts` with a deterministic protected note.',
    );
    const codexPath = resolve(repoRoot, 'scripts', 'codex');

    await writeFile(
      codexPath,
      ['#!/bin/sh', 'echo "synthetic codex failure after approval" >&2', 'exit 1'].join('\n'),
      'utf8',
    );
    execFileSync('chmod', ['+x', codexPath], { cwd: repoRoot });

    const pausedSummary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'codex-cli',
    });

    const originalPath = process.env.PATH;
    process.env.PATH = `${resolve(repoRoot, 'scripts')}:${originalPath ?? ''}`;

    try {
      const resumedSummary = await resumeRunId(pausedSummary.runId, {
        approvalResolver: async () => 'approved',
        cwd: repoRoot,
      });
      const statusSummary = await statusRunId(pausedSummary.runId, {
        cwd: repoRoot,
      });
      const manifest = await readJson<{
        approvalState: { status: string };
        currentStage: string;
        pendingStage: string;
        status: string;
      }>(resolve(pausedSummary.artifactsDirectory, 'session.manifest.json'));

      expect(resumedSummary.approvalResolution).toBe('approved');
      expect(resumedSummary.status).toBe('resumable');
      expect(resumedSummary.currentStage).toBe('runner_started');
      expect(resumedSummary.nextStage).toBe('runner_started');
      expect(statusSummary.nextStage).toBe('runner_started');
      expect(manifest.status).toBe('resumable');
      expect(manifest.currentStage).not.toBe('awaiting_approval');
      expect(manifest.pendingStage).toBe('runner_started');
      expect(manifest.approvalState.status).toBe('approved');
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('reuses a persisted approval resolution instead of prompting again on resume', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'approval-reuse-spec.md',
      'Update `src/auth/login.ts` with a deterministic protected note.',
    );

    const pausedSummary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });
    const approvalPacket = await readJson<{ id: string }>(
      resolve(pausedSummary.artifactsDirectory, 'approval-packet.json'),
    );

    await writeJson(resolve(pausedSummary.artifactsDirectory, 'approval-resolution.json'), {
      id: 'approval-resolution-reused',
      runId: pausedSummary.runId,
      approvalPacketId: approvalPacket.id,
      resolution: 'approved',
      actor: 'test',
      notes: ['Approval was already granted before this resume attempt.'],
      createdAt: new Date().toISOString(),
    });

    const resumedSummary = await resumeRunId(pausedSummary.runId, {
      cwd: repoRoot,
    });

    expect(resumedSummary.status).toBe('completed');
    expect(resumedSummary.approvalResolution).toBe('approved');
    expect(resumedSummary.verificationStatus).toBe('passed');
  });

  it('resumes a run from the persisted plan checkpoint', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'resume-plan-spec.md',
      'Update `docs/fake-run-output.md` with a short docs-only note.',
    );

    const completedSummary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });
    const planCheckpointPath = await checkpointPathForStage(
      completedSummary.artifactsDirectory,
      'plan_created',
    );
    const planCheckpoint = await readJson<{ id: string }>(planCheckpointPath as string);

    await Promise.all([
      rm(resolve(completedSummary.artifactsDirectory, 'impact-preview.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'policy.input.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'policy.decision.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'runner.result.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'commands-executed.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'changed-files.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'diff.patch'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'policy-audit.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'verification.result.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'review-packet.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'review-packet.md'), { force: true }),
    ]);
    await writeRunFixtureState(completedSummary.artifactsDirectory, ({ manifest, run }) => {
      run.status = 'interrupted';
      run.currentStage = 'plan_created';
      run.lastSuccessfulStage = 'plan_created';
      run.pendingStage = 'policy_evaluated';
      run.lastCheckpointId = planCheckpoint.id;
      run.verificationStatus = 'not_run';
      manifest.status = 'interrupted';
      manifest.currentStage = 'plan_created';
      manifest.lastSuccessfulStage = 'plan_created';
      manifest.pendingStage = 'policy_evaluated';
      manifest.pendingStep = 'policy.evaluated';
      manifest.lastCheckpointId = planCheckpoint.id;
      manifest.verificationState.status = 'not_run';
      manifest.summary = 'Interrupted after plan generation.';
    });

    const resumedSummary = await resumeRunId(completedSummary.runId, {
      cwd: repoRoot,
    });

    expect(resumedSummary.status).toBe('completed');
    expect(resumedSummary.verificationStatus).toBe('passed');
    expect(
      await readFile(resolve(completedSummary.artifactsDirectory, 'policy.decision.json'), 'utf8'),
    ).toContain('"decision": "allow"');
  });

  it('resumes from the post-run checkpoint and re-runs verification from a clean boundary', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'resume-verification-spec.md',
      'Update `docs/fake-run-output.md` with a short docs-only note.',
    );

    const completedSummary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });
    const runnerCheckpointPath = await checkpointPathForStage(
      completedSummary.artifactsDirectory,
      'runner_completed',
    );
    const runnerCheckpoint = await readJson<{ id: string }>(runnerCheckpointPath as string);

    await Promise.all([
      rm(resolve(completedSummary.artifactsDirectory, 'verification.result.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'review-packet.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'review-packet.md'), { force: true }),
    ]);
    await writeRunFixtureState(completedSummary.artifactsDirectory, ({ manifest, run }) => {
      run.status = 'interrupted';
      run.currentStage = 'runner_completed';
      run.lastSuccessfulStage = 'runner_completed';
      run.pendingStage = 'verification_started';
      run.lastCheckpointId = runnerCheckpoint.id;
      run.verificationStatus = 'not_run';
      manifest.status = 'interrupted';
      manifest.currentStage = 'runner_completed';
      manifest.lastSuccessfulStage = 'runner_completed';
      manifest.pendingStage = 'verification_started';
      manifest.pendingStep = 'verification.started';
      manifest.lastCheckpointId = runnerCheckpoint.id;
      manifest.verificationState.status = 'not_run';
      manifest.summary = 'Interrupted before verification.';
    });

    const resumedSummary = await resumeRunId(completedSummary.runId, {
      cwd: repoRoot,
    });

    expect(resumedSummary.status).toBe('completed');
    expect(resumedSummary.verificationStatus).toBe('passed');
    expect(
      await readFile(
        resolve(completedSummary.artifactsDirectory, 'verification.result.json'),
        'utf8',
      ),
    ).toContain('"status": "passed"');
  });

  it('refuses to resume when continuity is incompatible', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'incompatible-spec.md',
      'Update `docs/fake-run-output.md` with a short docs-only note.',
    );

    const completedSummary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });
    const planCheckpointPath = await checkpointPathForStage(
      completedSummary.artifactsDirectory,
      'plan_created',
    );
    const planCheckpoint = await readJson<{ id: string }>(planCheckpointPath as string);

    await writeRunFixtureState(completedSummary.artifactsDirectory, ({ manifest, run }) => {
      run.status = 'interrupted';
      run.currentStage = 'plan_created';
      run.lastSuccessfulStage = 'plan_created';
      run.pendingStage = 'policy_evaluated';
      run.lastCheckpointId = planCheckpoint.id;
      manifest.status = 'interrupted';
      manifest.currentStage = 'plan_created';
      manifest.lastSuccessfulStage = 'plan_created';
      manifest.pendingStage = 'policy_evaluated';
      manifest.pendingStep = 'policy.evaluated';
      manifest.lastCheckpointId = planCheckpoint.id;
      manifest.workspace.lastSnapshot.repoRoot = '/tmp/elsewhere';
      manifest.summary = 'Interrupted after plan generation.';
    });

    const statusSummary = await statusRunId(completedSummary.runId, {
      cwd: repoRoot,
    });

    expect(statusSummary.resumeEligible).toBe(false);
    expect(statusSummary.continuityStatus).toBe('incompatible');
    await expect(
      resumeRunId(completedSummary.runId, {
        cwd: repoRoot,
      }),
    ).rejects.toThrow(/cannot be resumed/i);
  });

  it('denies resume when a critical artifact is missing', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'missing-artifact-spec.md',
      'Update `docs/fake-run-output.md` with a short docs-only note.',
    );

    const completedSummary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });
    const runnerCheckpointPath = await checkpointPathForStage(
      completedSummary.artifactsDirectory,
      'runner_completed',
    );
    const runnerCheckpoint = await readJson<{ id: string }>(runnerCheckpointPath as string);

    await rm(resolve(completedSummary.artifactsDirectory, 'policy-audit.json'), { force: true });
    await writeRunFixtureState(completedSummary.artifactsDirectory, ({ manifest, run }) => {
      run.status = 'interrupted';
      run.currentStage = 'runner_completed';
      run.lastSuccessfulStage = 'runner_completed';
      run.pendingStage = 'verification_started';
      run.lastCheckpointId = runnerCheckpoint.id;
      run.verificationStatus = 'not_run';
      manifest.status = 'interrupted';
      manifest.currentStage = 'runner_completed';
      manifest.lastSuccessfulStage = 'runner_completed';
      manifest.pendingStage = 'verification_started';
      manifest.pendingStep = 'verification.started';
      manifest.lastCheckpointId = runnerCheckpoint.id;
      manifest.verificationState.status = 'not_run';
      manifest.summary = 'Interrupted before verification.';
    });

    const statusSummary = await statusRunId(completedSummary.runId, {
      cwd: repoRoot,
    });

    expect(statusSummary.resumeEligible).toBe(false);
    await expect(
      resumeRunId(completedSummary.runId, {
        cwd: repoRoot,
      }),
    ).rejects.toThrow(/cannot be resumed/i);
  });
});
