# AGENTS.md

## Project Mission
Build a Codex-first governed execution layer for agentic software delivery. This repository is the control plane above a coding agent: it plans, governs, verifies, preserves continuity, and later packages work for human review.

## Current Phase Scope
- Phase 5 is the active implementation boundary for this repo.
- The local `gdh run <spec-file>` and `gdh run --github-issue <owner/repo#123>` flows now cover spec normalization, GitHub issue ingestion, planning, impact preview, YAML policy evaluation, approval gating, write-capable execution, deterministic verification, artifact persistence, durable session manifests, checkpoints, progress snapshots, and lightweight post-run continuity state.
- The local `gdh status <run-id>` flow re-loads durable artifacts only, summarizes the current run state, reports resume eligibility, and does not require live Codex access.
- The local `gdh resume <run-id>` flow re-loads an interrupted or approval-paused run, performs continuity checks, evaluates deterministic resume eligibility, and continues from the next safe stage without bypassing policy, approval, or verification rules.
- The local `gdh verify <run-id>` flow re-loads an existing run, re-executes configured verification commands, re-runs deterministic verification, persists a fresh verification result, and regenerates the review packet.
- The local `gdh pr create <run-id>` flow prepares or reuses a conservative branch, stages and commits the captured run changes, pushes the branch, creates a draft PR only, and persists the GitHub request/result artifacts back into the run.
- The local `gdh pr sync-packet <run-id>` flow updates the PR body from the current review packet and can publish a supplemental PR comment.
- The local `gdh pr comments <run-id>` and `gdh pr iterate <run-id>` flows fetch PR comments in a local-operator path, detect explicit `/gdh iterate` requests, and materialize follow-up input artifacts without background polling.
- Policy packs live under `policies/` and drive allow / prompt / forbid decisions for paths, commands, task classes, and risk hints.
- Verification commands and GitHub delivery defaults live in repo-local config under `gdh.config.json`.
- The artifact store remains local and file-backed in Phase 5. GitHub is a delivery surface on top of those inspectable artifacts, not a replacement control plane.
- Merge automation, deploy hooks, benchmark suites, regression gating, dashboard work, analytics, and multi-agent orchestration are still out of scope until later phases.

## Repository Layout
- `apps/cli`: governed CLI contract for `gdh run`, `gdh status`, `gdh resume`, `gdh verify`, and later workflow commands
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
- Treat resume behavior as continuity infrastructure, not as permission to bypass earlier guardrails.
- Treat GitHub publication as a conservative packaging step after verification, not as a shortcut around policy or approval.
- Verify changes locally before claiming completion.

## Approval Boundaries
- Do not read or modify secrets, `.env` files, credential stores, or production deployment material.
- Treat auth, permissions, billing, migrations, release automation, and infrastructure as protected zones even before the policy engine is fully mature.
- Keep GitHub side effects limited to issue reads, branch preparation, draft PR creation, PR body/comment publication, and explicit PR comment reads required for the local iteration flow.
- Do not add merge automation, deploy hooks, branch deletion, force-push automation, or background webhook/polling services in Phase 5.
- Keep network access optional and off by default in documentation and configuration.
- Do not bypass the repo policy pack with broader Codex approval settings; the governed tool should make the main allow / prompt / forbid decision.

## Definition Of Done
- The repo installs on a clean machine with `pnpm bootstrap`.
- Root `lint`, `typecheck`, `test`, and `build` scripts are wired and pass.
- `gdh run <spec-file>` performs policy evaluation before write-capable execution, persists inspectable policy artifacts, and maintains a durable session manifest, progress snapshot, and checkpoint trail.
- `gdh run --github-issue <owner/repo#123>` can ingest a GitHub issue into a normalized `Spec` and persist the source linkage in the run artifacts.
- Executed runs enter `verifying` and cannot reach `completed` without a persisted passing `VerificationResult`.
- Interrupted or approval-paused runs can be inspected with `gdh status <run-id>`.
- Eligible paused or interrupted runs can be continued with `gdh resume <run-id>`.
- Resume preserves policy, approval, and verification guarantees instead of creating a fresh unguided run.
- Verified eligible runs can create a draft PR only, publish the review packet onto the PR surface, and persist the GitHub metadata back into the run artifacts.
- Explicit `/gdh iterate` PR comments can be fetched locally and normalized into follow-up input artifacts.
- Placeholder apps and packages stay honest about what later phases still need instead of pretending the roadmap is complete.

## Testing Expectations
- Add or update tests when source behavior changes, even for placeholders.
- Keep Phase 5 tests lightweight and deterministic.
- Never claim a command passed unless it was actually run in this repo.
- Policy DSL, approval flow, post-run audit behavior, deterministic verification, checkpoint persistence, continuity checks, resume eligibility, GitHub issue normalization, PR publication eligibility, and PR comment iteration parsing should remain testable without live GitHub or live Codex access.
