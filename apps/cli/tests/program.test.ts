import { describe, expect, it } from 'vitest';
import { createProgram } from '../src/index';

describe('createProgram', () => {
  it('registers the placeholder command surface', () => {
    const program = createProgram();

    expect(program.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining([
        'run',
        'resume',
        'approve',
        'verify',
        'report',
        'benchmark',
        'github',
      ]),
    );
  });
});
