import { describe, expect, it } from 'vitest';
import { createReviewPacket, renderReviewPacketMarkdown } from '../src/index';

describe('createReviewPacket', () => {
  it('builds a conservative review packet from run evidence', () => {
    const packet = createReviewPacket({
      artifacts: [
        {
          id: 'artifact-1',
          runId: 'run-1',
          kind: 'run-record',
          path: '/tmp/run-1/run.json',
          format: 'json',
          createdAt: '2026-03-16T20:00:00.000Z',
        },
      ],
      changedFiles: {
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
      },
      plan: {
        id: 'plan-1',
        specId: 'spec-1',
        summary: 'Apply a docs-only change.',
        taskUnits: [],
        doneConditions: ['Update the docs page.'],
        assumptions: [],
        openQuestions: ['Should the wording mention Phase 2?'],
        generatedAt: '2026-03-16T20:00:00.000Z',
      },
      run: {
        id: 'run-1',
        specId: 'spec-1',
        planId: 'plan-1',
        status: 'completed',
        runner: 'fake',
        model: 'gpt-5.4',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalMode: 'fail',
        networkAccess: false,
        policyPackName: 'default',
        policyPackVersion: 1,
        policyPackPath: '/tmp/repo/policies/default.policy.yaml',
        repoRoot: '/tmp/repo',
        runDirectory: '/tmp/repo/runs/local/run-1',
        sourceSpecPath: '/tmp/repo/spec.md',
        createdAt: '2026-03-16T20:00:00.000Z',
        updatedAt: '2026-03-16T20:05:00.000Z',
        summary: 'Done.',
      },
      runnerResult: {
        status: 'completed',
        summary: 'Updated the docs page.',
        exitCode: 0,
        durationMs: 10,
        prompt: 'prompt',
        stdout: '',
        stderr: '',
        commandCapture: {
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
        },
        reportedChangedFiles: ['docs/example.md'],
        reportedChangedFilesCompleteness: 'complete',
        reportedChangedFilesNotes: [],
        limitations: ['Fake runner only.'],
        artifactsProduced: [],
        metadata: {},
      },
      policyDecision: {
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
        policyPackPath: '/tmp/repo/policies/default.policy.yaml',
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
      },
      policyAudit: {
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
        runId: 'run-1',
        status: 'clean',
        summary:
          'Policy audit found no obvious drift between the previewed scope and the actual run evidence.',
        unexpectedCommands: ['fake-runner.write docs/example.md'],
        unexpectedPaths: [],
      },
      spec: {
        id: 'spec-1',
        source: 'markdown',
        sourcePath: '/tmp/repo/spec.md',
        repoRoot: '/tmp/repo',
        title: 'Docs change',
        summary: 'Refresh docs.',
        objective: 'Update docs/example.md.',
        taskClass: 'docs',
        constraints: [],
        acceptanceCriteria: ['Update the docs page.'],
        riskHints: [],
        body: '# Docs change',
        normalizationNotes: [],
        inferredFields: [],
        createdAt: '2026-03-16T20:00:00.000Z',
      },
      verificationStatus: 'not_run',
    });

    expect(packet.changedFiles).toEqual(['docs/example.md']);
    expect(packet.commandsExecuted).toHaveLength(1);
    expect(packet.limitations).toContain(
      'Automated verification beyond the Phase 2 policy audit was not run yet.',
    );
    expect(packet.policyDecision).toBe('allow');
  });
});

describe('renderReviewPacketMarkdown', () => {
  it('renders the expected sections', () => {
    const markdown = renderReviewPacketMarkdown({
      id: 'review-1',
      runId: 'run-1',
      title: 'Review Packet: Docs change',
      specTitle: 'Docs change',
      status: 'completed',
      planSummary: 'Apply a docs-only change.',
      runnerSummary: 'Updated the docs page.',
      changedFiles: ['docs/example.md'],
      commandsExecuted: [
        {
          command: 'fake-runner.write docs/example.md',
          provenance: 'observed',
          isPartial: false,
        },
      ],
      artifactPaths: ['/tmp/run-1/run.json'],
      diffSummary: ['1 file(s) changed'],
      policyDecision: 'allow',
      policySummary: 'Rule "docs-safe" matched "docs/example.md".',
      approvalResolution: undefined,
      policyAuditStatus: 'clean',
      policyAuditSummary:
        'Policy audit did not record any unexpected paths or commands after the run.',
      limitations: ['Automated verification was not run in Phase 1.'],
      openQuestions: ['Should the wording mention Phase 2?'],
      verificationStatus: 'not_run',
      createdAt: '2026-03-16T20:05:00.000Z',
    });

    expect(markdown).toContain('## Changed Files');
    expect(markdown).toContain('## Commands Executed');
    expect(markdown).toContain('## Policy Decision');
    expect(markdown).toContain('## Policy Audit');
    expect(markdown).toContain('Verification status: not_run');
  });
});
