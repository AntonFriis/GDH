import { describe, expect, it } from 'vitest';
import { createPlanFromSpec, normalizeMarkdownSpec } from '../src/index';

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
