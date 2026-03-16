import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProgram, runSpecFile } from '../src/index';

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

async function createTempRepo(): Promise<string> {
  const repoRoot = await mkdtemp(resolve(tmpdir(), 'gdh-cli-test-'));

  tempDirectories.push(repoRoot);

  execFileSync('git', ['init'], { cwd: repoRoot });
  await mkdir(resolve(repoRoot, 'runs', 'local'), { recursive: true });
  await mkdir(resolve(repoRoot, 'policies'), { recursive: true });
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
  execFileSync('git', ['add', '.'], { cwd: repoRoot });

  return repoRoot;
}

async function writeSpec(repoRoot: string, fileName: string, objective: string): Promise<string> {
  const specPath = resolve(repoRoot, fileName);

  await writeFile(
    specPath,
    [
      '---',
      'title: CLI Policy Test',
      'task_type: docs',
      'constraints:',
      '  - Keep the change deterministic.',
      'acceptance_criteria:',
      '  - Persist the expected artifacts.',
      '---',
      '',
      '# CLI Policy Test',
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
  it('allows a safe docs run to complete with policy artifacts', async () => {
    const repoRoot = await createTempRepo();
    const specPath = await writeSpec(
      repoRoot,
      'allow-spec.md',
      'Update `docs/fake-run-output.md` with a short docs-only note.',
    );

    const summary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });

    const events = await readFile(resolve(summary.artifactsDirectory, 'events.jsonl'), 'utf8');
    const runRecord = await readFile(resolve(summary.artifactsDirectory, 'run.json'), 'utf8');

    expect(summary.status).toBe('completed');
    expect(summary.policyDecision).toBe('allow');
    expect(summary.changedFiles).toContain('docs/fake-run-output.md');
    expect(summary.approvalPacketPath).toBeUndefined();
    expect(events).toContain('"type":"impact_preview.created"');
    expect(events).toContain('"type":"policy.evaluated"');
    expect(events).toContain('"type":"runner.completed"');
    expect(events).toContain('"type":"run.completed"');
    expect(runRecord).toContain('"status": "completed"');
    expect(runRecord).toContain('"approvalMode": "fail"');
  });

  it('prompts and continues when an interactive approval is granted', async () => {
    const repoRoot = await createTempRepo();
    const specPath = await writeSpec(
      repoRoot,
      'prompt-approve-spec.md',
      'Update `src/auth/guard.ts` with a protected docs-adjacent note.',
    );

    const summary = await runSpecFile(specPath, {
      approvalMode: 'interactive',
      approvalResolver: async () => 'approved',
      cwd: repoRoot,
      runner: 'fake',
    });

    const events = await readFile(resolve(summary.artifactsDirectory, 'events.jsonl'), 'utf8');
    const resolution = await readFile(
      resolve(summary.artifactsDirectory, 'approval-resolution.json'),
      'utf8',
    );

    expect(summary.status).toBe('completed');
    expect(summary.policyDecision).toBe('prompt');
    expect(summary.approvalResolution).toBe('approved');
    expect(summary.changedFiles).toContain('src/auth/guard.ts');
    expect(summary.approvalPacketPath).toBeDefined();
    expect(events).toContain('"type":"approval.requested"');
    expect(events).toContain('"type":"approval.granted"');
    expect(resolution).toContain('"resolution": "approved"');
  });

  it('prompts and cancels when an interactive approval is denied', async () => {
    const repoRoot = await createTempRepo();
    const specPath = await writeSpec(
      repoRoot,
      'prompt-deny-spec.md',
      'Update `src/auth/guard.ts` with a protected docs-adjacent note.',
    );

    const summary = await runSpecFile(specPath, {
      approvalMode: 'interactive',
      approvalResolver: async () => 'denied',
      cwd: repoRoot,
      runner: 'fake',
    });

    const events = await readFile(resolve(summary.artifactsDirectory, 'events.jsonl'), 'utf8');
    const runRecord = await readFile(resolve(summary.artifactsDirectory, 'run.json'), 'utf8');

    expect(summary.status).toBe('cancelled');
    expect(summary.changedFiles).toEqual([]);
    expect(summary.approvalResolution).toBe('denied');
    expect(summary.approvalPacketPath).toBeDefined();
    expect(events).toContain('"type":"approval.denied"');
    expect(runRecord).toContain('"status": "cancelled"');
  });

  it('forbids a secret-touching run before execution', async () => {
    const repoRoot = await createTempRepo();
    const specPath = await writeSpec(
      repoRoot,
      'forbid-spec.md',
      'Edit `.env.local` with a forbidden secret change.',
    );

    const summary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });

    const events = await readFile(resolve(summary.artifactsDirectory, 'events.jsonl'), 'utf8');

    expect(summary.status).toBe('failed');
    expect(summary.policyDecision).toBe('forbid');
    expect(summary.changedFiles).toEqual([]);
    expect(summary.approvalPacketPath).toBeUndefined();
    expect(events).toContain('"type":"policy.blocked"');
    expect(events).not.toContain('"type":"runner.started"');
  });

  it('persists a pending approval when non-interactive mode cannot resolve a prompt', async () => {
    const repoRoot = await createTempRepo();
    const specPath = await writeSpec(
      repoRoot,
      'pending-spec.md',
      'Update `src/auth/guard.ts` with a protected docs-adjacent note.',
    );

    const summary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });

    const events = await readFile(resolve(summary.artifactsDirectory, 'events.jsonl'), 'utf8');
    const runRecord = await readFile(resolve(summary.artifactsDirectory, 'run.json'), 'utf8');

    expect(summary.status).toBe('awaiting_approval');
    expect(summary.exitCode).toBe(2);
    expect(summary.changedFiles).toEqual([]);
    expect(summary.approvalPacketPath).toBeDefined();
    expect(events).toContain('"type":"approval.requested"');
    expect(events).not.toContain('"type":"approval.granted"');
    expect(runRecord).toContain('"status": "awaiting_approval"');
  });
});
