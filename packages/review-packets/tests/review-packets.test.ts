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
    expect(packet.limitations).toContain('Automated verification was not run in Phase 1.');
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
      limitations: ['Automated verification was not run in Phase 1.'],
      openQuestions: ['Should the wording mention Phase 2?'],
      verificationStatus: 'not_run',
      createdAt: '2026-03-16T20:05:00.000Z',
    });

    expect(markdown).toContain('## Changed Files');
    expect(markdown).toContain('## Commands Executed');
    expect(markdown).toContain('Verification status: not_run');
  });
});
