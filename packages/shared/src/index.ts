export const phaseZeroMetadata = {
  project: 'Governed Delivery Control Plane',
  phase: '0',
  focus: 'Repository bootstrap and Codex operating surface',
  nextPhase: 'Phase 1 - Local end-to-end run loop',
} as const;

export const requiredPhaseZeroPaths = [
  'apps/cli',
  'apps/api',
  'apps/web',
  'packages/domain',
  'packages/runner-codex',
  'packages/policy-engine',
  'packages/artifact-store',
  'packages/verification',
  'packages/review-packets',
  'packages/github-adapter',
  'packages/evals',
  'packages/prompts',
  'packages/benchmark-cases',
  'policies',
  'prompts',
  'runs',
  'reports',
  'docs',
  '.codex/config.toml',
] as const;

export function createIsoTimestamp(date = new Date()): string {
  return date.toISOString();
}
