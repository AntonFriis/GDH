export const phaseZeroCards = [
  {
    title: 'Workspace bootstrap',
    body: 'pnpm workspaces, Turborepo, TypeScript, and shared validation commands are wired.',
  },
  {
    title: 'Codex operating surface',
    body: 'AGENTS.md, PLANS.md, implement.md, documentation.md, and .codex/config.toml are committed.',
  },
  {
    title: 'Phase 1 ready',
    body: 'The repo now has package boundaries and honest placeholders for the local governed run loop.',
  },
] as const;

export const operatingArtifacts = [
  'AGENTS.md',
  'PLANS.md',
  'implement.md',
  'documentation.md',
  '.codex/config.toml',
] as const;

export const nextPhaseLabel = 'Phase 1 - Local end-to-end run loop';
