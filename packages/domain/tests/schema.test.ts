import { describe, expect, it } from 'vitest';
import {
  BenchmarkRunSchema,
  createPlanFromSpec,
  normalizeGithubIssueSpec,
  normalizeMarkdownSpec,
} from '../src/index';

describe('normalizeMarkdownSpec', () => {
  it('normalizes a markdown spec with frontmatter and sections', () => {
    const spec = normalizeMarkdownSpec({
      content: [
        '---',
        'title: Phase 1 Smoke',
        'task_type: docs',
        'constraints:',
        '  - Stay in Phase 1.',
        'acceptance_criteria:',
        '  - Update the smoke output file.',
        'risk_hints: [Keep it docs-only.]',
        '---',
        '',
        '# Phase 1 Smoke',
        '',
        '## Summary',
        'Create a tiny docs-only change.',
        '',
        '## Objective',
        'Update the smoke output file with a short note.',
      ].join('\n'),
      repoRoot: '/tmp/gdh',
      sourcePath: '/tmp/gdh/runs/fixtures/phase1-smoke-spec.md',
      createdAt: '2026-03-16T20:00:00.000Z',
    });

    expect(spec.title).toBe('Phase 1 Smoke');
    expect(spec.summary).toBe('Create a tiny docs-only change.');
    expect(spec.objective).toBe('Update the smoke output file with a short note.');
    expect(spec.taskClass).toBe('docs');
    expect(spec.constraints).toContain('Stay in Phase 1.');
    expect(spec.acceptanceCriteria).toContain('Update the smoke output file.');
    expect(spec.riskHints).toContain('Keep it docs-only.');
  });

  it('records inferred fields when the markdown is partial', () => {
    const spec = normalizeMarkdownSpec({
      content: '# Write docs\n\nAdd a short project note.',
      repoRoot: '/tmp/gdh',
      sourcePath: '/tmp/gdh/spec.md',
      createdAt: '2026-03-16T20:00:00.000Z',
    });

    expect(spec.inferredFields).toContain('taskClass');
    expect(spec.taskClass).toBe('docs');
  });
});

describe('createPlanFromSpec', () => {
  it('creates a deterministic three-step Phase 1 plan', () => {
    const spec = normalizeMarkdownSpec({
      content: [
        '# Add Docs',
        '',
        '## Objective',
        'Refresh a docs page.',
        '',
        '## Acceptance Criteria',
        '- The docs page is updated.',
      ].join('\n'),
      repoRoot: '/tmp/gdh',
      sourcePath: '/tmp/gdh/spec.md',
      createdAt: '2026-03-16T20:00:00.000Z',
    });

    const plan = createPlanFromSpec(spec, '2026-03-16T20:05:00.000Z');

    expect(plan.taskUnits).toHaveLength(3);
    expect(plan.taskUnits[0]?.suggestedMode).toBe('read_only');
    expect(plan.taskUnits[1]?.suggestedMode).toBe('workspace_write');
    expect(plan.doneConditions).toEqual(['The docs page is updated.']);
  });
});

describe('normalizeGithubIssueSpec', () => {
  it('normalizes a GitHub issue into a traceable governed Spec', () => {
    const spec = normalizeGithubIssueSpec({
      issue: {
        repo: {
          owner: 'acme',
          repo: 'gdh',
          fullName: 'acme/gdh',
          url: 'https://github.com/acme/gdh',
          defaultBranch: 'main',
        },
        issueNumber: 42,
        title: 'Refresh the docs smoke output',
        body: [
          '## Summary',
          'Keep the smoke docs output aligned with the latest governed flow.',
          '',
          '## Acceptance Criteria',
          '- The docs smoke output reflects the latest phase.',
          '',
          '## Constraints',
          '- Keep the change docs-only.',
        ].join('\n'),
        labels: ['docs', 'phase-5'],
        url: 'https://github.com/acme/gdh/issues/42',
        state: 'open',
      },
      repoRoot: '/tmp/gdh',
      sourcePath: '/tmp/gdh/runs/local/run-1/github/issue.source.md',
      createdAt: '2026-03-17T10:00:00.000Z',
    });

    expect(spec.source).toBe('github_issue');
    expect(spec.githubIssue?.issueNumber).toBe(42);
    expect(spec.taskClass).toBe('docs');
    expect(spec.summary).toContain('smoke docs output');
    expect(spec.acceptanceCriteria).toContain('The docs smoke output reflects the latest phase.');
    expect(spec.constraints).toContain('Keep the change docs-only.');
    expect(spec.normalizationNotes[0]).toContain('GitHub issue acme/gdh#42');
  });
});

describe('BenchmarkRunSchema', () => {
  it('accepts a minimal benchmark run snapshot with explicit scores and case results', () => {
    const parsed = BenchmarkRunSchema.parse({
      id: 'benchmark-smoke',
      status: 'completed',
      target: {
        kind: 'suite',
        id: 'smoke',
      },
      suiteId: 'smoke',
      caseIds: ['smoke-success'],
      mode: 'ci_safe',
      repoRoot: '/tmp/gdh',
      runDirectory: '/tmp/gdh/runs/benchmarks/benchmark-smoke',
      configuration: {
        ciSafe: true,
        targetId: 'smoke',
        targetKind: 'suite',
        suiteId: 'smoke',
        thresholdPolicy: {
          maxOverallScoreDrop: 0,
          requiredMetrics: ['success'],
          failOnNewlyFailingCases: true,
        },
      },
      score: {
        totalWeight: 1,
        earnedWeight: 1,
        normalizedScore: 1,
        passedMetrics: 1,
        failedMetrics: 0,
        metrics: [
          {
            name: 'success',
            title: 'Success / Failure',
            description: 'Checks benchmark success.',
            weight: 1,
            score: 1,
            passed: true,
            summary: 'Passed.',
            evidence: [],
          },
        ],
        summary: 'All metrics passed.',
      },
      caseResults: [
        {
          id: 'benchmark-smoke:smoke-success',
          benchmarkRunId: 'benchmark-smoke',
          caseId: 'smoke-success',
          title: 'Smoke success',
          suiteIds: ['smoke'],
          status: 'passed',
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
            runStatus: 'completed',
            artifactPaths: ['review-packet.json'],
          },
          score: {
            totalWeight: 1,
            earnedWeight: 1,
            normalizedScore: 1,
            passedMetrics: 1,
            failedMetrics: 0,
            metrics: [
              {
                name: 'success',
                title: 'Success / Failure',
                description: 'Checks benchmark success.',
                weight: 1,
                score: 1,
                passed: true,
                summary: 'Passed.',
                evidence: [],
              },
            ],
            summary: 'All metrics passed.',
          },
          failureReasons: [],
          notes: ['Passed.'],
        },
      ],
      startedAt: '2026-03-17T12:00:00.000Z',
      completedAt: '2026-03-17T12:00:01.000Z',
      summary: 'Benchmark complete.',
    });

    expect(parsed.score.normalizedScore).toBe(1);
    expect(parsed.caseResults[0]?.status).toBe('passed');
  });
});
