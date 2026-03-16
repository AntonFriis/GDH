# documentation.md

## Active run
- Run ID: phase2-policy-gating-2026-03-16
- Objective: Implement Phase 2 only: add policy evaluation, approval gating, impact previews, approval packets, and lightweight post-run policy audit to the local `gdh run <spec-file>` flow.
- Status: Completed

## Progress log
- 2026-03-16 23:36 CET — Verified the renamed CLI surface after the `gdh` migration: `pnpm --filter @gdh/cli test`, `pnpm --filter @gdh/cli build`, `pnpm gdh --help`, and `pnpm lint` all passed. Also confirmed that `pnpm exec gdh` still does not resolve from the source checkout because pnpm does not expose this workspace package’s own bin on PATH by default, so the local docs now recommend `pnpm gdh ...`.
- 2026-03-16 23:49 CET — The first manual Phase 2 smoke run surfaced a dirty-worktree bug in `captureWorkspaceSnapshot`: tracked files deleted in the working tree caused the pre-run snapshot to throw. Fixed the snapshot reader to skip missing tracked files, added regression coverage in `packages/artifact-store/tests/file-artifact-store.test.ts`, rebuilt the affected packages, and confirmed the smoke path afterward.
- 2026-03-16 23:50 CET — Ran a manual local Phase 2 smoke invocation after the final fixes: `node apps/cli/dist/index.js run runs/fixtures/phase2-policy-smoke-spec.md --runner fake --approval-mode fail --json`.
- 2026-03-16 23:51 CET — Re-ran the full root validation flow after the final artifact-store fix: `pnpm validate`.
- 2026-03-16 23:18 CET — Extended `packages/domain` with explicit Phase 2 policy, approval, impact-preview, and policy-audit schemas plus the new run fields and lifecycle events needed to persist governed decisions cleanly.
- 2026-03-16 23:24 CET — Replaced the placeholder `packages/policy-engine` with a real YAML-backed loader, deterministic impact-preview generator, matcher precedence evaluator, approval-packet renderer, and lightweight post-run policy-audit helper.
- 2026-03-16 23:30 CET — Integrated Phase 2 gating into `apps/cli`: `gdh run` now loads a policy pack, creates `impact-preview.json`, evaluates policy, handles interactive and non-interactive approval modes, persists approval artifacts, and records post-run policy audit evidence before the review packet.
- 2026-03-16 23:33 CET — Renamed the CLI binary and command surface from `cp` to `gdh` to avoid colliding with the system copy command, then updated the Phase 2 operating docs, handoff spec, smoke fixtures, and CLI program test to match the new invocation.
- 2026-03-16 23:35 CET — Updated `packages/review-packets`, `packages/runner-codex`, shared phase metadata, seeded new policy packs and smoke fixtures, and added a Phase 2 architecture decision note in `docs/decisions/0002-phase-2-policy-gating.md`.
- 2026-03-16 23:39 CET — Added CI-safe unit and integration coverage for policy DSL parsing, matcher precedence, approval packets, policy audit, and the gated `gdh run` flow across allow, prompt/approve, prompt/deny, forbid, and pending-approval cases.
- 2026-03-16 23:05 CET — Re-read `codex_governed_delivery_handoff_spec.md`, `AGENTS.md`, `PLANS.md`, `implement.md`, `documentation.md`, and `README.md` before editing so the Phase 2 implementation starts from the repo’s authoritative sources and current operating rules.
- 2026-03-16 23:07 CET — Inspected the Phase 1 repository tree, current `apps/cli` run loop, `packages/domain`, `packages/policy-engine`, `packages/runner-codex`, `packages/artifact-store`, existing policy files, and CLI/tests to anchor Phase 2 on the current seams instead of replacing them.
- 2026-03-16 23:12 CET — Refreshed `PLANS.md` for the Phase 2 session with the new milestones, acceptance criteria, risks, verification plan, and explicit boundary that approvals remain session-local without resume or GitHub side effects.
- 2026-03-16 22:05 CET — Re-read `codex_governed_delivery_handoff_spec.md`, `AGENTS.md`, `PLANS.md`, `implement.md`, `documentation.md`, and `README.md` before editing to align the session with the repo’s authoritative sources and working rules.
- 2026-03-16 22:05 CET — Inspected the Phase 0 repository tree, placeholder CLI/domain/runner/storage/review packages, local Codex config, prompts, and policies to anchor the Phase 1 design in the existing package seams.
- 2026-03-16 22:05 CET — Confirmed the installed Codex CLI non-interactive surface (`codex exec`) and the Phase 1 implementation constraints: local file-backed artifacts now, no real approvals or GitHub side effects yet, and an interface that remains ready for a future SDK runner.
- 2026-03-16 22:05 CET — Refreshed `PLANS.md` for the Phase 1 execution milestones, acceptance criteria, risks, and validation plan before code changes.
- 2026-03-16 22:18 CET — Replaced the Phase 0 placeholder domain contracts with real Phase 1 types and factories for normalized specs, plans, runs, events, command capture, changed-file capture, runner IO, review packets, and verification placeholders.
- 2026-03-16 22:21 CET — Implemented the file-backed artifact store under `runs/local/<run-id>/`, plus append-only JSONL events, before/after workspace snapshots, changed-file capture, and diff patch generation.
- 2026-03-16 22:23 CET — Implemented the Phase 1 runner layer: `CodexCliRunner` shells out to `codex exec` with an output schema and raw log capture, and `FakeRunner` provides deterministic CI-safe execution for tests and smoke runs.
- 2026-03-16 22:25 CET — Wired `gdh run <spec-file>` end to end in `apps/cli`, including spec validation, normalization, plan generation, run creation, event emission, artifact persistence, changed-file capture, command capture, review packet generation, and terminal summaries.
- 2026-03-16 22:28 CET — Added unit coverage for spec normalization, plan generation, artifact storage, and review packet generation, plus an integration-style CLI test for `gdh run` with the deterministic fake runner.
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
- Keep Phase 2 approvals session-local inside `gdh run` and persist the approval artifacts/resolution, while explicitly deferring a durable approval queue or resume flow to a later phase.
- Treat impact preview as a predictive artifact with uncertainty notes, then layer a lightweight post-run policy audit on top of actual workspace evidence rather than overstating the preview as enforcement proof.
- Use YAML policy packs plus deterministic heuristic preview generation in Phase 2 instead of a live preview-only Codex round, so CI coverage and offline inspectability remain first-class.

## Verification
- Passed: `pnpm bootstrap`
- Passed: `pnpm gdh --help`
- Passed: `pnpm lint`
- Passed: `pnpm typecheck`
- Passed: `pnpm test`
- Passed: `pnpm build`
- Passed: `pnpm --filter @gdh/cli test`
- Passed: `pnpm --filter @gdh/cli build`
- Passed: `pnpm validate`
- Passed: `node apps/cli/dist/index.js run runs/fixtures/phase1-smoke-spec.md --runner fake --json`
- Passed: `node apps/cli/dist/index.js run runs/fixtures/phase2-policy-smoke-spec.md --runner fake --approval-mode fail --json`

## Open issues
- No blocking Phase 0 issues remain.
- `better-sqlite3` is installed for the future SQLite artifact store, but its native build approval is still deferred because Phase 0 does not execute the real database layer yet.
- `CodexCliRunner` is implemented but the automated validation path still uses `FakeRunner`; a live `--runner codex-cli` run should be exercised manually when local Codex auth is available.
- Phase 2 implementation is complete for the local governed run loop, but approval remains session-local and there is still no resume flow or durable approval queue.
- Command capture from `CodexCliRunner` is still self-reported from the runner final response unless a later phase adds direct command observability.
- Impact preview is still heuristic; Phase 3 should add stronger verification and claim-checking before the system makes stronger completion claims.
