import { describe, expect, it } from 'vitest';
import { SpecSchema } from '../src/index';

describe('SpecSchema', () => {
  it('parses a bootstrap-ready spec', () => {
    const result = SpecSchema.parse({
      id: 'spec-1',
      source: 'manual',
      title: 'Bootstrap the workspace',
      body: 'Create the Phase 0 monorepo layout.',
      repoRoot: '/tmp/gdh',
      taskClass: 'docs',
      riskHints: [],
      acceptanceCriteria: ['Workspace installs cleanly.'],
      constraints: ['Stay in Phase 0.'],
      createdAt: '2026-03-16T20:00:00.000Z',
    });

    expect(result.taskClass).toBe('docs');
  });
});
