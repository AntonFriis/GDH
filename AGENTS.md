# AGENTS.md

## Project Mission
Build a Codex-first governed execution layer for agentic software delivery. This repository is the control plane above a coding agent: it plans, governs, verifies, documents, and later packages work for human review.

## Phase 0 Scope
- Monorepo bootstrap and workspace tooling
- Codex operating docs and local repo conventions
- Minimal compileable placeholders for required apps and packages
- Baseline policies, prompts, benchmark directories, and CI wiring
- No real run loop, GitHub side effects, multi-agent orchestration, or policy enforcement logic yet

## Repository Layout
- `apps/cli`: local CLI contract and Phase 0 placeholder commands
- `apps/api`: Fastify HTTP surface for local inspection endpoints
- `apps/web`: React + Vite internal dashboard scaffold
- `packages/domain`: canonical domain types, enums, schemas, and shared DTOs
- `packages/shared`: shared constants and helper utilities used across the workspace
- `packages/runner-codex`: Codex runner interfaces and bootstrap defaults
- `packages/policy-engine`: policy DSL scaffolding, decision types, and approval boundaries
- `packages/artifact-store`: SQLite + Drizzle bootstrap surface and persistence interfaces
- `packages/verification`: verification contracts and default command sets
- `packages/review-packets`: review packet contracts and packet section scaffolding
- `packages/github-adapter`: GitHub adapter interfaces and no-op boundary
- `packages/evals`: benchmark case and grader contracts
- `packages/prompts`: prompt template metadata
- `packages/benchmark-cases`: benchmark suite metadata for the local repo
- `benchmarks/`: benchmark suites and fixture placeholders
- `policies/`: version-controlled policy packs and examples
- `prompts/`: human-readable prompt templates
- `runs/`: local run artifacts and reusable fixtures
- `reports/`: generated reports
- `docs/`: architecture, decisions, references, and demos

## Commands
- `pnpm bootstrap`: install dependencies and prepare tracked local directories
- `pnpm lint`: run Biome across the repo and workspace packages
- `pnpm typecheck`: run TypeScript checks through Turborepo
- `pnpm test`: run workspace Vitest suites
- `pnpm build`: build all apps and packages
- `pnpm test:e2e`: run Playwright placeholders when needed
- `pnpm validate`: run the default local validation flow

## Working Rules For Codex
- Read `codex_governed_delivery_handoff_spec.md` before making architecture changes.
- Plan before any non-trivial implementation work.
- Refresh `PLANS.md` when scope, milestones, or risks change materially.
- Update `documentation.md` after each meaningful milestone, decision, blocker, or verification run.
- Keep diffs minimal and stay inside the current phase unless a tiny stub is required to keep the repo coherent.
- Prefer explicit interfaces and placeholder behavior over speculative implementation.
- Verify changes locally before claiming completion.

## Approval Boundaries
- Do not read or modify secrets, `.env` files, credential stores, or production deployment material.
- Treat auth, permissions, billing, migrations, release automation, and infrastructure as protected zones even before the policy engine is implemented.
- Do not add real GitHub write side effects in Phase 0.
- Keep network access optional and off by default in documentation and configuration.

## Definition Of Done
- The repo installs on a clean machine with `pnpm bootstrap`.
- Root `lint`, `typecheck`, `test`, and `build` scripts are wired and pass.
- All required Phase 0 docs and directories exist and reflect the handoff.
- Placeholder apps and packages compile cleanly and point to Phase 1 rather than pretending later phases are complete.

## Testing Expectations
- Add or update tests when source behavior changes, even for placeholders.
- Keep Phase 0 tests lightweight and deterministic.
- Never claim a command passed unless it was actually run in this repo.
