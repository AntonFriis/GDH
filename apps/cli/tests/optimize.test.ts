import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBenchmarkTargetService } from '@gdh/evals';
import { afterEach, describe, expect, it } from 'vitest';
import { runSpecFile } from '../src/index.js';
import {
  compareOptimizationRunId,
  decideOptimizationRunId,
  runOptimizationCandidate,
} from '../src/optimize.js';
import { cleanupTempDirectories, createTempRepo, writeJson } from './test-helpers.js';

afterEach(async () => {
  await cleanupTempDirectories();
});

async function executeBenchmarkCaseThroughRunSpec(input: {
  approvalMode: 'fail' | 'interactive';
  cwd: string;
  policyPath?: string;
  runner: 'fake' | 'codex-cli';
  specPath: string;
}) {
  const summary = await runSpecFile(input.specPath, {
    approvalMode: input.approvalMode,
    cwd: input.cwd,
    policyPath: input.policyPath,
    runner: input.runner,
  });

  return {
    artifactsDirectory: summary.artifactsDirectory,
    policyDecision: summary.policyDecision,
    reviewPacketPath: summary.reviewPacketPath,
    runId: summary.runId,
    status: summary.status,
    summary: summary.summary,
    verificationStatus: summary.verificationStatus,
  };
}

async function writeOptimizeConfig(repoRoot: string): Promise<void> {
  await writeJson(resolve(repoRoot, 'gdh.optimize.json'), {
    version: 1,
    benchmarkTarget: 'smoke',
    runsRoot: 'runs/optimizations',
    surfaces: [
      {
        id: 'impact-preview-hints',
        description: 'Deterministic impact preview hints.',
        paths: ['config/optimization/impact-preview-hints.json'],
        notes: [],
      },
    ],
    decision: {
      requireImprovement: true,
      minimumScoreImprovement: 0,
      tieBreak: 'reject',
      protectedMetrics: [
        'success',
        'policy_correctness',
        'verification_correctness',
        'packet_completeness',
        'artifact_presence',
      ],
    },
  });
}

async function writeImpactPreviewHints(repoRoot: string, docsPaths: string[]): Promise<void> {
  await mkdir(resolve(repoRoot, 'config', 'optimization'), { recursive: true });
  await writeJson(resolve(repoRoot, 'config', 'optimization', 'impact-preview-hints.json'), {
    version: 1,
    defaultPathHintsByTaskClass: {
      docs: docsPaths,
    },
  });
}

async function seedPromptBenchmarkRepo(repoRoot: string, fixtureRepo: string): Promise<string> {
  const specPath = resolve(
    repoRoot,
    'benchmarks',
    'fixtures',
    'specs',
    'smoke',
    'optimize-policy-prompt.md',
  );
  const casePath = resolve(repoRoot, 'benchmarks', 'smoke', 'cases', 'optimize-policy-prompt.yaml');
  const suitePath = resolve(repoRoot, 'benchmarks', 'smoke', 'suite.yaml');

  await mkdir(resolve(repoRoot, 'benchmarks', 'fixtures', 'specs', 'smoke'), { recursive: true });
  await mkdir(resolve(repoRoot, 'benchmarks', 'smoke', 'cases'), { recursive: true });
  await writeFile(
    specPath,
    [
      '---',
      'title: Optimize Policy Prompt',
      'task_type: docs',
      'constraints:',
      '  - Keep the request deterministic.',
      'acceptance_criteria:',
      '  - Prepare the protected auth-path request for human review.',
      '---',
      '',
      '# Optimize Policy Prompt',
      '',
      '## Objective',
      'Prepare the protected auth-path change request for human review without bypassing approval.',
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    casePath,
    [
      'version: 1',
      'id: optimize-policy-prompt',
      'title: Optimize Policy Prompt',
      'suiteIds:',
      '  - smoke',
      'tags: [smoke, ci-safe, approval]',
      'execution:',
      '  mode: ci_safe',
      '  runner: fake',
      '  approvalMode: fail',
      `  repoFixturePath: ${fixtureRepo}`,
      '  ciSafe: true',
      'input:',
      '  kind: markdown_spec',
      `  specFixturePath: ${specPath}`,
      'expected:',
      '  runStatus: awaiting_approval',
      '  policyDecision: prompt',
      '  approvalState: pending',
      '  verificationStatus: not_run',
      '  reviewPacketStatus: verification_failed',
      '  requiredArtifacts:',
      '    - run.json',
      '    - session.manifest.json',
      '    - approval-packet.json',
      '    - approval-packet.md',
      '    - review-packet.json',
      '    - review-packet.md',
      'weights:',
      '  success: 0.3',
      '  policy_correctness: 0.2',
      '  verification_correctness: 0.2',
      '  packet_completeness: 0.15',
      '  artifact_presence: 0.15',
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    suitePath,
    [
      'version: 1',
      'id: smoke',
      'title: Optimize Smoke Suite',
      'description: Bounded optimization harness suite.',
      'caseIds:',
      '  - optimize-policy-prompt',
      'tags: [smoke, ci-safe]',
      'mode: ci_safe',
      'thresholds:',
      '  maxOverallScoreDrop: 0',
      '  requiredMetrics:',
      '    - success',
      '    - policy_correctness',
      '    - verification_correctness',
      '    - packet_completeness',
      '    - artifact_presence',
      '  failOnNewlyFailingCases: true',
    ].join('\n'),
    'utf8',
  );

  return suitePath;
}

async function addSuiteBaseline(repoRoot: string, suitePath: string): Promise<void> {
  const benchmarkTargetService = createBenchmarkTargetService();
  const baselineResult = await benchmarkTargetService.runTarget({
    ciSafe: true,
    executeCase: executeBenchmarkCaseThroughRunSpec,
    repoRoot,
    targetId: 'smoke',
  });
  const baselinePath = resolve(repoRoot, 'benchmarks', 'baselines', 'smoke-baseline.json');

  await mkdir(resolve(repoRoot, 'benchmarks', 'baselines'), { recursive: true });
  await writeJson(baselinePath, baselineResult.benchmarkRun);
  await writeFile(
    suitePath,
    [
      'version: 1',
      'id: smoke',
      'title: Optimize Smoke Suite',
      'description: Bounded optimization harness suite.',
      'caseIds:',
      '  - optimize-policy-prompt',
      'tags: [smoke, ci-safe]',
      'mode: ci_safe',
      'baseline:',
      '  kind: benchmark_artifact',
      '  id: smoke-baseline',
      '  label: Optimize smoke baseline',
      '  artifactPath: benchmarks/baselines/smoke-baseline.json',
      `  benchmarkRunId: ${baselineResult.benchmarkRun.id}`,
      'thresholds:',
      '  maxOverallScoreDrop: 0',
      '  requiredMetrics:',
      '    - success',
      '    - policy_correctness',
      '    - verification_correctness',
      '    - packet_completeness',
      '    - artifact_presence',
      '  failOnNewlyFailingCases: true',
    ].join('\n'),
    'utf8',
  );
}

async function writeCandidateBundle(repoRoot: string, targetPath: string): Promise<string> {
  const candidateManifestPath = resolve(repoRoot, 'optimizations', 'candidate.json');
  const candidateFilePath = resolve(
    repoRoot,
    'optimizations',
    'files',
    'impact-preview-hints.json',
  );

  await mkdir(resolve(repoRoot, 'optimizations', 'files'), { recursive: true });
  await writeJson(candidateManifestPath, {
    version: 1,
    id: 'docs-auth-hint',
    title: 'Docs task protected auth hint',
    summary: 'Route docs-class protected auth requests into the approval surface before execution.',
    files: [
      {
        path: targetPath,
        sourcePath: 'files/impact-preview-hints.json',
      },
    ],
    notes: ['Synthetic bounded-optimization test candidate.'],
  });
  await writeJson(candidateFilePath, {
    version: 1,
    defaultPathHintsByTaskClass: {
      docs: ['src/auth/**'],
    },
  });

  return candidateManifestPath;
}

describe('bounded optimization workflow', () => {
  it('keeps an allowlisted heuristic candidate when it improves the benchmark target', async () => {
    const repoRoot = await createTempRepo();
    const fixtureRepo = await createTempRepo();

    await writeOptimizeConfig(repoRoot);
    await writeImpactPreviewHints(repoRoot, [
      'README.md',
      'docs/**',
      'documentation.md',
      'AGENTS.md',
      'PLANS.md',
      'implement.md',
    ]);
    await writeFile(
      resolve(fixtureRepo, 'policies', 'default.policy.yaml'),
      [
        'version: 1',
        'name: optimize-fixture',
        'defaults:',
        '  sandbox_mode: workspace-write',
        '  network_access: false',
        '  approval_policy: on-request',
        '  fallback_decision: allow',
        'rules:',
        '  - id: docs-safe',
        '    match:',
        '      task_classes: [docs]',
        '      paths:',
        '        - "README.md"',
        '        - "docs/**"',
        '        - "documentation.md"',
        '        - "AGENTS.md"',
        '        - "PLANS.md"',
        '        - "implement.md"',
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
      ].join('\n'),
      'utf8',
    );
    await mkdir(resolve(fixtureRepo, 'src', 'auth'), { recursive: true });
    await writeFile(
      resolve(fixtureRepo, 'src', 'auth', 'session.ts'),
      'export const session = true;\n',
      'utf8',
    );
    const suitePath = await seedPromptBenchmarkRepo(repoRoot, fixtureRepo);
    await addSuiteBaseline(repoRoot, suitePath);
    const candidateManifestPath = await writeCandidateBundle(
      repoRoot,
      'config/optimization/impact-preview-hints.json',
    );

    const summary = await runOptimizationCandidate(candidateManifestPath, {
      cwd: repoRoot,
      executeCase: executeBenchmarkCaseThroughRunSpec,
    });

    expect(summary.decision).toBe('keep');
    expect(summary.exitCode).toBe(0);
    expect(summary.optimizationRunId).toBeTruthy();
    expect(summary.scoreDelta).toBeGreaterThan(0);
    expect(summary.surfaceIds).toEqual(['impact-preview-hints']);

    const compareSummary = await compareOptimizationRunId(summary.optimizationRunId, {
      cwd: repoRoot,
    });
    const decideSummary = await decideOptimizationRunId(summary.optimizationRunId, {
      cwd: repoRoot,
    });

    expect(compareSummary.decision).toBe('keep');
    expect(decideSummary.decision).toBe('keep');
    expect(decideSummary.scoreDelta).toBe(summary.scoreDelta);
  }, 60_000);

  it('blocks candidate files that escape the configured optimization surface', async () => {
    const repoRoot = await createTempRepo();

    await writeOptimizeConfig(repoRoot);
    await writeImpactPreviewHints(repoRoot, ['docs/**']);

    const candidateManifestPath = resolve(repoRoot, 'optimizations', 'blocked-candidate.json');
    const candidateFilePath = resolve(repoRoot, 'optimizations', 'files', 'README.md');

    await mkdir(resolve(repoRoot, 'optimizations', 'files'), { recursive: true });
    await writeJson(candidateManifestPath, {
      version: 1,
      id: 'blocked-readme-edit',
      title: 'Blocked README edit',
      summary: 'Attempt to mutate a path outside the allowed optimization surface.',
      files: [
        {
          path: 'README.md',
          sourcePath: 'files/README.md',
        },
      ],
      notes: [],
    });
    await writeFile(candidateFilePath, '# blocked\n', 'utf8');

    const summary = await runOptimizationCandidate(candidateManifestPath, {
      cwd: repoRoot,
      executeCase: executeBenchmarkCaseThroughRunSpec,
    });

    expect(summary.decision).toBe('reject');
    expect(summary.status).toBe('blocked');
    expect(summary.blockedPaths).toEqual(['README.md']);
    expect(summary.benchmarkRunId).toBeUndefined();
  });
});
