# PLANS.md

## Objective
Bootstrap the repository for a Codex-first governed agentic delivery control plane by completing only Phase 0 from `codex_governed_delivery_handoff_spec.md`.

## Constraints
- Stay within Phase 0 boundaries.
- Follow the handoff document as the source of truth for architecture, layout, stack, and operating conventions.
- Use Node.js 20+, TypeScript, pnpm workspaces, and Turborepo.
- Prefer the Codex CLI bootstrap path and leave real run-loop behavior for Phase 1.
- Keep implementations minimal, compilable, and internally consistent.

## Milestones
1. Capture the Phase 0 plan and live audit baseline for this bootstrap session.
2. Scaffold the monorepo structure, shared configs, and root automation surfaces.
3. Add minimal app and package stubs for the required Phase 0 layout.
4. Add Codex-facing docs, baseline policies/prompts, and local project config.
5. Install dependencies, run validation, and fix any bootstrap gaps.
6. Finalize contributor documentation and record assumptions for Phase 1 handoff.

## Acceptance Criteria
- Root workspace files exist and align with the handoff.
- Required apps, packages, and support directories are present with valid manifests and minimal source entrypoints.
- Root `build`, `lint`, `typecheck`, `test`, and bootstrap/install workflows run from the workspace root.
- `AGENTS.md`, `PLANS.md`, `implement.md`, `documentation.md`, `README.md`, and `.codex/config.toml` are present and aligned with the handoff.
- A minimal CI workflow runs lint, typecheck, and tests.
- The repository is ready for Phase 1 local end-to-end run-loop implementation.

## Risks
- Tooling drift between package scripts, TypeScript project references, and Turbo task expectations.
- Over-implementing future phases instead of keeping to Phase 0 scaffolding and interfaces.
- Missing baseline files for Playwright, Vitest, or Biome could break first-run validation on a clean machine.

## Verification Plan
- `pnpm install`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

## Rollback / Fallback
- Keep the bootstrap additive and modular so any unstable package can be reduced to a placeholder entrypoint without disturbing the workspace.
- Document any unavoidable validation gaps in `documentation.md` and `README.md` instead of papering over them.

## Notes
- If a tooling choice is under-specified by the handoff, prefer the smallest working option and record it in `docs/decisions/`.
