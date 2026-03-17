# AGENTS.md

## Project Mission
Build a Codex-first governed execution layer for agentic software delivery. This repository is the control plane above a coding agent: it plans, governs, verifies, documents, and later packages work for human review.

## Current Phase Scope
- Phase 3 is the active implementation boundary for this repo.
- The local `gdh run <spec-file>` flow now covers spec normalization, planning, impact preview, YAML policy evaluation, approval gating, write-capable execution, deterministic verification, artifact persistence, evidence-based review packet generation, and lightweight post-run policy audit.
- The local `gdh verify <run-id>` flow re-loads an existing run, re-executes configured verification commands, re-runs deterministic verification, persists a fresh verification result, and regenerates the review packet.
- Policy packs live under `policies/` and drive allow / prompt / forbid decisions for paths, commands, task classes, and risk hints.
- Verification commands live in repo-local config under `gdh.config.json`.
- Approvals are still session-local inside `gdh run`; there is no durable approval queue or resume flow yet.
- GitHub draft PR side effects, durable resume, benchmark suites, regression gating, and multi-agent orchestration are still out of scope until later phases.

## Repository Layout
- `apps/cli`: governed CLI contract for `gdh run`, `gdh verify`, and later workflow commands
- `apps/api`: Fastify HTTP surface for local inspection endpoints
- `apps/web`: React + Vite internal dashboard scaffold
- `packages/domain`: canonical domain types, enums, schemas, and shared DTOs
- `packages/shared`: shared constants and helper utilities used across the workspace
- `packages/runner-codex`: Codex runner interfaces and bootstrap defaults
- `packages/policy-engine`: policy DSL scaffolding, decision types, approval boundaries, and post-run audit helpers
- `packages/artifact-store`: file-backed artifact persistence plus future SQLite bootstrap surface
- `packages/verification`: deterministic verification engine, config loading, and claim / completeness checks
- `packages/review-packets`: evidence-based review packet generation and Markdown rendering
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
- Keep policy evaluation deterministic and artifact-backed; do not hide the guardrail logic inside ad hoc CLI branches.
- Treat impact preview as predictive evidence and post-run policy audit as observed evidence; do not overstate either one.
- Treat review packet content as evidence-backed output, not freeform narration.
- Verify changes locally before claiming completion.

## Approval Boundaries
- Do not read or modify secrets, `.env` files, credential stores, or production deployment material.
- Treat auth, permissions, billing, migrations, release automation, and infrastructure as protected zones even before the policy engine is implemented.
- Do not add real GitHub write side effects in Phase 3.
- Keep network access optional and off by default in documentation and configuration.
- Do not bypass the repo policy pack with broader Codex approval settings; the governed tool should make the main allow / prompt / forbid decision.

## Definition Of Done
- The repo installs on a clean machine with `pnpm bootstrap`.
- Root `lint`, `typecheck`, `test`, and `build` scripts are wired and pass.
- `gdh run <spec-file>` performs policy evaluation before write-capable execution and persists inspectable policy artifacts.
- Executed runs enter `verifying` and cannot reach `completed` without a persisted passing `VerificationResult`.
- `gdh verify <run-id>` works against an existing run and exits non-zero on mandatory verification failure.
- Review packets include verification and claim-check summaries and avoid unsupported certainty claims.
- Protected work is correctly allowed, prompted, or forbidden by version-controlled policy packs.
- Interactive approval works in the CLI, and non-interactive prompting leaves a durable pending-approval artifact state.
- Placeholder apps and packages stay honest about what later phases still need instead of pretending the roadmap is complete.

## Testing Expectations
- Add or update tests when source behavior changes, even for placeholders.
- Keep Phase 3 tests lightweight and deterministic.
- Never claim a command passed unless it was actually run in this repo.
- Policy DSL, approval flow, post-run audit behavior, deterministic verification, claim checking, and packet completeness should remain testable without live Codex access.
