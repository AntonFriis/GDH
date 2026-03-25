import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { RunnerContext } from '@gdh/domain';
import { createPlanFromSpec, createRunRecord, normalizeMarkdownSpec } from '@gdh/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { createCodexCliRunner, type RunnerProgressEvent } from '../src/index.js';

const tempDirectories: string[] = [];

async function createRunnerContext(repoRoot: string): Promise<RunnerContext> {
  const spec = normalizeMarkdownSpec({
    content: [
      '# Runner Progress Smoke',
      '',
      '## Objective',
      'Update `README.md` with a short docs-only note.',
      '',
      '## Acceptance Criteria',
      '- The note is reflected in the review packet.',
    ].join('\n'),
    repoRoot,
    sourcePath: resolve(repoRoot, 'spec.md'),
    createdAt: '2026-03-24T10:00:00.000Z',
  });
  const plan = createPlanFromSpec(spec, '2026-03-24T10:01:00.000Z');
  const run = createRunRecord({
    approvalMode: 'fail',
    approvalPolicy: 'on-request',
    createdAt: '2026-03-24T10:00:00.000Z',
    model: 'gpt-5.4',
    networkAccess: false,
    plan,
    policyPackName: 'default',
    policyPackPath: resolve(repoRoot, 'policies/default.policy.yaml'),
    policyPackVersion: 1,
    repoRoot,
    runDirectory: resolve(repoRoot, 'runs', 'local', 'runner-progress-smoke'),
    runId: 'runner-progress-smoke',
    runner: 'codex-cli',
    sandboxMode: 'workspace-write',
    spec,
  });

  return {
    approvalPacket: undefined,
    impactPreview: {
      id: 'impact-1',
      runId: run.id,
      specId: spec.id,
      planId: plan.id,
      summary: 'Docs-only preview.',
      rationale: ['Docs path only.'],
      requestedSandboxMode: 'workspace-write',
      requestedNetworkAccess: false,
      taskClass: 'docs',
      riskHints: [],
      actionKinds: ['read', 'write'],
      proposedFileChanges: [
        {
          path: 'README.md',
          pathKind: 'file',
          actionKind: 'write',
          confidence: 'high',
        },
      ],
      proposedCommands: [],
      uncertaintyNotes: [],
      createdAt: '2026-03-24T10:00:30.000Z',
    },
    plan,
    policyDecision: {
      actionKinds: ['read', 'write'],
      affectedPaths: ['README.md'],
      approvalPolicy: 'on-request',
      createdAt: '2026-03-24T10:00:45.000Z',
      decision: 'allow',
      matchedCommands: [],
      matchedRules: [
        {
          decision: 'allow',
          matchedOn: ['path', 'action'],
          ruleId: 'docs-safe',
          specificity: 140,
        },
      ],
      networkAccess: false,
      notes: [],
      policyPackName: 'default',
      policyPackPath: resolve(repoRoot, 'policies/default.policy.yaml'),
      policyPackVersion: 1,
      reasons: [
        {
          decision: 'allow',
          matchedOn: ['path', 'action'],
          ruleId: 'docs-safe',
          specificity: 140,
          summary: 'Rule "docs-safe" matched "README.md".',
        },
      ],
      requiredApprovalMode: null,
      sandboxMode: 'workspace-write',
      uncertaintyNotes: [],
    },
    priorArtifacts: [],
    repoRoot,
    run,
    runDirectory: run.runDirectory,
    spec,
    verificationRequirements: ['pnpm lint:root'],
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('CodexCliRunner', () => {
  it('emits incremental progress events while the child process is running', async () => {
    const repoRoot = await mkdtemp(resolve(tmpdir(), 'gdh-runner-codex-test-'));
    const binaryPath = resolve(repoRoot, 'codex-progress');

    tempDirectories.push(repoRoot);
    await mkdir(resolve(repoRoot, 'policies'), { recursive: true });
    await writeFile(
      resolve(repoRoot, 'policies', 'default.policy.yaml'),
      [
        'version: 1',
        'name: default',
        'defaults:',
        '  sandbox_mode: workspace-write',
        '  network_access: false',
        '  approval_policy: on-request',
        '  fallback_decision: prompt',
        'rules: []',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      binaryPath,
      [
        '#!/usr/bin/env node',
        "const { writeFileSync } = require('node:fs');",
        'const args = process.argv.slice(2);',
        "const lastMessagePath = args[args.indexOf('--output-last-message') + 1];",
        "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'runner-progress-thread' }));",
        "console.log(JSON.stringify({ type: 'item.updated', item: { id: 'todo_1', type: 'todo_list', items: [",
        "  { text: 'Read required repo instructions', completed: true },",
        "  { text: 'Apply the bounded docs change', completed: false },",
        '] } }));',
        "console.log(JSON.stringify({ type: 'item.started', item: { id: 'cmd_1', type: 'command_execution', command: 'git status --short', aggregated_output: '', exit_code: null, status: 'in_progress' } }));",
        "console.log('plain stdout line');",
        "console.error('plain stderr line');",
        'writeFileSync(',
        '  lastMessagePath,',
        '  `${JSON.stringify({',
        "    status: 'completed',",
        "    summary: 'Runner progress smoke completed.',",
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
    execFileSync('chmod', ['+x', binaryPath], { cwd: repoRoot });

    const runner = createCodexCliRunner({ binaryPath });
    const context = await createRunnerContext(repoRoot);
    const progressEvents: RunnerProgressEvent[] = [];
    const result = await runner.execute(context, {
      onProgress: async (event) => {
        progressEvents.push(event);
      },
    });

    expect(result.status).toBe('completed');
    expect(result.summary).toBe('Runner progress smoke completed.');
    expect(
      progressEvents.some(
        (event) => event.kind === 'json_event' && event.event.type === 'thread.started',
      ),
    ).toBe(true);
    expect(
      progressEvents.some(
        (event) =>
          event.kind === 'json_event' &&
          event.event.type === 'item.updated' &&
          event.event.item?.type === 'todo_list',
      ),
    ).toBe(true);
    expect(
      progressEvents.some(
        (event) =>
          event.kind === 'json_event' &&
          event.event.type === 'item.started' &&
          event.event.item?.type === 'command_execution',
      ),
    ).toBe(true);
    expect(
      progressEvents.some(
        (event) => event.kind === 'stdout_line' && event.line === 'plain stdout line',
      ),
    ).toBe(true);
    expect(
      progressEvents.some(
        (event) => event.kind === 'stderr_line' && event.line === 'plain stderr line',
      ),
    ).toBe(true);
  });

  it('surfaces known local Codex state-db warnings as runner limitations', async () => {
    const repoRoot = await mkdtemp(resolve(tmpdir(), 'gdh-runner-codex-test-'));
    const binaryPath = resolve(repoRoot, 'codex-state-warning');

    tempDirectories.push(repoRoot);
    await mkdir(resolve(repoRoot, 'policies'), { recursive: true });
    await writeFile(
      resolve(repoRoot, 'policies', 'default.policy.yaml'),
      [
        'version: 1',
        'name: default',
        'defaults:',
        '  sandbox_mode: workspace-write',
        '  network_access: false',
        '  approval_policy: on-request',
        '  fallback_decision: prompt',
        'rules: []',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      binaryPath,
      [
        '#!/usr/bin/env node',
        "const { writeFileSync } = require('node:fs');",
        'const args = process.argv.slice(2);',
        "const lastMessagePath = args[args.indexOf('--output-last-message') + 1];",
        "console.error('failed to open state db at /Users/test/.codex/state_5.sqlite: migration 19 was previously applied but is missing in the resolved migrations');",
        "console.error('failed to initialize state runtime at /Users/test/.codex');",
        "console.error('failed to clean up shell snapshot');",
        'writeFileSync(',
        '  lastMessagePath,',
        '  `${JSON.stringify({',
        "    status: 'completed',",
        "    summary: 'Runner completed with warnings.',",
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
    execFileSync('chmod', ['+x', binaryPath], { cwd: repoRoot });

    const runner = createCodexCliRunner({ binaryPath });
    const context = await createRunnerContext(repoRoot);
    const result = await runner.execute(context);

    expect(result.status).toBe('completed');
    expect(result.summary).toContain('local state-db initialization warning under ~/.codex');
    expect(result.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('state-db initialization warning under ~/.codex'),
        expect.stringContaining('shell snapshot cleanup warning'),
      ]),
    );
    expect(result.metadata.codexStateWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining('~/.codex')]),
    );
  });

  it('falls back to the tracked plan template when a local plan file is absent', async () => {
    const repoRoot = await mkdtemp(resolve(tmpdir(), 'gdh-runner-codex-test-'));
    const binaryPath = resolve(repoRoot, 'codex-plan-template');
    const promptCapturePath = resolve(repoRoot, 'prompt.txt');

    tempDirectories.push(repoRoot);
    await mkdir(resolve(repoRoot, 'policies'), { recursive: true });
    await writeFile(
      resolve(repoRoot, 'policies', 'default.policy.yaml'),
      [
        'version: 1',
        'name: default',
        'defaults:',
        '  sandbox_mode: workspace-write',
        '  network_access: false',
        '  approval_policy: on-request',
        '  fallback_decision: prompt',
        'rules: []',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      binaryPath,
      [
        '#!/usr/bin/env node',
        "const { readFileSync, writeFileSync } = require('node:fs');",
        'const args = process.argv.slice(2);',
        "const lastMessagePath = args[args.indexOf('--output-last-message') + 1];",
        `const promptCapturePath = ${JSON.stringify(promptCapturePath)};`,
        "writeFileSync(promptCapturePath, readFileSync(0, 'utf8'), 'utf8');",
        'writeFileSync(',
        '  lastMessagePath,',
        '  `${JSON.stringify({',
        "    status: 'completed',",
        "    summary: 'Prompt capture completed.',",
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
    execFileSync('chmod', ['+x', binaryPath], { cwd: repoRoot });

    const runner = createCodexCliRunner({ binaryPath });
    const context = await createRunnerContext(repoRoot);
    await runner.execute(context);

    const prompt = await readFile(promptCapturePath, 'utf8');

    expect(prompt).toContain('PLANS.md (if present; otherwise PLANS.example.md)');
  });
});
