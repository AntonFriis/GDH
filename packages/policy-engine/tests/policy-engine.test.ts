import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createPlanFromSpec, normalizeMarkdownSpec } from '@gdh/domain';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditRun,
  createApprovalResolutionRecord,
  type EvaluateSpecResult,
  evaluateSpec,
} from '../src/index';
import {
  loadImpactPreviewHeuristics,
  loadPolicyPackFromFile,
  matchesCommandPattern,
  matchesCommandPrefix,
  matchesPathGlob,
} from '../src/internals';

const tempDirectories: string[] = [];

async function createTempPolicy(contents: string): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'gdh-policy-test-'));
  const policyPath = resolve(directory, 'policy.yaml');

  tempDirectories.push(directory);
  await writeFile(policyPath, contents, 'utf8');

  return policyPath;
}

async function createTempHeuristics(contents: string): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'gdh-heuristics-test-'));
  const configRoot = resolve(directory, 'config', 'optimization');
  const heuristicsPath = resolve(configRoot, 'impact-preview-hints.json');

  tempDirectories.push(directory);
  await mkdir(configRoot, { recursive: true });
  await writeFile(heuristicsPath, contents, 'utf8');

  return directory;
}

function createSpec(
  sourcePath: string,
  objective: string,
  taskClass: 'docs' | 'ci' = 'docs',
): ReturnType<typeof normalizeMarkdownSpec> {
  return normalizeMarkdownSpec({
    content: [
      '---',
      'title: Policy Engine Smoke',
      `task_type: ${taskClass}`,
      'risk_hints:',
      '  - touches protected surfaces if the preview crosses auth or secrets.',
      '---',
      '',
      '# Policy Engine Smoke',
      '',
      '## Objective',
      objective,
      '',
      '## Acceptance Criteria',
      '- Keep the preview and decision deterministic.',
    ].join('\n'),
    createdAt: '2026-03-16T20:00:00.000Z',
    repoRoot: '/tmp/gdh',
    sourcePath,
  });
}

async function evaluateObjective(input: {
  approvalMode?: 'fail' | 'interactive';
  objective: string;
  policyPath: string;
  repoRoot?: string;
  runId: string;
  taskClass?: 'docs' | 'ci';
}): Promise<{
  result: EvaluateSpecResult;
  spec: ReturnType<typeof normalizeMarkdownSpec>;
}> {
  const spec = createSpec('/tmp/gdh/spec.md', input.objective, input.taskClass ?? 'docs');
  const plan = createPlanFromSpec(spec, '2026-03-16T20:05:00.000Z');
  const result = await evaluateSpec({
    approvalMode: input.approvalMode ?? 'fail',
    artifactPaths: ['/tmp/run/spec.normalized.json', '/tmp/run/plan.json'],
    plan,
    policyPackPath: input.policyPath,
    repoRoot: input.repoRoot ?? '/tmp/gdh',
    runId: input.runId,
    spec,
  });

  return { result, spec };
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('public surface', () => {
  it('contracts the root exports to the session pipeline boundary', async () => {
    const policyEngine = await import('../src/index');
    expect(Object.keys(policyEngine).sort()).toEqual([
      'auditRun',
      'createApprovalResolutionRecord',
      'evaluateSpec',
    ]);
  });
});

describe('internals', () => {
  it('parses YAML and normalizes legacy decision names', async () => {
    const policyPath = await createTempPolicy(
      [
        'version: 1',
        'name: test-pack',
        'defaults:',
        '  sandbox_mode: workspace-write',
        '  network_access: false',
        '  approval_policy: on-request',
        '  fallback_decision: prompt',
        'rules:',
        '  - id: legacy-rule',
        '    match:',
        '      paths: ["src/auth/**"]',
        '      actions: [write, run_tests]',
        '    decision: require_approval',
      ].join('\n'),
    );

    const { pack } = await loadPolicyPackFromFile(policyPath);

    expect(pack.defaults.fallbackDecision).toBe('prompt');
    expect(pack.rules[0]?.decision).toBe('prompt');
    expect(pack.rules[0]?.match.actionKinds).toEqual(['write', 'command']);
  });

  it('merges partial heuristic overrides onto the default heuristic set', async () => {
    const repoRoot = await createTempHeuristics(
      JSON.stringify(
        {
          version: 1,
          defaultPathHintsByTaskClass: {
            docs: ['src/auth/**'],
          },
        },
        null,
        2,
      ),
    );

    const heuristics = await loadImpactPreviewHeuristics(repoRoot);

    expect(heuristics.defaultPathHintsByTaskClass.docs).toEqual(['src/auth/**']);
    expect(heuristics.defaultPathHintsByTaskClass.tests).toEqual([
      'tests/**',
      '**/*.test.ts',
      '**/*.spec.ts',
    ]);
  });

  it('matches file globs, command prefixes, and command patterns deterministically', () => {
    expect(matchesPathGlob('docs/guide.md', 'docs/**')).toBe(true);
    expect(matchesPathGlob('src/auth/guard.ts', 'docs/**')).toBe(false);
    expect(matchesCommandPrefix('git push origin main', 'git push')).toBe(true);
    expect(matchesCommandPrefix('pnpm test', 'git push')).toBe(false);
    expect(matchesCommandPattern('pnpm test --filter cli', '/pnpm\\s+test/')).toBe(true);
    expect(matchesCommandPattern('curl https://example.com', 'curl\\s+https?://')).toBe(true);
  });
});

describe('evaluateSpec', () => {
  it('allows docs-only work inside an explicitly allowed surface', async () => {
    const policyPath = await createTempPolicy(
      [
        'version: 1',
        'name: allow-docs',
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
      ].join('\n'),
    );

    const { result } = await evaluateObjective({
      objective: 'Update `docs/guide.md` with a short Phase 8 note.',
      policyPath,
      runId: 'run-allow',
    });

    expect(result.policyDecision.decision).toBe('allow');
    expect(result.policyDecision.matchedRules[0]?.ruleId).toBe('docs-safe');
    expect(result.approval).toBeNull();
  });

  it('returns approval artifacts only when the decision is prompt', async () => {
    const policyPath = await createTempPolicy(
      [
        'version: 1',
        'name: auth-prompt',
        'defaults:',
        '  sandbox_mode: workspace-write',
        '  network_access: false',
        '  approval_policy: on-request',
        '  fallback_decision: prompt',
        'rules:',
        '  - id: auth-protected',
        '    match:',
        '      paths: ["src/auth/**"]',
        '      actions: [write]',
        '    decision: prompt',
        '    reason: Auth changes require human review.',
      ].join('\n'),
    );

    const { result } = await evaluateObjective({
      approvalMode: 'interactive',
      objective: 'Update `src/auth/guard.ts` with a protected change.',
      policyPath,
      runId: 'run-prompt',
    });

    expect(result.policyDecision.decision).toBe('prompt');
    expect(result.policyDecision.requiredApprovalMode).toBe('interactive');
    expect(result.approval?.packet.affectedPaths).toContain('src/auth/guard.ts');
    expect(result.approval?.markdown).toContain('Auth changes require human review.');
  });

  it('uses one generated timestamp across preview, decision, and approval artifacts', async () => {
    const policyPath = await createTempPolicy(
      [
        'version: 1',
        'name: auth-prompt',
        'defaults:',
        '  sandbox_mode: workspace-write',
        '  network_access: false',
        '  approval_policy: on-request',
        '  fallback_decision: prompt',
        'rules:',
        '  - id: auth-protected',
        '    match:',
        '      paths: ["src/auth/**"]',
        '      actions: [write]',
        '    decision: prompt',
      ].join('\n'),
    );

    const { result } = await evaluateObjective({
      approvalMode: 'interactive',
      objective: 'Update `src/auth/guard.ts` with a protected change.',
      policyPath,
      runId: 'run-consistent-created-at',
    });

    expect(result.policyPackDefaults.fallbackDecision).toBe('prompt');
    expect(result.impactPreview.createdAt).toBe(result.policyDecision.createdAt);
    expect(result.approval?.packet.createdAt).toBe(result.policyDecision.createdAt);
  });

  it('keeps explicitly allowed ci write paths allowed when only heuristic validation commands are present', async () => {
    const policyPath = await createTempPolicy(
      [
        'version: 1',
        'name: ci-safe-paths',
        'defaults:',
        '  sandbox_mode: workspace-write',
        '  network_access: false',
        '  approval_policy: on-request',
        '  fallback_decision: prompt',
        'rules:',
        '  - id: ci-safe',
        '    match:',
        '      task_classes: [ci]',
        '      paths: [".github/workflows/**"]',
        '      actions: [read, write]',
        '    decision: allow',
      ].join('\n'),
    );

    const { result } = await evaluateObjective({
      objective: 'Edit `.github/workflows/ci.yml` to clean up a stale comment.',
      policyPath,
      runId: 'run-ci-heuristic',
      taskClass: 'ci',
    });

    expect(result.impactPreview.proposedCommands.map((command) => command.source)).toEqual([
      'heuristic',
      'heuristic',
    ]);
    expect(result.policyDecision.decision).toBe('allow');
    expect(result.policyDecision.reasons[0]?.ruleId).toBe('ci-safe');
  });

  it('prefers forbid over broader allow coverage', async () => {
    const policyPath = await createTempPolicy(
      [
        'version: 1',
        'name: forbid-pack',
        'defaults:',
        '  sandbox_mode: workspace-write',
        '  network_access: false',
        '  approval_policy: on-request',
        '  fallback_decision: prompt',
        'rules:',
        '  - id: docs-safe',
        '    match:',
        '      task_classes: [docs]',
        '      actions: [read, write]',
        '    decision: allow',
        '  - id: secrets-forbidden',
        '    match:',
        '      paths: [".env", ".env.*"]',
        '      actions: [read, write, secrets_touch]',
        '    decision: forbid',
      ].join('\n'),
    );

    const { result } = await evaluateObjective({
      objective: 'Edit `.env.local` to prove the secret path is blocked.',
      policyPath,
      runId: 'run-forbid',
    });

    expect(result.policyDecision.decision).toBe('forbid');
    expect(result.policyDecision.reasons[0]?.ruleId).toBe('secrets-forbidden');
    expect(result.approval).toBeNull();
  });
});

describe('auditRun', () => {
  it('reports clean when actual evidence stays within the previewed scope', async () => {
    const policyPath = await createTempPolicy(
      [
        'version: 1',
        'name: allow-docs',
        'defaults:',
        '  sandbox_mode: workspace-write',
        '  network_access: false',
        '  approval_policy: on-request',
        '  fallback_decision: prompt',
        'rules:',
        '  - id: docs-safe',
        '    match:',
        '      task_classes: [docs]',
        '      paths: ["docs/**"]',
        '      actions: [read, write]',
        '    decision: allow',
      ].join('\n'),
    );

    const { result, spec } = await evaluateObjective({
      objective: 'Update `docs/guide.md` with a short note.',
      policyPath,
      runId: 'run-clean',
    });
    const audit = await auditRun({
      changedFiles: {
        files: [
          {
            afterHash: 'after',
            beforeHash: 'before',
            path: 'docs/guide.md',
            status: 'modified',
          },
        ],
        notes: [],
        source: 'workspace_snapshot',
      },
      commandCapture: {
        commands: [],
        completeness: 'complete',
        notes: [],
        source: 'fake_runner',
      },
      policyPackPath: policyPath,
      priorResult: result,
      spec,
    });

    expect(audit.status).toBe('clean');
    expect(audit.unexpectedPaths).toEqual([]);
  });

  it('reports scope drift when actual changes exceed the preview without touching protected scope', async () => {
    const policyPath = await createTempPolicy(
      [
        'version: 1',
        'name: allow-docs',
        'defaults:',
        '  sandbox_mode: workspace-write',
        '  network_access: false',
        '  approval_policy: on-request',
        '  fallback_decision: allow',
        'rules:',
        '  - id: docs-safe',
        '    match:',
        '      task_classes: [docs]',
        '      paths: ["docs/**"]',
        '      actions: [read, write]',
        '    decision: allow',
      ].join('\n'),
    );

    const { result, spec } = await evaluateObjective({
      objective: 'Update `docs/guide.md` with a short note.',
      policyPath,
      runId: 'run-scope-drift',
    });
    const audit = await auditRun({
      changedFiles: {
        files: [
          {
            afterHash: 'after',
            beforeHash: 'before',
            path: 'README.md',
            status: 'modified',
          },
        ],
        notes: [],
        source: 'workspace_snapshot',
      },
      commandCapture: {
        commands: [],
        completeness: 'complete',
        notes: [],
        source: 'fake_runner',
      },
      policyPackPath: policyPath,
      priorResult: result,
      spec,
    });

    expect(audit.status).toBe('scope_drift');
    expect(audit.unexpectedPaths).toContain('README.md');
  });

  it('reports a policy breach when protected scope drifts outside the approved preview', async () => {
    const policyPath = await createTempPolicy(
      [
        'version: 1',
        'name: audit-pack',
        'defaults:',
        '  sandbox_mode: workspace-write',
        '  network_access: false',
        '  approval_policy: on-request',
        '  fallback_decision: allow',
        'rules:',
        '  - id: auth-protected',
        '    match:',
        '      paths: ["src/auth/**"]',
        '      actions: [write]',
        '    decision: prompt',
      ].join('\n'),
    );

    const { result, spec } = await evaluateObjective({
      approvalMode: 'interactive',
      objective: 'Update `src/auth/guard.ts` with a protected change.',
      policyPath,
      runId: 'run-breach',
    });
    const audit = await auditRun({
      approvalResolution: 'approved',
      changedFiles: {
        files: [
          {
            afterHash: 'after',
            beforeHash: 'before',
            path: 'src/auth/extra.ts',
            status: 'modified',
          },
        ],
        notes: [],
        source: 'workspace_snapshot',
      },
      commandCapture: {
        commands: [],
        completeness: 'complete',
        notes: [],
        source: 'fake_runner',
      },
      policyPackPath: policyPath,
      priorResult: result,
      spec,
    });

    expect(audit.status).toBe('policy_breach');
    expect(audit.unexpectedPaths).toContain('src/auth/extra.ts');
  });

  it('fails fast when the audit call is pointed at a different policy pack path', async () => {
    const policyPath = await createTempPolicy(
      [
        'version: 1',
        'name: audit-pack',
        'defaults:',
        '  sandbox_mode: workspace-write',
        '  network_access: false',
        '  approval_policy: on-request',
        '  fallback_decision: allow',
        'rules:',
        '  - id: docs-safe',
        '    match:',
        '      task_classes: [docs]',
        '      paths: ["docs/**"]',
        '      actions: [read, write]',
        '    decision: allow',
      ].join('\n'),
    );
    const otherPolicyPath = await createTempPolicy(
      [
        'version: 1',
        'name: different-pack',
        'defaults:',
        '  sandbox_mode: read-only',
        '  network_access: false',
        '  approval_policy: never',
        '  fallback_decision: forbid',
        'rules: []',
      ].join('\n'),
    );

    const { result, spec } = await evaluateObjective({
      objective: 'Update `docs/guide.md` with a short note.',
      policyPath,
      runId: 'run-audit-path-mismatch',
    });

    await expect(
      auditRun({
        changedFiles: {
          files: [],
          notes: [],
          source: 'workspace_snapshot',
        },
        commandCapture: {
          commands: [],
          completeness: 'complete',
          notes: [],
          source: 'fake_runner',
        },
        policyPackPath: otherPolicyPath,
        priorResult: result,
        spec,
      }),
    ).rejects.toThrow('Audit policy pack path mismatch');
  });
});

describe('approval resolution', () => {
  it('creates a stable approval resolution record', () => {
    const resolution = createApprovalResolutionRecord({
      actor: 'tester',
      approvalPacketId: 'approval-1',
      notes: ['Looks safe.'],
      resolution: 'approved',
      runId: 'run-1',
    });

    expect(resolution.actor).toBe('tester');
    expect(resolution.notes).toEqual(['Looks safe.']);
    expect(resolution.id).toContain('approval-resolution');
  });
});
