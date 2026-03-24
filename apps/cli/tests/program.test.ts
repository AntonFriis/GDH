import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProgram,
  runBenchmarkTargetId,
  runSpecFile,
  showBenchmarkRunId,
  statusRunId,
} from '../src/index';
import { formatBenchmarkCommandSummary } from '../src/summaries.js';
import {
  benchmarkRunDirectories,
  cleanupBenchmarkRunDirectories,
  cleanupTempDirectories,
  createTempRepo,
  writeSpec,
} from './test-helpers.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupTempDirectories();
  await cleanupBenchmarkRunDirectories();
  process.exitCode = undefined;
});

async function writeProgressCodexScript(repoRoot: string): Promise<string> {
  const codexPath = resolve(repoRoot, 'scripts', 'codex');

  await writeFile(
    codexPath,
    [
      '#!/usr/bin/env node',
      "const { writeFileSync } = require('node:fs');",
      'const args = process.argv.slice(2);',
      "const lastMessagePath = args[args.indexOf('--output-last-message') + 1];",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'program-thread' }));",
      "console.log(JSON.stringify({ type: 'item.started', item: { id: 'cmd_1', type: 'command_execution', command: 'git status --short', aggregated_output: '', exit_code: null, status: 'in_progress' } }));",
      "console.log('plain stdout progress line');",
      "console.error('plain stderr progress line');",
      'writeFileSync(',
      '  lastMessagePath,',
      '  `${JSON.stringify({',
      "    status: 'completed',",
      "    summary: 'CLI progress runner completed.',",
      '    commandsExecuted: [],',
      "    commandsExecutedCompleteness: 'complete',",
      '    reportedChangedFiles: [],',
      "    reportedChangedFilesCompleteness: 'complete',",
      '    limitations: [],',
      '    notes: [],',
      '    metadata: {},',
      '  })}\\n`,',
      "  'utf8',",
      ');',
    ].join('\n'),
    'utf8',
  );
  execFileSync('chmod', ['+x', codexPath], { cwd: repoRoot });

  return codexPath;
}

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

describe('CLI packaging surface', () => {
  it('points the repo and package gdh entrypoints at the executable program module', async () => {
    const rootPackage = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const cliPackage = JSON.parse(
      await readFile(resolve(repoRoot, 'apps/cli/package.json'), 'utf8'),
    ) as {
      bin?: Record<string, string>;
    };

    expect(rootPackage.scripts?.gdh).toBe('node apps/cli/dist/program.js');
    expect(cliPackage.bin?.gdh).toBe('dist/program.js');
  });
});

describe('runSpecFile validation', () => {
  it('rejects unsupported runner values before invoking the lifecycle service', async () => {
    const repoRoot = await createTempRepo();
    const specPath = await writeSpec(repoRoot, 'invalid-runner-spec.md', 'Update README.md.');

    await expect(
      runSpecFile(specPath, {
        approvalMode: 'fail',
        cwd: repoRoot,
        runner: 'not-a-runner' as 'fake',
      }),
    ).rejects.toThrow('Unsupported runner "not-a-runner"');
  });

  it('rejects unsupported approval modes before invoking the lifecycle service', async () => {
    const repoRoot = await createTempRepo();
    const specPath = await writeSpec(repoRoot, 'invalid-approval-spec.md', 'Update README.md.');

    await expect(
      runSpecFile(specPath, {
        approvalMode: 'later' as 'fail',
        cwd: repoRoot,
        runner: 'fake',
      }),
    ).rejects.toThrow('Unsupported approval mode "later"');
  });

  it('requires exactly one run source', async () => {
    const repoRoot = await createTempRepo();
    const specPath = await writeSpec(repoRoot, 'dual-source-spec.md', 'Update README.md.');

    await expect(
      runSpecFile(undefined, {
        approvalMode: 'fail',
        cwd: repoRoot,
        runner: 'fake',
      }),
    ).rejects.toThrow('Provide exactly one run source');

    await expect(
      runSpecFile(specPath, {
        approvalMode: 'fail',
        cwd: repoRoot,
        githubIssue: 'acme/gdh#42',
        runner: 'fake',
      }),
    ).rejects.toThrow('Provide exactly one run source');
  });
});

describe('CLI shell wiring', () => {
  it('prints JSON output for the run command', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'run-command-json-spec.md',
      'Update `docs/fake-run-output.md` with a short docs-only note.',
    );
    const program = createProgram();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(repoRoot);
      await program.parseAsync(
        ['run', specPath, '--runner', 'fake', '--approval-mode', 'fail', '--json'],
        { from: 'user' },
      );
    } finally {
      process.chdir(originalCwd);
    }

    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(JSON.parse(consoleLog.mock.calls[0]?.[0] as string)).toEqual(
      expect.objectContaining({
        status: 'completed',
        verificationStatus: 'passed',
      }),
    );
    expect(process.exitCode).toBe(0);
  }, 40_000);

  it('streams live runner progress to stdout in terminal mode', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'run-command-progress-spec.md',
      'Update `README.md` with a short docs-only note.',
    );
    await writeProgressCodexScript(repoRoot);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const originalPath = process.env.PATH;
    process.env.PATH = `${resolve(repoRoot, 'scripts')}:${originalPath ?? ''}`;

    try {
      const summary = await runSpecFile(specPath, {
        approvalMode: 'fail',
        cwd: repoRoot,
        json: false,
        runner: 'codex-cli',
      });

      expect(summary.status).toBe('completed');
      expect(stdoutWrite.mock.calls.some((call) => String(call[0]).includes('[runner]'))).toBe(
        true,
      );
      expect(stderrWrite.mock.calls.some((call) => String(call[0]).includes('[runner]'))).toBe(
        false,
      );
    } finally {
      process.env.PATH = originalPath;
    }
  }, 40_000);

  it('keeps JSON output on stdout and routes live progress to stderr', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'run-command-json-progress-spec.md',
      'Update `README.md` with a short docs-only note.',
    );
    await writeProgressCodexScript(repoRoot);
    const program = createProgram();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const originalCwd = process.cwd();
    const originalPath = process.env.PATH;
    process.env.PATH = `${resolve(repoRoot, 'scripts')}:${originalPath ?? ''}`;

    try {
      process.chdir(repoRoot);
      await program.parseAsync(
        ['run', specPath, '--runner', 'codex-cli', '--approval-mode', 'fail', '--json'],
        { from: 'user' },
      );
    } finally {
      process.chdir(originalCwd);
      process.env.PATH = originalPath;
    }

    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(JSON.parse(consoleLog.mock.calls[0]?.[0] as string)).toEqual(
      expect.objectContaining({
        status: 'completed',
        verificationStatus: 'passed',
      }),
    );
    expect(stderrWrite.mock.calls.some((call) => String(call[0]).includes('[runner]'))).toBe(true);
    expect(stdoutWrite.mock.calls.some((call) => String(call[0]).includes('[runner]'))).toBe(false);
  }, 40_000);

  it('prints terminal output for the status command', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'status-command-terminal-spec.md',
      'Update `docs/fake-run-output.md` with a short docs-only note.',
    );
    const runSummary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });
    const program = createProgram();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const originalCwd = process.cwd();

    try {
      process.chdir(repoRoot);
      await program.parseAsync(['status', runSummary.runId], { from: 'user' });
    } finally {
      process.chdir(originalCwd);
    }

    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(consoleLog.mock.calls[0]?.[0]).toContain(`Run completed: ${runSummary.runId}`);
    expect(consoleLog.mock.calls[0]?.[0]).toContain('Verification status: passed');
    expect(process.exitCode).toBe(0);
  }, 40_000);

  it('keeps the wrapper smoke path working for direct run/status calls', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'wrapper-smoke-spec.md',
      'Update `docs/fake-run-output.md` with a short docs-only note.',
    );

    const runSummary = await runSpecFile(specPath, {
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
    });
    const statusSummary = await statusRunId(runSummary.runId, {
      cwd: repoRoot,
    });

    expect(runSummary.status).toBe('completed');
    expect(statusSummary.runId).toBe(runSummary.runId);
    expect(statusSummary.status).toBe('completed');
    expect(statusSummary.currentStage).toBe('verification_completed');
  }, 40_000);
});

describe('benchmark CLI flows', () => {
  it('runs the seeded smoke suite and can show the persisted benchmark run', async () => {
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
    expect(benchmarkSummary.governedRuns).toHaveLength(10);
    expect(benchmarkSummary.governedRuns[0]).toEqual(
      expect.objectContaining({
        caseId: expect.any(String),
        runDirectory: expect.stringContaining('/runs/local/'),
        runId: expect.any(String),
      }),
    );
    const showSummary = await showBenchmarkRunId(benchmarkSummary.benchmarkRunId, {
      cwd: repoRoot,
    });

    expect(showSummary.benchmarkRunId).toBe(benchmarkSummary.benchmarkRunId);
    expect(showSummary.caseCount).toBe(10);
    expect(showSummary.governedRuns).toHaveLength(10);
    expect(formatBenchmarkCommandSummary(showSummary)).toContain(
      showSummary.governedRuns[0]?.runId,
    );
  }, 40_000);

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
    expect(benchmarkSummary.governedRuns).toEqual([
      expect.objectContaining({
        caseId: 'fresh-docs-run-lifecycle-service-rfc',
        runDirectory: expect.stringContaining('/runs/local/'),
        runId: expect.any(String),
      }),
    ]);
  }, 20_000);
});
