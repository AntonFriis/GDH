import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createArtifactStore } from '@gdh/artifact-store';
import {
  ChangedFileCaptureSchema,
  CommandCaptureSchema,
  createPlanFromSpec,
  createRunRecord,
  normalizeMarkdownSpec,
  PolicyAuditResultSchema,
  PolicyEvaluationSchema,
  RunnerResultSchema,
  updateRunStatus,
} from '@gdh/domain';
import { createReviewPacket } from '@gdh/review-packets';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkReviewPacketCompleteness,
  loadVerificationConfig,
  runVerification,
  verifyReviewPacketClaims,
} from '../src/index';

const tempDirectories: string[] = [];

async function createTempRepo(verificationConfig: Record<string, string[]>): Promise<{
  repoRoot: string;
  artifactStore: ReturnType<typeof createArtifactStore>;
  changedFiles: ReturnType<typeof ChangedFileCaptureSchema.parse>;
  commandCapture: ReturnType<typeof CommandCaptureSchema.parse>;
  plan: ReturnType<typeof createPlanFromSpec>;
  policyAudit: ReturnType<typeof PolicyAuditResultSchema.parse>;
  policyDecision: ReturnType<typeof PolicyEvaluationSchema.parse>;
  run: ReturnType<typeof createRunRecord>;
  runnerResult: ReturnType<typeof RunnerResultSchema.parse>;
  spec: ReturnType<typeof normalizeMarkdownSpec>;
}> {
  const repoRoot = await mkdtemp(resolve(tmpdir(), 'gdh-verification-test-'));
  const runId = 'run-verification';

  tempDirectories.push(repoRoot);

  await mkdir(resolve(repoRoot, 'scripts'), { recursive: true });
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
  await writeFile(
    resolve(repoRoot, 'gdh.config.json'),
    `${JSON.stringify({ verification: verificationConfig }, null, 2)}\n`,
    'utf8',
  );

  const spec = normalizeMarkdownSpec({
    content: [
      '# Verification Smoke',
      '',
      '## Objective',
      'Update `docs/example.md` with a deterministic note.',
      '',
      '## Acceptance Criteria',
      '- The docs file is updated.',
    ].join('\n'),
    repoRoot,
    sourcePath: resolve(repoRoot, 'spec.md'),
    createdAt: '2026-03-16T20:00:00.000Z',
  });
  const plan = createPlanFromSpec(spec, '2026-03-16T20:05:00.000Z');
  const artifactStore = createArtifactStore({
    repoRoot,
    runId,
  });

  await artifactStore.initialize();

  const run = updateRunStatus(
    createRunRecord({
      approvalMode: 'fail',
      approvalPolicy: 'on-request',
      model: 'gpt-5.4',
      networkAccess: false,
      plan,
      policyPackName: 'default',
      policyPackPath: resolve(repoRoot, 'policies/default.policy.yaml'),
      policyPackVersion: 1,
      repoRoot,
      runDirectory: artifactStore.runDirectory,
      runId,
      runner: 'fake',
      sandboxMode: 'workspace-write',
      spec,
      createdAt: '2026-03-16T20:00:00.000Z',
    }),
    'verifying',
    'Runner completed; verifying evidence.',
    '2026-03-16T20:06:00.000Z',
  );

  const changedFiles = ChangedFileCaptureSchema.parse({
    source: 'workspace_snapshot',
    notes: [],
    files: [
      {
        path: 'docs/example.md',
        status: 'modified',
        beforeHash: 'abc',
        afterHash: 'def',
      },
    ],
  });
  const commandCapture = CommandCaptureSchema.parse({
    source: 'fake_runner',
    completeness: 'complete',
    notes: [],
    commands: [
      {
        command: 'fake-runner.write docs/example.md',
        provenance: 'observed',
        isPartial: false,
      },
    ],
  });
  const runnerResult = RunnerResultSchema.parse({
    status: 'completed',
    summary: 'Fake runner created docs/example.md.',
    exitCode: 0,
    durationMs: 5,
    prompt: 'prompt',
    stdout: '',
    stderr: '',
    commandCapture,
    reportedChangedFiles: ['docs/example.md'],
    reportedChangedFilesCompleteness: 'complete',
    reportedChangedFilesNotes: [],
    limitations: ['Fake runner only.'],
    artifactsProduced: [],
    metadata: {},
  });
  const policyDecision = PolicyEvaluationSchema.parse({
    actionKinds: ['read', 'write'],
    affectedPaths: ['docs/example.md'],
    approvalPolicy: 'on-request',
    createdAt: '2026-03-16T20:02:00.000Z',
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
        summary: 'Rule "docs-safe" matched "docs/example.md".',
      },
    ],
    requiredApprovalMode: null,
    sandboxMode: 'workspace-write',
    uncertaintyNotes: [],
  });
  const policyAudit = PolicyAuditResultSchema.parse({
    actualChangedPaths: ['docs/example.md'],
    actualCommands: ['fake-runner.write docs/example.md'],
    createdAt: '2026-03-16T20:05:00.000Z',
    forbiddenCommandsTouched: [],
    forbiddenPathsTouched: [],
    id: 'audit-1',
    notes: [],
    previewedCommands: [],
    previewedPaths: ['docs/example.md'],
    promptCommandsTouched: [],
    promptPathsTouched: [],
    runId,
    status: 'clean',
    summary:
      'Policy audit found no obvious drift between the previewed scope and the actual run evidence.',
    unexpectedCommands: [],
    unexpectedPaths: [],
  });

  await artifactStore.writeRun(run);
  await artifactStore.writeJsonArtifact('normalized-spec', 'spec.normalized.json', spec);
  await artifactStore.writeJsonArtifact('plan', 'plan.json', plan);
  await artifactStore.writeJsonArtifact('impact-preview', 'impact-preview.json', {
    id: 'impact-1',
    runId,
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
        path: 'docs/example.md',
        pathKind: 'file',
        actionKind: 'write',
        confidence: 'high',
      },
    ],
    proposedCommands: [],
    uncertaintyNotes: [],
    createdAt: '2026-03-16T20:01:00.000Z',
  });
  await artifactStore.writeJsonArtifact('policy-input', 'policy.input.json', {
    approvalMode: 'fail',
  });
  await artifactStore.writeJsonArtifact('policy-decision', 'policy.decision.json', policyDecision);
  await artifactStore.writeJsonArtifact('runner-result', 'runner.result.json', runnerResult);
  await artifactStore.writeJsonArtifact(
    'commands-executed',
    'commands-executed.json',
    commandCapture,
  );
  await artifactStore.writeJsonArtifact('changed-files', 'changed-files.json', changedFiles);
  await artifactStore.writeTextArtifact(
    'diff',
    'diff.patch',
    [
      'diff --git a/docs/example.md b/docs/example.md',
      '--- a/docs/example.md',
      '+++ b/docs/example.md',
      '@@ -1 +1 @@',
      '-before',
      '+after',
    ].join('\n'),
    'patch',
  );
  await artifactStore.writeJsonArtifact('policy-audit', 'policy-audit.json', policyAudit);
  await artifactStore.writeTextArtifact('run-events', 'events.jsonl', '', 'jsonl');

  return {
    repoRoot,
    artifactStore,
    changedFiles,
    commandCapture,
    plan,
    policyAudit,
    policyDecision,
    run,
    runnerResult,
    spec,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('loadVerificationConfig', () => {
  it('parses the repo-local verification command groups', async () => {
    const { repoRoot } = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: ['node scripts/pass.mjs e2e'],
    });

    const config = await loadVerificationConfig(repoRoot);

    expect(config.commands.preflight).toEqual(['node scripts/pass.mjs lint']);
    expect(config.commands.postrun).toEqual(['node scripts/pass.mjs test']);
    expect(config.commands.optional).toEqual(['node scripts/pass.mjs e2e']);
  });
});

describe('runVerification', () => {
  it('executes configured commands, records artifacts, and passes with a parsable diff', async () => {
    const context = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: ['node scripts/pass.mjs e2e'],
    });

    const result = await runVerification({
      artifactStore: context.artifactStore,
      changedFiles: context.changedFiles,
      commandCapture: context.commandCapture,
      diffPatch: await readFile(resolve(context.run.runDirectory, 'diff.patch'), 'utf8'),
      plan: context.plan,
      policyAudit: context.policyAudit,
      policyDecision: context.policyDecision,
      repoRoot: context.repoRoot,
      run: context.run,
      runnerResult: context.runnerResult,
      spec: context.spec,
    });

    expect(result.verificationResult.status).toBe('passed');
    expect(result.commandResults).toHaveLength(3);
    expect(
      result.verificationResult.checks.some((check) => check.name === 'diff.present_and_parsable'),
    ).toBe(true);
    expect(
      await readFile(resolve(context.run.runDirectory, 'verification.result.json'), 'utf8'),
    ).toContain('"status": "passed"');
  });

  it('fails the diff check when changed files exist but the patch is not parsable', async () => {
    const context = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });

    const result = await runVerification({
      artifactStore: context.artifactStore,
      changedFiles: context.changedFiles,
      commandCapture: context.commandCapture,
      diffPatch: '',
      plan: context.plan,
      policyAudit: context.policyAudit,
      policyDecision: context.policyDecision,
      repoRoot: context.repoRoot,
      run: context.run,
      runnerResult: context.runnerResult,
      spec: context.spec,
    });

    const diffCheck = result.verificationResult.checks.find(
      (check) => check.name === 'diff.present_and_parsable',
    );

    expect(diffCheck?.status).toBe('failed');
    expect(result.verificationResult.status).toBe('failed');
  });

  it('fails policy compliance when the post-run policy audit records a policy breach', async () => {
    const context = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const breachedAudit = PolicyAuditResultSchema.parse({
      ...context.policyAudit,
      status: 'policy_breach',
      summary: 'Policy audit found an obvious policy breach in the observed run evidence.',
    });

    const result = await runVerification({
      artifactStore: context.artifactStore,
      changedFiles: context.changedFiles,
      commandCapture: context.commandCapture,
      diffPatch: await readFile(resolve(context.run.runDirectory, 'diff.patch'), 'utf8'),
      plan: context.plan,
      policyAudit: breachedAudit,
      policyDecision: context.policyDecision,
      repoRoot: context.repoRoot,
      run: context.run,
      runnerResult: context.runnerResult,
      spec: context.spec,
    });

    const policyCheck = result.verificationResult.checks.find(
      (check) => check.name === 'policy.compliance',
    );

    expect(policyCheck?.status).toBe('failed');
    expect(result.verificationResult.status).toBe('failed');
  });
});

describe('claim and packet validation helpers', () => {
  it('flags unsupported certainty claims in the review packet narrative', async () => {
    const context = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const packet = createReviewPacket({
      artifacts: [],
      changedFiles: context.changedFiles,
      claimVerification: {
        status: 'passed',
        summary: 'placeholder',
        totalClaims: 1,
        passedClaims: 1,
        failedClaims: 0,
        results: [],
      },
      plan: context.plan,
      policyAudit: context.policyAudit,
      policyDecision: context.policyDecision,
      run: context.run,
      runCompletion: {
        finalStatus: 'completed',
        canComplete: true,
        summary: 'Verification passed and the run can be marked completed.',
        blockingCheckIds: [],
        blockingReasons: [],
      },
      runnerResult: {
        ...context.runnerResult,
        summary: 'This change is production-ready.',
      },
      spec: context.spec,
      verificationCommands: [],
      verificationStatus: 'passed',
      verificationSummary: 'Verification passed and the run can be marked completed.',
      verifiedAt: '2026-03-16T20:06:00.000Z',
    });

    const claimSummary = verifyReviewPacketClaims({
      changedFiles: context.changedFiles,
      commandCapture: context.commandCapture,
      packet,
      policyAudit: context.policyAudit,
      policyDecision: context.policyDecision,
      runnerResult: {
        ...context.runnerResult,
        summary: 'This change is production-ready.',
      },
      verificationCommands: [],
      verificationStatus: 'passed',
    });

    expect(claimSummary.status).toBe('failed');
    expect(claimSummary.results.some((result) => result.field === 'runnerResult.summary')).toBe(
      true,
    );
  });

  it('allows command-qualified verified wording in the raw runner summary', async () => {
    const context = await createTempRepo({
      preflight: ['node scripts/pass.mjs lint'],
      postrun: ['node scripts/pass.mjs test'],
      optional: [],
    });
    const runnerResult = {
      ...context.runnerResult,
      summary: 'Verified with `pnpm lint:root`.',
    };
    const packet = createReviewPacket({
      artifacts: [],
      changedFiles: context.changedFiles,
      claimVerification: {
        status: 'passed',
        summary: 'placeholder',
        totalClaims: 1,
        passedClaims: 1,
        failedClaims: 0,
        results: [],
      },
      plan: context.plan,
      policyAudit: context.policyAudit,
      policyDecision: context.policyDecision,
      run: context.run,
      runCompletion: {
        finalStatus: 'completed',
        canComplete: true,
        summary: 'Verification passed and the run can be marked completed.',
        blockingCheckIds: [],
        blockingReasons: [],
      },
      runnerResult,
      spec: context.spec,
      verificationCommands: [],
      verificationStatus: 'passed',
      verificationSummary: 'Verification passed and the run can be marked completed.',
      verifiedAt: '2026-03-16T20:06:00.000Z',
    });

    const claimSummary = verifyReviewPacketClaims({
      changedFiles: context.changedFiles,
      commandCapture: context.commandCapture,
      packet,
      policyAudit: context.policyAudit,
      policyDecision: context.policyDecision,
      runnerResult,
      verificationCommands: [],
      verificationStatus: 'passed',
    });

    expect(packet.runnerReportedSummary).toBe('Verified with `pnpm lint:root`.');
    expect(claimSummary.status).toBe('passed');
    expect(
      claimSummary.results.find((result) => result.field === 'runnerResult.summary')?.status,
    ).toBe('passed');
  });

  it('reports missing required sections when the packet lacks verification commands', async () => {
    const context = await createTempRepo({
      preflight: [],
      postrun: [],
      optional: [],
    });
    const packet = createReviewPacket({
      artifacts: [],
      changedFiles: context.changedFiles,
      claimVerification: {
        status: 'passed',
        summary: 'All review packet claims matched the recorded evidence.',
        totalClaims: 1,
        passedClaims: 1,
        failedClaims: 0,
        results: [],
      },
      plan: context.plan,
      policyAudit: context.policyAudit,
      policyDecision: context.policyDecision,
      run: context.run,
      runCompletion: {
        finalStatus: 'failed',
        canComplete: false,
        summary: 'Verification failed.',
        blockingCheckIds: ['commands'],
        blockingReasons: ['No commands'],
      },
      runnerResult: context.runnerResult,
      spec: context.spec,
      verificationCommands: [],
      verificationStatus: 'failed',
      verificationSummary: 'Verification failed.',
      verifiedAt: '2026-03-16T20:06:00.000Z',
    });

    const completeness = checkReviewPacketCompleteness(packet);

    expect(completeness.status).toBe('failed');
    expect(completeness.incompleteSections).toContain('tests_checks_run');
  });
});
