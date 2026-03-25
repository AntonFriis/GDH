import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BenchmarkRun } from '@gdh/domain';
import {
  createResumeEligibilityRecord,
  ReviewPacketSchema,
  SessionManifestSchema,
} from '@gdh/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { compareBenchmarkRuns } from '../src/comparison.js';
import { loadBenchmarkConfig } from '../src/config.js';
import { createBenchmarkTargetService } from '../src/index.js';
import { defaultThresholdPolicy } from '../src/service.js';
import type { BenchmarkCaseExecutionInput, BenchmarkCaseExecutionSummary } from '../src/types.js';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const tempDirectories: string[] = [];
let syntheticRunCounter = 0;

type SyntheticScenario = 'approval' | 'fail' | 'pass';

function createBenchmarkRun(input: {
  id: string;
  caseScore: number;
  caseStatus?: 'passed' | 'failed';
  successMetricPassed?: boolean;
}): BenchmarkRun {
  const successPassed = input.successMetricPassed ?? input.caseStatus !== 'failed';

  return {
    id: input.id,
    status: input.caseStatus === 'failed' ? 'failed' : 'completed',
    target: {
      kind: 'suite',
      id: 'smoke',
    },
    suiteId: 'smoke',
    caseIds: ['smoke-success-docs'],
    mode: 'ci_safe',
    repoRoot: '/tmp/gdh',
    runDirectory: `/tmp/gdh/runs/benchmarks/${input.id}`,
    configuration: {
      ciSafe: true,
      targetId: 'smoke',
      targetKind: 'suite',
      suiteId: 'smoke',
      thresholdPolicy: defaultThresholdPolicy,
    },
    score: {
      totalWeight: 1,
      earnedWeight: input.caseScore,
      normalizedScore: input.caseScore,
      passedMetrics: successPassed ? 1 : 0,
      failedMetrics: successPassed ? 0 : 1,
      metrics: [
        {
          name: 'success',
          title: 'Success / Failure',
          description: 'Checks benchmark success.',
          weight: 1,
          score: input.caseScore,
          passed: successPassed,
          summary: successPassed ? 'Passed.' : 'Failed.',
          evidence: [],
        },
      ],
      summary: 'Synthetic benchmark score.',
    },
    caseResults: [
      {
        id: `${input.id}:smoke-success-docs`,
        benchmarkRunId: input.id,
        caseId: 'smoke-success-docs',
        title: 'Smoke success docs',
        suiteIds: ['smoke'],
        status: input.caseStatus ?? 'passed',
        mode: 'ci_safe',
        tags: ['smoke'],
        startedAt: '2026-03-17T12:00:00.000Z',
        completedAt: '2026-03-17T12:00:01.000Z',
        durationMs: 1000,
        expected: {
          runStatus: 'completed',
          requiredArtifacts: ['review-packet.json'],
        },
        actual: {
          runStatus: input.caseStatus === 'failed' ? 'failed' : 'completed',
          artifactPaths: ['review-packet.json'],
        },
        score: {
          totalWeight: 1,
          earnedWeight: input.caseScore,
          normalizedScore: input.caseScore,
          passedMetrics: successPassed ? 1 : 0,
          failedMetrics: successPassed ? 0 : 1,
          metrics: [
            {
              name: 'success',
              title: 'Success / Failure',
              description: 'Checks benchmark success.',
              weight: 1,
              score: input.caseScore,
              passed: successPassed,
              summary: successPassed ? 'Passed.' : 'Failed.',
              evidence: [],
            },
          ],
          summary: 'Synthetic case score.',
        },
        failureReasons: successPassed ? [] : ['Synthetic failure'],
        notes: ['Synthetic benchmark case'],
      },
    ],
    startedAt: '2026-03-17T12:00:00.000Z',
    completedAt: '2026-03-17T12:00:01.000Z',
    summary: 'Synthetic benchmark run.',
  };
}

async function createTempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

async function createFixtureRepo(root: string): Promise<string> {
  const fixtureRoot = resolve(root, 'benchmarks', 'fixtures', 'repos', 'smoke-template');
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(resolve(fixtureRoot, 'README.md'), '# Smoke fixture\n', 'utf8');
  return fixtureRoot;
}

async function writeBenchmarkSpec(root: string, name: string, title: string): Promise<string> {
  const specPath = resolve(root, 'benchmarks', 'fixtures', 'specs', 'smoke', name);
  await mkdir(dirname(specPath), { recursive: true });
  await writeFile(
    specPath,
    ['---', `title: ${title}`, 'task_type: docs', '---', '', `# ${title}`].join('\n'),
    'utf8',
  );
  return specPath;
}

async function writeBenchmarkSuiteArtifacts(input: {
  repoRoot: string;
  fixtureRepo: string;
  passSpecPath: string;
  approvalSpecPath?: string;
  failSpecPath?: string;
  baselineRunId?: string;
  baselinePath?: string;
}): Promise<void> {
  const casesDirectory = resolve(input.repoRoot, 'benchmarks', 'smoke', 'cases');
  await mkdir(casesDirectory, { recursive: true });

  await writeFile(
    resolve(casesDirectory, 'service-pass.yaml'),
    [
      'version: 1',
      'id: service-pass',
      'title: Service pass case',
      'suiteIds:',
      '  - smoke',
      'execution:',
      '  mode: ci_safe',
      '  runner: fake',
      '  approvalMode: fail',
      `  repoFixturePath: ${input.fixtureRepo}`,
      '  ciSafe: true',
      'input:',
      '  kind: markdown_spec',
      `  specFixturePath: ${input.passSpecPath}`,
      'expected:',
      '  runStatus: completed',
      '  policyDecision: allow',
      '  approvalState: not_required',
      '  verificationStatus: passed',
      '  reviewPacketStatus: ready',
      '  requiredArtifacts:',
      '    - session.manifest.json',
      '    - review-packet.json',
    ].join('\n'),
    'utf8',
  );

  if (input.approvalSpecPath) {
    await writeFile(
      resolve(casesDirectory, 'service-approval.yaml'),
      [
        'version: 1',
        'id: service-approval',
        'title: Service approval case',
        'suiteIds:',
        '  - smoke',
        'execution:',
        '  mode: ci_safe',
        '  runner: fake',
        '  approvalMode: fail',
        `  repoFixturePath: ${input.fixtureRepo}`,
        '  ciSafe: true',
        'input:',
        '  kind: markdown_spec',
        `  specFixturePath: ${input.approvalSpecPath}`,
        'expected:',
        '  runStatus: awaiting_approval',
        '  policyDecision: prompt',
        '  approvalState: pending',
        '  verificationStatus: not_run',
        '  reviewPacketStatus: verification_failed',
        '  requiredArtifacts:',
        '    - session.manifest.json',
        '    - review-packet.json',
      ].join('\n'),
      'utf8',
    );
  }

  if (input.failSpecPath) {
    await writeFile(
      resolve(casesDirectory, 'service-fail.yaml'),
      [
        'version: 1',
        'id: service-fail',
        'title: Service fail case',
        'suiteIds:',
        '  - smoke',
        'execution:',
        '  mode: ci_safe',
        '  runner: fake',
        '  approvalMode: fail',
        `  repoFixturePath: ${input.fixtureRepo}`,
        '  ciSafe: true',
        'input:',
        '  kind: markdown_spec',
        `  specFixturePath: ${input.failSpecPath}`,
        'expected:',
        '  runStatus: failed',
        '  policyDecision: allow',
        '  approvalState: not_required',
        '  verificationStatus: failed',
        '  reviewPacketStatus: verification_failed',
        '  requiredArtifacts:',
        '    - session.manifest.json',
        '    - review-packet.json',
      ].join('\n'),
      'utf8',
    );
  }

  const suiteLines = [
    'version: 1',
    'id: smoke',
    'title: Service smoke suite',
    'description: Synthetic benchmark service suite.',
    'caseIds:',
    '  - service-pass',
    'tags: [smoke, ci-safe]',
    'mode: ci_safe',
  ];

  if (input.baselinePath && input.baselineRunId) {
    suiteLines.push(
      'baseline:',
      '  kind: benchmark_artifact',
      '  id: smoke-baseline',
      '  label: Service smoke baseline',
      `  artifactPath: ${input.baselinePath}`,
      `  benchmarkRunId: ${input.baselineRunId}`,
    );
  }

  await mkdir(resolve(input.repoRoot, 'benchmarks', 'smoke'), { recursive: true });
  await writeFile(
    resolve(input.repoRoot, 'benchmarks', 'smoke', 'suite.yaml'),
    suiteLines.join('\n'),
    'utf8',
  );
}

function scenarioFromSpecPath(specPath: string): SyntheticScenario {
  const name = basename(specPath);

  if (name.includes('approval')) {
    return 'approval';
  }

  if (name.includes('fail')) {
    return 'fail';
  }

  return 'pass';
}

async function writeSyntheticRunArtifacts(input: {
  cwd: string;
  runId: string;
  scenario: SyntheticScenario;
}): Promise<string> {
  const runDirectory = resolve(input.cwd, 'runs', 'local', input.runId);
  const timestamp = '2026-03-25T09:00:00.000Z';
  const policyDecision = input.scenario === 'approval' ? 'prompt' : 'allow';
  const approvalState = input.scenario === 'approval' ? 'pending' : 'not_required';
  const verificationStatus =
    input.scenario === 'pass' ? 'passed' : input.scenario === 'approval' ? 'not_run' : 'failed';
  const runStatus =
    input.scenario === 'pass'
      ? 'completed'
      : input.scenario === 'approval'
        ? 'awaiting_approval'
        : 'failed';
  const packetStatus = input.scenario === 'pass' ? 'ready' : 'verification_failed';

  await mkdir(runDirectory, { recursive: true });
  await writeFile(resolve(runDirectory, 'run.json'), JSON.stringify({ id: input.runId }), 'utf8');
  await writeFile(
    resolve(runDirectory, 'session.manifest.json'),
    JSON.stringify(
      SessionManifestSchema.parse({
        runId: input.runId,
        currentSessionId: `session-${input.runId}`,
        sessionIds: [`session-${input.runId}`],
        status: runStatus,
        createdAt: timestamp,
        updatedAt: timestamp,
        currentStage: input.scenario === 'pass' ? 'verification_completed' : 'awaiting_approval',
        lastSuccessfulStage:
          input.scenario === 'pass' ? 'verification_completed' : 'policy_evaluated',
        policyDecision: {
          decision: policyDecision,
          summary: `Synthetic ${policyDecision} policy decision.`,
          artifactPath: resolve(runDirectory, 'policy.decision.json'),
          requiredApprovalMode: input.scenario === 'approval' ? 'fail' : null,
        },
        approvalState: {
          required: input.scenario === 'approval',
          status: approvalState,
          artifactPaths: [],
        },
        verificationState: {
          status: verificationStatus,
          summary: `Synthetic verification status ${verificationStatus}.`,
        },
        workspace: {
          repoRoot: input.cwd,
          runDirectory,
        },
        artifactPaths: {
          manifest: resolve(runDirectory, 'session.manifest.json'),
          reviewPacket: resolve(runDirectory, 'review-packet.json'),
        },
        resumeEligibility: createResumeEligibilityRecord({
          eligible: false,
          reasons: ['Synthetic benchmark artifact set is not resumable.'],
          summary: 'Synthetic benchmark artifact set is not resumable.',
        }),
        pendingActions: [],
        summary: `Synthetic run manifest for ${input.scenario}.`,
      }),
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(
    resolve(runDirectory, 'review-packet.json'),
    JSON.stringify(
      ReviewPacketSchema.parse({
        id: `review-${input.runId}`,
        runId: input.runId,
        title: `Review Packet: ${input.runId}`,
        specTitle: input.runId,
        runStatus,
        packetStatus,
        objective: 'Synthetic benchmark objective.',
        overview: 'Synthetic benchmark overview.',
        planSummary: 'Synthetic benchmark plan summary.',
        runnerReportedSummary: `Synthetic ${input.scenario} runner summary.`,
        filesChanged: [],
        commandsExecuted: [],
        checksRun: [],
        artifactPaths: [
          resolve(runDirectory, 'session.manifest.json'),
          resolve(runDirectory, 'review-packet.json'),
        ],
        diffSummary: ['No non-artifact file changes were captured.'],
        policy: {
          decision: policyDecision,
          summary: `Synthetic ${policyDecision} policy summary.`,
          auditStatus: 'clean',
          auditSummary: 'Synthetic policy audit was clean.',
          matchedRuleIds: [],
        },
        approvals: {
          required: input.scenario === 'approval',
          status: approvalState,
          summary:
            input.scenario === 'approval'
              ? 'Synthetic approval is pending.'
              : 'Synthetic approval was not required.',
        },
        risks: [],
        limitations: input.scenario === 'pass' ? [] : ['Synthetic benchmark limitation.'],
        openQuestions: [],
        verification: {
          status: verificationStatus,
          summary: `Synthetic verification status ${verificationStatus}.`,
          mandatoryFailures: input.scenario === 'fail' ? ['postrun: pnpm test'] : [],
          lastVerifiedAt: input.scenario === 'pass' ? timestamp : undefined,
        },
        claimVerification: {
          status: input.scenario === 'pass' ? 'passed' : 'failed',
          summary:
            input.scenario === 'pass'
              ? 'Synthetic claim verification passed.'
              : 'Synthetic claim verification failed.',
          totalClaims: 1,
          passedClaims: input.scenario === 'pass' ? 1 : 0,
          failedClaims: input.scenario === 'pass' ? 0 : 1,
          results: [],
        },
        rollbackHint: 'Synthetic rollback hint.',
        createdAt: timestamp,
      }),
      null,
      2,
    ),
    'utf8',
  );

  return runDirectory;
}

async function executeSyntheticBenchmarkCase(
  input: BenchmarkCaseExecutionInput,
): Promise<BenchmarkCaseExecutionSummary> {
  syntheticRunCounter += 1;
  const scenario = scenarioFromSpecPath(input.specPath);
  const runId = `synthetic-${scenario}-${syntheticRunCounter}`;
  const artifactsDirectory = await writeSyntheticRunArtifacts({
    cwd: input.cwd,
    runId,
    scenario,
  });

  return {
    artifactsDirectory,
    policyDecision: scenario === 'approval' ? 'prompt' : 'allow',
    reviewPacketPath: resolve(artifactsDirectory, 'review-packet.json'),
    runId,
    status:
      scenario === 'pass' ? 'completed' : scenario === 'approval' ? 'awaiting_approval' : 'failed',
    summary: `Synthetic ${scenario} benchmark execution.`,
    verificationStatus:
      scenario === 'pass' ? 'passed' : scenario === 'approval' ? 'not_run' : 'failed',
  };
}

afterEach(async () => {
  syntheticRunCounter = 0;
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('loadBenchmarkConfig', () => {
  it('loads the repo benchmark threshold defaults', async () => {
    const config = await loadBenchmarkConfig(workspaceRoot);

    expect(config.thresholds.maxOverallScoreDrop).toBe(0);
    expect(config.thresholds.requiredMetrics).toContain('success');
    expect(config.thresholds.failOnNewlyFailingCases).toBe(true);
  });
});

describe('compareBenchmarkRuns', () => {
  it('detects a regression when the score drops and a previously passing case fails', async () => {
    const lhsRun = createBenchmarkRun({
      id: 'lhs',
      caseScore: 0,
      caseStatus: 'failed',
      successMetricPassed: false,
    });
    const rhsRun = createBenchmarkRun({
      id: 'rhs',
      caseScore: 1,
      caseStatus: 'passed',
      successMetricPassed: true,
    });

    const comparison = await compareBenchmarkRuns({
      lhsRun,
      lhsRunFilePath: '/tmp/lhs/benchmark.run.json',
      rhsRef: {
        kind: 'benchmark_run',
        id: 'rhs',
        label: 'rhs',
        artifactPath: '/tmp/rhs/benchmark.run.json',
        benchmarkRunId: 'rhs',
      },
      rhsRun,
      thresholdPolicy: defaultThresholdPolicy,
    });

    expect(comparison.comparisonReport.overall.delta).toBe(-1);
    expect(comparison.comparisonReport.overall.newlyFailingCases).toEqual(['smoke-success-docs']);
    expect(comparison.regressionResult.status).toBe('failed');
    expect(comparison.regressionResult.requiredMetricFailures).toHaveLength(1);
  });
});

describe('benchmark target service', () => {
  it('runs a ci_safe suite target and persists comparison artifacts against a baseline', async () => {
    const repoRoot = await createTempDirectory('gdh-evals-suite-');
    const fixtureRepo = await createFixtureRepo(repoRoot);
    const passSpecPath = await writeBenchmarkSpec(repoRoot, 'service-pass.md', 'Service Pass');

    await writeBenchmarkSuiteArtifacts({
      repoRoot,
      fixtureRepo,
      passSpecPath,
    });

    const service = createBenchmarkTargetService();
    const baseline = await service.runTarget({
      ciSafe: true,
      executeCase: executeSyntheticBenchmarkCase,
      repoRoot,
      targetId: 'smoke',
    });
    const baselinePath = resolve(repoRoot, 'benchmarks', 'baselines', 'smoke-baseline.json');

    await mkdir(dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, JSON.stringify(baseline.benchmarkRun, null, 2), 'utf8');
    await writeBenchmarkSuiteArtifacts({
      repoRoot,
      fixtureRepo,
      passSpecPath,
      baselinePath: 'benchmarks/baselines/smoke-baseline.json',
      baselineRunId: baseline.benchmarkRun.id,
    });

    const result = await service.runTarget({
      ciSafe: true,
      executeCase: executeSyntheticBenchmarkCase,
      repoRoot,
      targetId: 'smoke',
    });

    expect(result.exitCode).toBe(0);
    expect(result.benchmarkRun.status).toBe('completed');
    expect(result.benchmarkRun.caseResults).toHaveLength(1);
    expect(result.benchmarkRun.caseResults[0]?.mode).toBe('ci_safe');
    expect(result.comparisonReport?.rhs.label).toBe('Service smoke baseline');
    expect(result.regressionResult?.status).toBe('passed');
    expect(result.benchmarkRun.comparisonReportPath).toBeTruthy();
    expect(result.benchmarkRun.regressionResultPath).toBeTruthy();
    await expect(
      readFile(resolve(result.artifactsDirectory, 'benchmark.run.json'), 'utf8'),
    ).resolves.toContain(`"id": "${result.benchmarkRun.id}"`);
  });

  it('runs a single case target through the service boundary', async () => {
    const repoRoot = await createTempDirectory('gdh-evals-case-');
    const fixtureRepo = await createFixtureRepo(repoRoot);
    const passSpecPath = await writeBenchmarkSpec(repoRoot, 'service-pass.md', 'Service Pass');
    const approvalSpecPath = await writeBenchmarkSpec(
      repoRoot,
      'service-approval.md',
      'Service Approval',
    );

    await writeBenchmarkSuiteArtifacts({
      repoRoot,
      fixtureRepo,
      passSpecPath,
      approvalSpecPath,
    });

    const service = createBenchmarkTargetService();
    const result = await service.runTarget({
      ciSafe: true,
      executeCase: executeSyntheticBenchmarkCase,
      repoRoot,
      targetId: 'service-approval',
    });

    expect(result.exitCode).toBe(0);
    expect(result.benchmarkRun.target.kind).toBe('case');
    expect(result.benchmarkRun.caseResults).toHaveLength(1);
    expect(result.benchmarkRun.caseResults[0]?.actual.policyDecision).toBe('prompt');
    expect(result.benchmarkRun.caseResults[0]?.actual.approvalState).toBe('pending');
  });

  it('compares persisted benchmark runs and reports regressions', async () => {
    const repoRoot = await createTempDirectory('gdh-evals-compare-');
    const fixtureRepo = await createFixtureRepo(repoRoot);
    const passSpecPath = await writeBenchmarkSpec(repoRoot, 'service-pass.md', 'Service Pass');
    const failSpecPath = await writeBenchmarkSpec(repoRoot, 'service-fail.md', 'Service Fail');

    await writeBenchmarkSuiteArtifacts({
      repoRoot,
      fixtureRepo,
      passSpecPath,
    });

    const service = createBenchmarkTargetService();
    const baseline = await service.runTarget({
      ciSafe: true,
      executeCase: executeSyntheticBenchmarkCase,
      repoRoot,
      targetId: 'smoke',
    });

    await writeBenchmarkSuiteArtifacts({
      repoRoot,
      fixtureRepo,
      passSpecPath,
      failSpecPath,
      baselinePath: 'benchmarks/baselines/smoke-baseline.json',
      baselineRunId: baseline.benchmarkRun.id,
    });
    await mkdir(resolve(repoRoot, 'benchmarks', 'baselines'), { recursive: true });
    await writeFile(
      resolve(repoRoot, 'benchmarks', 'baselines', 'smoke-baseline.json'),
      JSON.stringify(baseline.benchmarkRun, null, 2),
      'utf8',
    );

    const failedRun = await service.runTarget({
      ciSafe: true,
      executeCase: executeSyntheticBenchmarkCase,
      repoRoot,
      targetId: 'service-fail',
    });
    const comparison = await service.compareRunArtifacts({
      againstBaseline: true,
      lhs: failedRun.benchmarkRun.id,
      repoRoot,
    });

    expect(failedRun.exitCode).toBe(0);
    expect(failedRun.regressionResult).toBeUndefined();
    expect(comparison.regressionResult.status).toBe('failed');
    expect(comparison.comparisonReport.overall.newlyFailingCases).toContain('service-pass');
    await expect(
      readFile(resolve(failedRun.artifactsDirectory, 'comparison.report.json'), 'utf8'),
    ).resolves.toContain(comparison.comparisonReport.id);
  });
});
