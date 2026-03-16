# documentation.md

## Active run
- Run ID: phase1-local-run-loop-2026-03-16
- Objective: Implement Phase 1 only: a local end-to-end `cp run <spec-file>` flow with durable artifacts, structured events, changed-file capture, command capture, and a conservative review packet.
- Status: Completed

## Progress log
- 2026-03-16 22:05 CET — Re-read `codex_governed_delivery_handoff_spec.md`, `AGENTS.md`, `PLANS.md`, `implement.md`, `documentation.md`, and `README.md` before editing to align the session with the repo’s authoritative sources and working rules.
- 2026-03-16 22:05 CET — Inspected the Phase 0 repository tree, placeholder CLI/domain/runner/storage/review packages, local Codex config, prompts, and policies to anchor the Phase 1 design in the existing package seams.
- 2026-03-16 22:05 CET — Confirmed the installed Codex CLI non-interactive surface (`codex exec`) and the Phase 1 implementation constraints: local file-backed artifacts now, no real approvals or GitHub side effects yet, and an interface that remains ready for a future SDK runner.
- 2026-03-16 22:05 CET — Refreshed `PLANS.md` for the Phase 1 execution milestones, acceptance criteria, risks, and validation plan before code changes.
- 2026-03-16 22:18 CET — Replaced the Phase 0 placeholder domain contracts with real Phase 1 types and factories for normalized specs, plans, runs, events, command capture, changed-file capture, runner IO, review packets, and verification placeholders.
- 2026-03-16 22:21 CET — Implemented the file-backed artifact store under `runs/local/<run-id>/`, plus append-only JSONL events, before/after workspace snapshots, changed-file capture, and diff patch generation.
- 2026-03-16 22:23 CET — Implemented the Phase 1 runner layer: `CodexCliRunner` shells out to `codex exec` with an output schema and raw log capture, and `FakeRunner` provides deterministic CI-safe execution for tests and smoke runs.
- 2026-03-16 22:25 CET — Wired `cp run <spec-file>` end to end in `apps/cli`, including spec validation, normalization, plan generation, run creation, event emission, artifact persistence, changed-file capture, command capture, review packet generation, and terminal summaries.
- 2026-03-16 22:28 CET — Added unit coverage for spec normalization, plan generation, artifact storage, and review packet generation, plus an integration-style CLI test for `cp run` with the deterministic fake runner.
- 2026-03-16 22:34 CET — Updated `README.md` to document the real Phase 1 capabilities, smoke paths, artifact layout, limitations, and Phase 2 guardrail work.
- 2026-03-16 22:34 CET — Ran a real local smoke invocation in this repo with the deterministic runner: `node apps/cli/dist/index.js run runs/fixtures/phase1-smoke-spec.md --runner fake --json`.
- 2026-03-16 22:34 CET — Verified the full root validation flow after the Phase 1 implementation: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm validate`.
- 2026-03-16 22:37 CET — Tightened the fake runner smoke artifact content so the generated file explicitly states that it is a Phase 1 smoke run and calls out the missing approvals, GitHub side effects, and full verification.
- 2026-03-16 22:37 CET — Re-ran the full root validation flow and a fresh local smoke invocation on the latest build after the final fake-runner update.
- 2026-03-16 21:25 CET — Read `codex_governed_delivery_handoff_spec.md` in full and extracted Phase 0 constraints, repository layout, stack, and exit criteria.
- 2026-03-16 21:25 CET — Inspected the repository state and confirmed the repo is a blank slate containing only the handoff specification.
- 2026-03-16 21:25 CET — Created the durable execution plan in `PLANS.md` and started the live audit log.
- 2026-03-16 21:31 CET — Scaffolded the monorepo layout, root configs, Codex operating docs, baseline policies, prompts, benchmark directories, and CI workflow.
- 2026-03-16 21:34 CET — Added placeholder app and package manifests, TypeScript configs, source entrypoints, tests, and project scripts aligned to Phase 0 boundaries.
- 2026-03-16 21:36 CET — Initialized the repository with `git init -b main` and installed the workspace dependencies with pnpm.
- 2026-03-16 21:38 CET — Migrated `biome.json` to the installed Biome 2 schema after the first lint run surfaced a configuration-version mismatch.
- 2026-03-16 21:40 CET — Localized `rootDir` and `outDir` per workspace package after the first typecheck run surfaced inherited root-path issues.
- 2026-03-16 21:43 CET — Verified the one-command bootstrap and full local validation flow: `pnpm bootstrap`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm validate`.

## Decisions
- Treat the handoff document as the authoritative source of truth for this bootstrap.
- Keep Phase 0 limited to workspace scaffolding, operating docs, compileable stubs, baseline policies/prompts, and validation tooling.
- Use `pnpm bootstrap` as the repo-level bootstrap entrypoint, with `tsx scripts/bootstrap.ts` providing the post-install setup message.
- Keep internal packages honest by exporting interfaces and placeholder behavior rather than simulating later-phase execution logic.
- Record the initial bootstrap tradeoffs in `docs/decisions/0001-phase-0-bootstrap.md`.
- Keep Phase 1 artifact persistence file-backed under `runs/` even though the repo already has SQLite scaffolding, because the handoff defers the SQLite-backed run store to a later durability phase.
- Treat Codex command capture as partial/self-reported unless the runner can observe commands directly from trustworthy execution output.
- Use git-tracked and non-ignored workspace snapshots instead of `git diff HEAD` to capture changed files so the run loop remains honest even if the repo starts dirty.
- Keep the fake runner deterministic but spec-aware enough to honor an explicitly named target file, so tests and smoke runs exercise the same artifact flow as the live CLI path.

## Verification
- Passed: `pnpm bootstrap`
- Passed: `pnpm lint`
- Passed: `pnpm typecheck`
- Passed: `pnpm test`
- Passed: `pnpm build`
- Passed: `pnpm validate`
- Passed: `node apps/cli/dist/index.js run runs/fixtures/phase1-smoke-spec.md --runner fake --json`

## Open issues
- No blocking Phase 0 issues remain.
- `better-sqlite3` is installed for the future SQLite artifact store, but its native build approval is still deferred because Phase 0 does not execute the real database layer yet.
- `CodexCliRunner` is implemented but the automated validation path still uses `FakeRunner`; a live `--runner codex-cli` run should be exercised manually when local Codex auth is available.
- Real policy evaluation, approval packets, blocked-run handling, and CLI approval actions remain Phase 2 work.
- Command capture from `CodexCliRunner` is still self-reported from the runner final response unless a later phase adds direct command observability.
