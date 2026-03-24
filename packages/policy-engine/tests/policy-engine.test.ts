import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createPlanFromSpec, normalizeMarkdownSpec } from '@gdh/domain';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createApprovalPacket,
  createPolicyAudit,
  evaluatePolicy,
  generateImpactPreview,
  loadPolicyPackFromFile,
  matchesCommandPattern,
  matchesCommandPrefix,
  matchesPathGlob,
} from '../src/index';

const tempDirectories: string[] = [];

async function createTempPolicy(contents: string): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'gdh-policy-test-'));
  const policyPath = resolve(directory, 'policy.yaml');

  tempDirectories.push(directory);
  await writeFile(policyPath, contents, 'utf8');

  return policyPath;
}

function createSpec(
  sourcePath: string,
  objective: string,
): ReturnType<typeof normalizeMarkdownSpec> {
  return normalizeMarkdownSpec({
    content: [
      '---',
      'title: Policy Engine Smoke',
      'task_type: docs',
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

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('loadPolicyPackFromFile', () => {
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
});

describe('matcher helpers', () => {
  it('matches file globs deterministically', () => {
    expect(matchesPathGlob('docs/guide.md', 'docs/**')).toBe(true);
    expect(matchesPathGlob('src/auth/guard.ts', 'docs/**')).toBe(false);
  });

  it('matches command prefixes and regex patterns', () => {
    expect(matchesCommandPrefix('git push origin main', 'git push')).toBe(true);
    expect(matchesCommandPrefix('pnpm test', 'git push')).toBe(false);
    expect(matchesCommandPattern('pnpm test --filter cli', '/pnpm\\s+test/')).toBe(true);
    expect(matchesCommandPattern('curl https://example.com', 'curl\\s+https?://')).toBe(true);
  });
});

describe('evaluatePolicy', () => {
  it('allows a docs-only preview inside the safe surface', async () => {
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
    const { pack } = await loadPolicyPackFromFile(policyPath);
    const spec = createSpec(
      '/tmp/gdh/spec.md',
      'Update `docs/guide.md` with a short Phase 2 note.',
    );
    const plan = createPlanFromSpec(spec, '2026-03-16T20:05:00.000Z');
    const preview = generateImpactPreview({
      networkAccess: pack.defaults.networkAccess,
      plan,
      runId: 'run-allow',
      sandboxMode: pack.defaults.sandboxMode,
      spec,
    });
    const decision = evaluatePolicy({
      approvalMode: 'fail',
      impactPreview: preview,
      policyPack: pack,
      policyPackPath: policyPath,
      spec,
    });

    expect(decision.decision).toBe('allow');
    expect(decision.matchedRules[0]?.ruleId).toBe('docs-safe');
  });

  it('keeps docs-safe allow when the spec also mentions benign validation commands', async () => {
    const policyPath = await createTempPolicy(
      [
        'version: 1',
        'name: docs-with-commands',
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
        '  - id: local-validation-safe',
        '    match:',
        '      command_prefixes: ["pnpm lint", "pnpm test"]',
        '      actions: [command]',
        '    decision: allow',
      ].join('\n'),
    );
    const { pack } = await loadPolicyPackFromFile(policyPath);
    const spec = createSpec(
      '/tmp/gdh/spec.md',
      'Update `docs/guide.md` with a short note, then run `pnpm lint`.',
    );
    const plan = createPlanFromSpec(spec, '2026-03-16T20:05:00.000Z');
    const preview = generateImpactPreview({
      networkAccess: pack.defaults.networkAccess,
      plan,
      runId: 'run-docs-command-allow',
      sandboxMode: pack.defaults.sandboxMode,
      spec,
    });
    const decision = evaluatePolicy({
      approvalMode: 'fail',
      impactPreview: preview,
      policyPack: pack,
      policyPackPath: policyPath,
      spec,
    });

    expect(decision.decision).toBe('allow');
    expect(decision.reasons[0]?.ruleId).toBe('docs-safe');
    expect(decision.matchedRules.map((rule) => rule.ruleId)).toEqual(
      expect.arrayContaining(['docs-safe', 'local-validation-safe']),
    );
  });

  it('does not auto-allow protected write surfaces just because benign commands are allowed', async () => {
    const policyPath = await createTempPolicy(
      [
        'version: 1',
        'name: protected-path-fallback',
        'defaults:',
        '  sandbox_mode: workspace-write',
        '  network_access: false',
        '  approval_policy: on-request',
        '  fallback_decision: prompt',
        'rules:',
        '  - id: local-validation-safe',
        '    match:',
        '      command_prefixes: ["pnpm lint", "pnpm test"]',
        '      actions: [command]',
        '    decision: allow',
        '  - id: workflow-read-only',
        '    match:',
        '      task_classes: [ci]',
        '      actions: [read]',
        '    decision: allow',
      ].join('\n'),
    );
    const { pack } = await loadPolicyPackFromFile(policyPath);
    const spec = normalizeMarkdownSpec({
      content: [
        '---',
        'title: CI Workflow Cleanup',
        'task_type: ci',
        '---',
        '',
        '# CI Workflow Cleanup',
        '',
        '## Objective',
        'Edit `.github/workflows/ci.yml` to clean up a stale comment and run `pnpm lint`.',
        '',
        '## Acceptance Criteria',
        '- Keep the preview deterministic.',
      ].join('\n'),
      createdAt: '2026-03-16T20:00:00.000Z',
      repoRoot: '/tmp/gdh',
      sourcePath: '/tmp/gdh/spec.md',
    });
    const plan = createPlanFromSpec(spec, '2026-03-16T20:05:00.000Z');
    const preview = generateImpactPreview({
      networkAccess: pack.defaults.networkAccess,
      plan,
      runId: 'run-ci-prompt',
      sandboxMode: pack.defaults.sandboxMode,
      spec,
    });
    const decision = evaluatePolicy({
      approvalMode: 'interactive',
      impactPreview: preview,
      policyPack: pack,
      policyPackPath: policyPath,
      spec,
    });

    expect(decision.decision).toBe('prompt');
    expect(decision.reasons[0]?.ruleId).toBeNull();
    expect(decision.reasons[0]?.summary).toContain('.github/workflows/ci.yml');
    expect(decision.matchedRules.map((rule) => rule.ruleId)).toContain('local-validation-safe');
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
    const { pack } = await loadPolicyPackFromFile(policyPath);
    const spec = normalizeMarkdownSpec({
      content: [
        '---',
        'title: CI Workflow Cleanup',
        'task_type: ci',
        '---',
        '',
        '# CI Workflow Cleanup',
        '',
        '## Objective',
        'Edit `.github/workflows/ci.yml` to clean up a stale comment.',
        '',
        '## Acceptance Criteria',
        '- Keep the preview deterministic.',
      ].join('\n'),
      createdAt: '2026-03-16T20:00:00.000Z',
      repoRoot: '/tmp/gdh',
      sourcePath: '/tmp/gdh/spec.md',
    });
    const plan = createPlanFromSpec(spec, '2026-03-16T20:05:00.000Z');
    const preview = generateImpactPreview({
      networkAccess: pack.defaults.networkAccess,
      plan,
      runId: 'run-ci-heuristic-commands',
      sandboxMode: pack.defaults.sandboxMode,
      spec,
    });
    const decision = evaluatePolicy({
      approvalMode: 'fail',
      impactPreview: preview,
      policyPack: pack,
      policyPackPath: policyPath,
      spec,
    });

    expect(preview.proposedCommands.map((command) => command.source)).toEqual([
      'heuristic',
      'heuristic',
    ]);
    expect(decision.decision).toBe('allow');
    expect(decision.reasons[0]?.ruleId).toBe('ci-safe');
  });

  it('prefers prompt over an allow rule when a protected path also matches', async () => {
    const policyPath = await createTempPolicy(
      [
        'version: 1',
        'name: precedence-pack',
        'defaults:',
        '  sandbox_mode: workspace-write',
        '  network_access: false',
        '  approval_policy: on-request',
        '  fallback_decision: allow',
        'rules:',
        '  - id: docs-safe',
        '    match:',
        '      task_classes: [docs]',
        '      actions: [read, write]',
        '    decision: allow',
        '  - id: auth-protected',
        '    match:',
        '      paths: ["src/auth/**"]',
        '      actions: [write]',
        '    decision: prompt',
      ].join('\n'),
    );
    const { pack } = await loadPolicyPackFromFile(policyPath);
    const spec = createSpec(
      '/tmp/gdh/spec.md',
      'Update `src/auth/guard.ts` with a docs-adjacent explanation.',
    );
    const plan = createPlanFromSpec(spec, '2026-03-16T20:05:00.000Z');
    const preview = generateImpactPreview({
      networkAccess: pack.defaults.networkAccess,
      plan,
      runId: 'run-prompt',
      sandboxMode: pack.defaults.sandboxMode,
      spec,
    });
    const decision = evaluatePolicy({
      approvalMode: 'interactive',
      impactPreview: preview,
      policyPack: pack,
      policyPackPath: policyPath,
      spec,
    });

    expect(decision.decision).toBe('prompt');
    expect(decision.requiredApprovalMode).toBe('interactive');
    expect(decision.reasons[0]?.ruleId).toBe('auth-protected');
  });

  it('prefers forbid over prompt or allow matches', async () => {
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
        '  - id: auth-protected',
        '    match:',
        '      paths: ["src/auth/**"]',
        '      actions: [write]',
        '    decision: prompt',
        '  - id: secrets-forbidden',
        '    match:',
        '      paths: [".env", ".env.*"]',
        '      actions: [read, write, secrets_touch]',
        '    decision: forbid',
      ].join('\n'),
    );
    const { pack } = await loadPolicyPackFromFile(policyPath);
    const spec = createSpec(
      '/tmp/gdh/spec.md',
      'Edit `.env.local` to prove the secret path is blocked.',
    );
    const plan = createPlanFromSpec(spec, '2026-03-16T20:05:00.000Z');
    const preview = generateImpactPreview({
      networkAccess: pack.defaults.networkAccess,
      plan,
      runId: 'run-forbid',
      sandboxMode: pack.defaults.sandboxMode,
      spec,
    });
    const decision = evaluatePolicy({
      approvalMode: 'fail',
      impactPreview: preview,
      policyPack: pack,
      policyPackPath: policyPath,
      spec,
    });

    expect(decision.decision).toBe('forbid');
    expect(decision.reasons[0]?.ruleId).toBe('secrets-forbidden');
  });
});

describe('approval packet and audit helpers', () => {
  it('builds an approval packet with human-readable context', async () => {
    const policyPath = await createTempPolicy(
      [
        'version: 1',
        'name: prompt-pack',
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
    const { pack } = await loadPolicyPackFromFile(policyPath);
    const spec = createSpec(
      '/tmp/gdh/spec.md',
      'Update `src/auth/guard.ts` with a protected change.',
    );
    const plan = createPlanFromSpec(spec, '2026-03-16T20:05:00.000Z');
    const preview = generateImpactPreview({
      networkAccess: pack.defaults.networkAccess,
      plan,
      runId: 'run-approval',
      sandboxMode: pack.defaults.sandboxMode,
      spec,
    });
    const decision = evaluatePolicy({
      approvalMode: 'interactive',
      impactPreview: preview,
      policyPack: pack,
      policyPackPath: policyPath,
      spec,
    });
    const packet = createApprovalPacket({
      artifactPaths: ['/tmp/run/impact-preview.json', '/tmp/run/policy.decision.json'],
      impactPreview: preview,
      policyDecision: decision,
      runId: 'run-approval',
      spec,
    });

    expect(packet.policyDecision).toBe('prompt');
    expect(packet.affectedPaths).toContain('src/auth/guard.ts');
    expect(packet.whyApprovalIsRequired[0]).toContain('Auth changes require human review.');
  });

  it('flags an obvious policy breach when actual changes escape the approved preview scope', async () => {
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
    const { pack } = await loadPolicyPackFromFile(policyPath);
    const spec = createSpec(
      '/tmp/gdh/spec.md',
      'Update `src/auth/guard.ts` with a protected change.',
    );
    const plan = createPlanFromSpec(spec, '2026-03-16T20:05:00.000Z');
    const preview = generateImpactPreview({
      networkAccess: pack.defaults.networkAccess,
      plan,
      runId: 'run-audit',
      sandboxMode: pack.defaults.sandboxMode,
      spec,
    });
    const decision = evaluatePolicy({
      approvalMode: 'interactive',
      impactPreview: preview,
      policyPack: pack,
      policyPackPath: policyPath,
      spec,
    });
    const audit = createPolicyAudit({
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
      impactPreview: preview,
      policyDecision: decision,
      policyPack: pack,
      spec,
    });

    expect(audit.status).toBe('policy_breach');
    expect(audit.unexpectedPaths).toContain('src/auth/extra.ts');
  });
});
