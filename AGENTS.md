# AGENTS.md

## Project Mission
Build a Codex-first governed execution layer for agentic software delivery. This repository is the control plane above a coding agent: it plans, governs, verifies, preserves continuity, packages work for careful review, and now presents itself as a credible release candidate for local use and demonstration.

## Current Phase Scope
- Phase 8 is the active implementation boundary for this repo.
- Phase 1-7 behavior remains in scope as already-implemented product surface: governed runs, policy evaluation, approval gating, deterministic verification, durable manifests and checkpoints, GitHub draft-PR delivery, benchmark execution/comparison/regression gating, and the local dashboard.
- Phase 8 adds release hardening only: install and bootstrap polish, release-candidate scripts, local packaging, demo assets, conservative defaults, security/operational notes, architecture summaries, benchmark reporting, and final docs cleanup.
- The artifact store remains local and file-backed. GitHub is still a delivery surface layered on top of inspectable local artifacts, not a replacement control plane.
- Merge automation, deploy hooks, hosted eval platforms, multi-agent orchestration, background workers, and broad self-optimization loops remain out of scope.

## Repository Layout
- `apps/cli`: governed CLI contract for run, status, resume, verify, PR, and benchmark flows
- `apps/api`: Fastify HTTP surface for local inspection endpoints
- `apps/web`: React + Vite local dashboard for overview, runs, approvals, benchmarks, and failure taxonomy
- `packages/domain`: canonical domain types, enums, schemas, and shared DTOs
- `packages/shared`: shared constants, repo utilities, and environment helpers
- `packages/runner-codex`: Codex runner interfaces and bootstrap defaults
- `packages/policy-engine`: policy DSL parsing, impact preview, decisions, approvals, and audit helpers
- `packages/artifact-store`: file-backed artifact persistence plus dashboard read-model aggregation
- `packages/verification`: deterministic verification engine and config loading
- `packages/review-packets`: evidence-based review packet generation and Markdown rendering
- `packages/github-adapter`: GitHub adapter interfaces and thin delivery boundary
- `packages/evals`: benchmark runner, scoring, comparison, and regression gating
- `packages/prompts`: prompt template metadata
- `packages/benchmark-cases`: benchmark suite and case loading for repo-local artifacts
- `benchmarks/`: benchmark suites, accepted cases, fresh-task intake artifacts, baselines, fixture repos, and specs
- `policies/`: version-controlled policy packs and examples
- `prompts/`: human-readable prompt templates
- `runs/`: local run artifacts plus reusable fixtures
- `reports/`: generated release/demo reports
- `docs/`: architecture, decisions, benchmark notes, references, and demo walkthroughs

## Commands
- `pnpm bootstrap`: install dependencies with the lockfile and prepare tracked local directories
- `pnpm lint`: run Biome across the repo and workspace packages
- `pnpm typecheck`: run TypeScript checks through Turborepo
- `pnpm test`: run workspace Vitest suites
- `pnpm build`: build all apps and packages
- `pnpm benchmark:smoke`: run the deterministic smoke benchmark suite with baseline regression gating
- `pnpm validate`: run lint, typecheck, test, and build
- `pnpm release:validate`: run the full release-candidate validation flow including the smoke benchmark
- `pnpm demo:prepare`: build the workspace, generate a demo governed run, and generate a smoke benchmark run
- `pnpm release:package`: create a versioned local source bundle plus release manifest under `reports/release/`
- `pnpm dashboard:dev`: run the local API and dashboard together
- `pnpm dev:api`: run the local API only
- `pnpm dev:web`: run the local dashboard only

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
- Treat benchmark metrics, comparisons, and regression results as inspectable evidence, not opaque grader output.
- Keep benchmark intake honest: preserve provenance, rejection reasons, simplification notes, and suite separation under `benchmarks/fresh/{candidates,cases,rejected}`.
- Do not promote fresh tasks into accepted cases unless the success criteria remain human-curated, reproducible, and free from current-model-output contamination.
- Treat release packaging as a local operator workflow, not a publish or deployment pipeline.
- Verify changes locally before claiming completion.

## Approval Boundaries
- Do not read or modify secrets, `.env` files, credential stores, or production deployment material.
- Treat auth, permissions, billing, migrations, release automation, and infrastructure as protected zones.
- Keep GitHub side effects limited to issue reads, branch preparation, draft PR creation, PR body/comment publication, and explicit PR comment reads required for the local iteration flow.
- Do not add merge automation, deploy hooks, branch deletion, force-push automation, or background webhook/polling services.
- Do not add hosted benchmark services, cloud eval dependencies, or flaky live-service requirements to the default validation path.
- Keep network access optional and off by default in documentation and configuration.
- Do not bypass the repo policy pack with broader Codex approval settings; the governed tool should make the main allow / prompt / forbid decision.

## Definition Of Done
- The repo installs on a clean machine with `pnpm bootstrap`.
- Root `lint`, `typecheck`, `test`, and `build` scripts pass.
- `pnpm release:validate` provides a clear release-candidate validation flow.
- `gdh run <spec-file>` still performs policy evaluation before write-capable execution, persists inspectable policy artifacts, and maintains a durable session manifest, progress snapshot, and checkpoint trail.
- `gdh run --github-issue <owner/repo#123>` still ingests a GitHub issue into a normalized `Spec` and persists source linkage in the run artifacts.
- Executed runs still enter `verifying` and cannot reach `completed` without a persisted passing `VerificationResult`.
- Interrupted or approval-paused runs remain inspectable with `gdh status <run-id>` and resumable through `gdh resume <run-id>` when eligible.
- Verified eligible runs can still create a draft PR only, publish the review packet onto the PR surface, and persist the GitHub metadata back into the run artifacts.
- Explicit `/gdh iterate` PR comments can still be fetched locally and normalized into follow-up input artifacts.
- Benchmark cases and suites remain definable as repo artifacts under `benchmarks/` without code changes.
- `gdh benchmark run`, `gdh benchmark compare`, and `gdh benchmark show` still work against persisted benchmark artifacts and deterministic fixture-backed governed runs.
- The local dashboard still reads only persisted artifacts and makes runs, approvals, verification, GitHub state, benchmark outcomes, failure buckets, and artifact links legible without reading raw files first.
- A new contributor can understand setup, validation, demo flow, trust boundaries, and current limitations from the repo docs alone.

## Testing Expectations
- Add or update tests when source behavior changes, even for placeholders and release utilities.
- Keep tests lightweight and deterministic.
- Never claim a command passed unless it was actually run in this repo.
- Policy DSL, approval flow, post-run audit behavior, deterministic verification, checkpoint persistence, continuity checks, resume eligibility, GitHub issue normalization, PR publication eligibility, PR comment iteration parsing, benchmark schema loading, score aggregation, comparison logic, regression gating, dashboard read-model aggregation, and release-candidate scripts should remain testable without live GitHub or live Codex access by default.
