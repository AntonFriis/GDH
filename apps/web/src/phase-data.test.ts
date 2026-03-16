import { describe, expect, it } from 'vitest';
import { nextPhaseLabel, operatingArtifacts, phaseZeroCards } from './phase-data';

describe('phase data', () => {
  it('captures the current phase and next step', () => {
    expect(phaseZeroCards).toHaveLength(3);
    expect(operatingArtifacts).toContain('documentation.md');
    expect(nextPhaseLabel).toBe('Phase 1 - Local end-to-end run loop');
  });
});
