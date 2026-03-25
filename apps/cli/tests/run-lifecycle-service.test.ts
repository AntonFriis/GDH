import { execFileSync } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  captureWorkspaceSnapshot,
  createRunRelativeDirectory,
  createWorkspaceContentSnapshotArtifact,
  listArtifactReferencesFromRunDirectory,
} from '@gdh/artifact-store';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRunLifecycleService,
  summarizeInspection,
  verifyRunLifecycle,
} from '../src/services/run-lifecycle/service.js';
import {
  checkpointPathForStage,
  cleanupTempDirectories,
  createTempRepo,
  readJson,
  writeJson,
  writeRunFixtureState,
  writeSpec,
} from './test-helpers.js';

afterEach(async () => {
  await cleanupTempDirectories();
});

async function inspectRun(runId: string, cwd: string) {
  const service = createRunLifecycleService();
  const inspection = await service.status(runId, {
    cwd,
    emitStatusRequested: true,
  });
  const artifacts = await listArtifactReferencesFromRunDirectory(
    inspection.run.id,
    inspection.run.runDirectory,
  );

  return {
    inspection,
    summary: summarizeInspection(inspection, artifacts.length),
  };
}

describe('RunLifecycleService', () => {
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
    const service = createRunLifecycleService();

    const summary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
    });
    const events = await readFile(resolve(summary.artifactsDirectory, 'events.jsonl'), 'utf8');
    const runRecord = await readJson<{
      currentStage: string;
      lastCheckpointId?: string;
      status: string;
      verificationResultPath?: string;
      verificationStatus: string;
    }>(resolve(summary.artifactsDirectory, 'run.json'));
    const manifest = await readJson<{
      currentStage: string;
      lastCheckpointId?: string;
      lastProgressSnapshotId?: string;
      resumeEligibility: { eligible: boolean };
      status: string;
    }>(resolve(summary.artifactsDirectory, 'session.manifest.json'));
    const verificationResult = await readJson<{
      completionDecision: { canComplete: boolean };
      status: string;
    }>(resolve(summary.artifactsDirectory, 'verification.result.json'));
    const policyInput = await readJson<{
      policyPack: {
        defaults: {
          approvalPolicy: string;
          fallbackDecision: string;
          networkAccess: boolean;
          sandboxMode: string;
        };
      };
    }>(resolve(summary.artifactsDirectory, 'policy.input.json'));
    const reviewPacket = await readJson<{
      checksRun: Array<{ command: string }>;
      claimVerification: { status: string };
      verification: { status: string };
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
    expect(policyInput.policyPack.defaults).toMatchObject({
      approvalPolicy: 'on-request',
      fallbackDecision: 'prompt',
      networkAccess: false,
      sandboxMode: 'workspace-write',
    });
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
    const service = createRunLifecycleService();

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
      const summary = await service.run({
        approvalMode: 'fail',
        cwd: repoRoot,
        runner: 'codex-cli',
        source: {
          kind: 'spec_file',
          path: specPath,
        },
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

  it('updates progress.latest.json during live codex-cli execution', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'codex-cli-live-progress-spec.md',
      'Update `README.md` with a short docs-only note.',
    );
    const codexPath = resolve(repoRoot, 'scripts', 'codex');
    const runId = 'live-progress-test-run';
    const service = createRunLifecycleService({
      createRunIdFn: () => runId,
    });

    await writeFile(
      codexPath,
      [
        '#!/usr/bin/env node',
        "const { writeFileSync } = require('node:fs');",
        'const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));',
        'const args = process.argv.slice(2);',
        "const lastMessagePath = args[args.indexOf('--output-last-message') + 1];",
        '(async () => {',
        "  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'live-thread' }));",
        '  await sleep(120);',
        "  console.log(JSON.stringify({ type: 'item.updated', item: { id: 'todo_1', type: 'todo_list', items: [",
        "    { text: 'Read required repo instructions', completed: true },",
        "    { text: 'Apply the bounded docs change', completed: false },",
        "    { text: 'Run deterministic verification', completed: false },",
        '  ] } }));',
        '  await sleep(120);',
        "  console.log(JSON.stringify({ type: 'item.started', item: { id: 'cmd_1', type: 'command_execution', command: 'git status --short', aggregated_output: '', exit_code: null, status: 'in_progress' } }));",
        '  await sleep(120);',
        "  console.log(JSON.stringify({ type: 'item.completed', item: { id: 'cmd_1', type: 'command_execution', command: 'git status --short', aggregated_output: '', exit_code: 0, status: 'completed' } }));",
        '  writeFileSync(',
        '    lastMessagePath,',
        '    `${JSON.stringify({',
        "      status: 'completed',",
        "      summary: 'Live progress runner completed.',",
        '      commandsExecuted: [],',
        "      commandsExecutedCompleteness: 'complete',",
        '      reportedChangedFiles: [],',
        "      reportedChangedFilesCompleteness: 'complete',",
        '      limitations: [],',
        '      notes: [],',
        '      metadata: {},',
        '    })}\\n`,',
        "    'utf8',",
        '  );',
        '})();',
      ].join('\n'),
      'utf8',
    );
    execFileSync('chmod', ['+x', codexPath], { cwd: repoRoot });

    const originalPath = process.env.PATH;
    process.env.PATH = `${resolve(repoRoot, 'scripts')}:${originalPath ?? ''}`;

    try {
      const runPromise = service.run({
        approvalMode: 'fail',
        cwd: repoRoot,
        runner: 'codex-cli',
        source: {
          kind: 'spec_file',
          path: specPath,
        },
      });
      const progressPath = resolve(repoRoot, 'runs', 'local', runId, 'progress.latest.json');
      const stdoutPath = resolve(repoRoot, 'runs', 'local', runId, 'runner.stdout.log');
      let liveProgress:
        | {
            stage: string;
            summary: string;
          }
        | undefined;
      let liveStdout = '';

      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          liveProgress = await readJson<{
            stage: string;
            summary: string;
          }>(progressPath);
          liveStdout = await readFile(stdoutPath, 'utf8');
        } catch {
          // Wait for the runner to emit its first live progress artifacts.
        }

        if (
          liveProgress?.stage === 'runner_started' &&
          liveProgress.summary !== 'Write-capable runner is starting.' &&
          liveStdout.includes('"thread.started"')
        ) {
          break;
        }

        await new Promise((resolvePromise) => setTimeout(resolvePromise, 60));
      }

      const summary = await runPromise;

      expect(summary.status).toBe('completed');
      expect(liveProgress?.stage).toBe('runner_started');
      expect(liveProgress?.summary).not.toBe('Write-capable runner is starting.');
      expect(liveStdout).toContain('"thread.started"');
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
    const service = createRunLifecycleService();

    const summary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
    });
    const events = await readFile(resolve(summary.artifactsDirectory, 'events.jsonl'), 'utf8');
    const verificationResult = await readJson<{
      commands: Array<{ command: string; mandatory: boolean; status: string }>;
      completionDecision: { canComplete: boolean };
      status: string;
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
    const service = createRunLifecycleService();

    const summary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
    });
    const packetCompleteness = await readJson<{
      incompleteSections: string[];
      status: string;
    }>(resolve(summary.artifactsDirectory, 'packet-completeness.json'));
    const verificationResult = await readJson<{
      checks: Array<{ name: string; status: string; summary: string }>;
      status: string;
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
    const service = createRunLifecycleService();

    const summary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
    });
    const claimChecks = await readJson<{
      results: Array<{ field?: string; reason: string; status: string }>;
      status: string;
    }>(resolve(summary.artifactsDirectory, 'claim-checks.json'));
    const reviewPacket = await readJson<{
      limitations: string[];
      runnerReportedSummary: string;
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
    const service = createRunLifecycleService();

    const summary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
    });
    const claimChecks = await readJson<{
      results: Array<{ field?: string; status: string }>;
      status: string;
    }>(resolve(summary.artifactsDirectory, 'claim-checks.json'));

    expect(summary.status).toBe('completed');
    expect(summary.verificationStatus).toBe('passed');
    expect(claimChecks.status).toBe('passed');
    expect(
      claimChecks.results.find((result) => result.field === 'runnerResult.summary')?.status,
    ).toBe('passed');
  });

  it('pauses for approval and exposes the durable inspection snapshot', async () => {
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
    const service = createRunLifecycleService();

    const runSummary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
    });
    const { inspection, summary } = await inspectRun(runSummary.runId, repoRoot);

    expect(runSummary.status).toBe('awaiting_approval');
    expect(summary.status).toBe('awaiting_approval');
    expect(summary.resumeEligible).toBe(true);
    expect(summary.nextStage).toBe('awaiting_approval');
    expect(summary.manifestPath).toContain('session.manifest.json');
    expect(summary.approvalPacketPath).toContain('approval-packet.md');
    expect(inspection.state.approvalPacket).toBeDefined();
    expect(inspection.nextStage).toBe('awaiting_approval');
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
    const service = createRunLifecycleService();

    const pausedSummary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
    });
    const resumedSummary = await service.resume(pausedSummary.runId, {
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

  it('abandons the run when approval is denied during resume', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'approval-denied-spec.md',
      'Update `src/auth/login.ts` with a deterministic protected note.',
    );
    const service = createRunLifecycleService();

    const pausedSummary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
    });
    const resumedSummary = await service.resume(pausedSummary.runId, {
      approvalResolver: async () => 'denied',
      cwd: repoRoot,
    });
    const manifest = await readJson<{
      approvalState: { status: string };
      status: string;
    }>(resolve(pausedSummary.artifactsDirectory, 'session.manifest.json'));

    expect(resumedSummary.status).toBe('abandoned');
    expect(resumedSummary.approvalResolution).toBe('denied');
    expect(manifest.status).toBe('abandoned');
    expect(manifest.approvalState.status).toBe('denied');
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
    const service = createRunLifecycleService();

    await writeFile(
      codexPath,
      ['#!/bin/sh', 'echo "synthetic codex failure after approval" >&2', 'exit 1'].join('\n'),
      'utf8',
    );
    execFileSync('chmod', ['+x', codexPath], { cwd: repoRoot });

    const pausedSummary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'codex-cli',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
    });

    const originalPath = process.env.PATH;
    process.env.PATH = `${resolve(repoRoot, 'scripts')}:${originalPath ?? ''}`;

    try {
      const resumedSummary = await service.resume(pausedSummary.runId, {
        approvalResolver: async () => 'approved',
        cwd: repoRoot,
      });
      const { summary } = await inspectRun(pausedSummary.runId, repoRoot);
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
      expect(summary.nextStage).toBe('runner_started');
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
    const service = createRunLifecycleService();

    const pausedSummary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
    });
    const approvalPacket = await readJson<{ id: string }>(
      resolve(pausedSummary.artifactsDirectory, 'approval-packet.json'),
    );

    await writeJson(resolve(pausedSummary.artifactsDirectory, 'approval-resolution.json'), {
      actor: 'test',
      approvalPacketId: approvalPacket.id,
      createdAt: new Date().toISOString(),
      id: 'approval-resolution-reused',
      notes: ['Approval was already granted before this resume attempt.'],
      resolution: 'approved',
      runId: pausedSummary.runId,
    });

    const resumedSummary = await service.resume(pausedSummary.runId, {
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
    const service = createRunLifecycleService();

    const completedSummary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
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

    const resumedSummary = await service.resume(completedSummary.runId, {
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
    const service = createRunLifecycleService();

    const completedSummary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
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

    const resumedSummary = await service.resume(completedSummary.runId, {
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

  it('keeps interrupted runner_started runs resumable from runner_started and surfaces partial changed files', async () => {
    const repoRoot = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const specPath = await writeSpec(
      repoRoot,
      'runner-started-interrupted-spec.md',
      'Update `docs/fake-run-output.md` with a short docs-only note.',
    );
    const service = createRunLifecycleService();

    const completedSummary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
    });
    const runnerEntrySnapshot = createWorkspaceContentSnapshotArtifact(
      await captureWorkspaceSnapshot(repoRoot, {
        excludePrefixes: [
          createRunRelativeDirectory(repoRoot, completedSummary.artifactsDirectory),
        ],
      }),
    );

    await writeJson(
      resolve(completedSummary.artifactsDirectory, 'runner-entry.snapshot.json'),
      runnerEntrySnapshot,
    );
    await Promise.all([
      rm(resolve(completedSummary.artifactsDirectory, 'runner.result.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'commands-executed.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'changed-files.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'diff.patch'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'policy-audit.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'verification.result.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'review-packet.json'), { force: true }),
      rm(resolve(completedSummary.artifactsDirectory, 'review-packet.md'), { force: true }),
    ]);
    await writeFile(
      resolve(repoRoot, 'README.md'),
      '# Temp Repo\n\nInterrupted runner drift.\n',
      'utf8',
    );
    await writeRunFixtureState(completedSummary.artifactsDirectory, ({ manifest, run }) => {
      run.status = 'in_progress';
      run.currentStage = 'runner_started';
      run.lastSuccessfulStage = 'policy_evaluated';
      run.pendingStage = 'runner_completed';
      run.verificationStatus = 'not_run';
      manifest.status = 'in_progress';
      manifest.currentStage = 'runner_started';
      manifest.lastSuccessfulStage = 'policy_evaluated';
      manifest.pendingStage = 'runner_completed';
      manifest.pendingStep = 'runner.completed';
      manifest.verificationState.status = 'not_run';
      manifest.summary = 'Runner execution was interrupted mid-stage.';
    });

    const { inspection, summary } = await inspectRun(completedSummary.runId, repoRoot);
    const manifest = await readJson<{
      artifactPaths: Record<string, string>;
      currentStage: string;
      pendingStage?: string;
      status: string;
    }>(resolve(completedSummary.artifactsDirectory, 'session.manifest.json'));

    expect(summary.status).toBe('resumable');
    expect(summary.currentStage).toBe('runner_started');
    expect(summary.nextStage).toBe('runner_started');
    expect(summary.resumeEligible).toBe(true);
    expect(summary.changedFiles).toContain('README.md');
    expect(summary.latestProgressSummary).toContain('Partial changed files were captured');
    expect(inspection.state.partialChangedFiles?.files.map((file) => file.path)).toContain(
      'README.md',
    );
    expect(manifest.status).toBe('resumable');
    expect(manifest.currentStage).toBe('runner_started');
    expect(manifest.pendingStage).toBe('runner_started');
    expect(manifest.artifactPaths.partialChangedFiles).toContain('changed-files.partial.json');
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
    const service = createRunLifecycleService();

    const completedSummary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
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

    const { summary } = await inspectRun(completedSummary.runId, repoRoot);

    expect(summary.resumeEligible).toBe(false);
    expect(summary.continuityStatus).toBe('incompatible');
    await expect(
      service.resume(completedSummary.runId, {
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
    const service = createRunLifecycleService();

    const completedSummary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
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

    const { summary } = await inspectRun(completedSummary.runId, repoRoot);
    const manifest = await readJson<{
      pendingStage?: string;
      status: string;
    }>(resolve(completedSummary.artifactsDirectory, 'session.manifest.json'));

    expect(summary.resumeEligible).toBe(false);
    expect(summary.currentStage).toBe('runner_completed');
    expect(summary.nextStage).toBeUndefined();
    expect(manifest.pendingStage).toBeUndefined();
    expect(manifest.status).toBe('interrupted');
    await expect(
      service.resume(completedSummary.runId, {
        cwd: repoRoot,
      }),
    ).rejects.toThrow(/cannot be resumed/i);
  });

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
    const service = createRunLifecycleService();

    const initialSummary = await service.run({
      approvalMode: 'fail',
      cwd: repoRoot,
      runner: 'fake',
      source: {
        kind: 'spec_file',
        path: specPath,
      },
    });

    await writeJson(resolve(repoRoot, 'gdh.config.json'), {
      verification: {
        preflight: ['node scripts/pass.mjs lint'],
        postrun: ['node scripts/fail.mjs test'],
        optional: [],
      },
    });

    const rerunSummary = await verifyRunLifecycle(initialSummary.runId, {
      cwd: repoRoot,
    });
    const events = await readFile(
      resolve(initialSummary.artifactsDirectory, 'events.jsonl'),
      'utf8',
    );
    const runRecord = await readJson<{
      status: string;
      verificationResultPath?: string;
      verificationStatus: string;
    }>(resolve(initialSummary.artifactsDirectory, 'run.json'));
    const verificationResult = await readJson<{
      commands: Array<{ command: string; status: string }>;
      status: string;
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
