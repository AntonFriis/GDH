import { describe, expect, it } from 'vitest';
import { createPlaceholderResolvedPolicy } from '../src/index';

describe('createPlaceholderResolvedPolicy', () => {
  it('returns the conservative phase zero defaults', () => {
    const decision = createPlaceholderResolvedPolicy();

    expect(decision.decision).toBe('allow');
    expect(decision.networkAccess).toBe(false);
    expect(decision.approvalPolicy).toBe('on-request');
  });
});
