import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProgram, runSpecFile, verifyRunId } from '../src/index';

const tempDirectories: string[] = [];

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
});

describe('createProgram', () => {
  it('registers the CLI command surface', () => {
    const program = createProgram();

    expect(program.name()).toBe('gdh');
    expect(program.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining([
        'run',
        'resume',
        'approve',
        'verify',
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
    }>(resolve(summary.artifactsDirectory, 'run.json'));
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
    expect(runRecord.verificationStatus).toBe('passed');
    expect(runRecord.verificationResultPath).toBe(summary.verificationResultPath);
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
