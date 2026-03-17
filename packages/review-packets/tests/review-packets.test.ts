import { describe, expect, it } from 'vitest';
import { createReviewPacket, renderReviewPacketMarkdown } from '../src/index';

function createClaimVerificationSummary() {
  return {
    status: 'passed' as const,
    summary: 'All review packet claims matched the recorded evidence.',
    totalClaims: 4,
    passedClaims: 4,
    failedClaims: 0,
    results: [],
  };
}

describe('createReviewPacket', () => {
  it('builds an evidence-based review packet with verification sections', () => {
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
      claimVerification: createClaimVerificationSummary(),
      plan: {
        id: 'plan-1',
        specId: 'spec-1',
        summary: 'Apply a docs-only change.',
        taskUnits: [],
        doneConditions: ['Update the docs page.'],
        assumptions: [],
        openQuestions: ['Should the wording mention Phase 3?'],
        generatedAt: '2026-03-16T20:00:00.000Z',
      },
      run: {
        id: 'run-1',
        specId: 'spec-1',
        planId: 'plan-1',
        status: 'verifying',
        verificationStatus: 'not_run',
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
      runCompletion: {
        finalStatus: 'completed',
        canComplete: true,
        summary: 'Verification passed and the run can be marked completed.',
        blockingCheckIds: [],
        blockingReasons: [],
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
        unexpectedCommands: [],
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
      verificationCommands: [
        {
          id: 'verification-command-1',
          command: 'pnpm test',
          phase: 'postrun',
          mandatory: true,
          status: 'passed',
          exitCode: 0,
          durationMs: 100,
          summary: 'Verification command "pnpm test" passed.',
          stdoutArtifactPath: '/tmp/run-1/verification/commands/postrun-1.stdout.log',
          stderrArtifactPath: '/tmp/run-1/verification/commands/postrun-1.stderr.log',
          startedAt: '2026-03-16T20:04:00.000Z',
          completedAt: '2026-03-16T20:04:00.100Z',
          evidence: [],
        },
      ],
      verificationStatus: 'passed',
      verificationSummary: 'Verification passed and the run can be marked completed.',
      verifiedAt: '2026-03-16T20:05:00.000Z',
    });

    expect(packet.runStatus).toBe('completed');
    expect(packet.packetStatus).toBe('ready');
    expect(packet.filesChanged).toEqual(['docs/example.md']);
    expect(packet.policy.decision).toBe('allow');
    expect(packet.approvals.status).toBe('not_required');
    expect(packet.verification.status).toBe('passed');
    expect(packet.claimVerification.status).toBe('passed');
    expect(packet.rollbackHint).toContain('diff.patch');
  });
});

describe('renderReviewPacketMarkdown', () => {
  it('renders the expected Phase 3 sections', () => {
    const markdown = renderReviewPacketMarkdown({
      id: 'review-1',
      runId: 'run-1',
      title: 'Review Packet: Docs change',
      specTitle: 'Docs change',
      runStatus: 'completed',
      packetStatus: 'ready',
      objective: 'Update docs/example.md.',
      overview:
        'Objective: Update docs/example.md. | Files changed: 1 | Mandatory verification commands passed: 1/1 | Verification status: passed',
      planSummary: 'Apply a docs-only change.',
      runnerReportedSummary: 'Updated the docs page.',
      filesChanged: ['docs/example.md'],
      commandsExecuted: [
        {
          command: 'fake-runner.write docs/example.md',
          provenance: 'observed',
          isPartial: false,
        },
      ],
      checksRun: [
        {
          id: 'verification-command-1',
          command: 'pnpm test',
          phase: 'postrun',
          mandatory: true,
          status: 'passed',
          exitCode: 0,
          durationMs: 100,
          summary: 'Verification command "pnpm test" passed.',
          stdoutArtifactPath: '/tmp/run-1/verification/commands/postrun-1.stdout.log',
          stderrArtifactPath: '/tmp/run-1/verification/commands/postrun-1.stderr.log',
          startedAt: '2026-03-16T20:04:00.000Z',
          completedAt: '2026-03-16T20:04:00.100Z',
          evidence: [],
        },
      ],
      artifactPaths: ['/tmp/run-1/run.json'],
      diffSummary: ['1 file(s) changed'],
      policy: {
        decision: 'allow',
        summary: 'Rule "docs-safe" matched "docs/example.md".',
        auditStatus: 'clean',
        auditSummary: 'Policy audit did not record any unexpected paths or commands after the run.',
        matchedRuleIds: ['docs-safe'],
      },
      approvals: {
        required: false,
        status: 'not_required',
        summary: 'The policy decision did not require a human approval step for this run.',
      },
      risks: ['Docs-only change.'],
      limitations: ['Fake runner only.'],
      openQuestions: ['Should the wording mention Phase 3?'],
      verification: {
        status: 'passed',
        summary: 'Verification passed and the run can be marked completed.',
        mandatoryFailures: [],
        lastVerifiedAt: '2026-03-16T20:05:00.000Z',
      },
      claimVerification: createClaimVerificationSummary(),
      rollbackHint:
        'Inspect diff.patch and revert the touched paths manually or with git restore if needed: docs/example.md',
      createdAt: '2026-03-16T20:05:00.000Z',
    });

    expect(markdown).toContain('## Objective');
    expect(markdown).toContain('## Tests / Checks Run');
    expect(markdown).toContain('## Policy Decisions');
    expect(markdown).toContain('## Approvals Required And Granted');
    expect(markdown).toContain('## Verification Summary');
    expect(markdown).toContain('## Claim Verification Summary');
    expect(markdown).toContain('## Rollback / Revert Hint');
  });
});
