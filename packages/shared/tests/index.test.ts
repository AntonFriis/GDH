import { describe, expect, it } from 'vitest';
import { hasUnsupportedCertaintyClaim } from '../src/index';

describe('hasUnsupportedCertaintyClaim', () => {
  it('flags explicit completeness claims', () => {
    expect(hasUnsupportedCertaintyClaim('The run is complete.')).toBe(true);
  });

  it('does not flag task objectives that use complete as a verb', () => {
    expect(
      hasUnsupportedCertaintyClaim(
        'Create a short docs note that proves the run can complete a low-risk docs task end to end.',
      ),
    ).toBe(false);
  });
});
