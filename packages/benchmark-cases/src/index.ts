export const benchmarkSuiteValues = ['smoke', 'fresh', 'longhorizon'] as const;

export type BenchmarkSuite = (typeof benchmarkSuiteValues)[number];

export interface BenchmarkCase {
  id: string;
  suite: BenchmarkSuite;
  title: string;
  inputSpecPath: string;
  repoFixturePath?: string;
  successCriteria: string[];
  allowedPolicies: string[];
}

export const phaseZeroBenchmarkCases: BenchmarkCase[] = [
  {
    id: 'phase0-readme-bootstrap',
    suite: 'smoke',
    title: 'Validate the repository bootstrap documentation surface.',
    inputSpecPath: 'benchmarks/smoke/README.md',
    successCriteria: [
      'Workspace installs cleanly.',
      'README explains Phase 0 and next steps.',
      'Validation commands are discoverable.',
    ],
    allowedPolicies: ['default'],
  },
];
