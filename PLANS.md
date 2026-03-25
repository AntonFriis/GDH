# PLANS.md

## Objective
Resolve issue `GDH/#9` by deepening `@gdh/policy-engine` behind a session-oriented pipeline boundary, contracting the root package API to the new entrypoints, and migrating the CLI lifecycle onto that deeper seam without changing the governed artifact flow.

## Constraints

- Read and follow `codex_governed_delivery_handoff_spec.md`, `AGENTS.md`, `implement.md`, `documentation.md`, and `README.md` before editing.
- Stay inside Phase 8 scope by hardening an already-implemented control-plane boundary rather than adding new hosted behavior, automation, or policy features.
- Contract the root `@gdh/policy-engine` surface to `evaluateSpec`, `auditRun`, and `createApprovalResolutionRecord`.
- Preserve the current run artifacts, checkpoints, events, resume behavior, and verification expectations, including `policy.input.json`.
- Move low-level evaluation helpers behind `@gdh/policy-engine/internals` so callers stop orchestrating the fixed six-step pipeline themselves.
- Update `documentation.md` after meaningful milestones, decisions, and verification runs.

## Milestones

1. Completed: add `packages/policy-engine/src/pipeline.ts` plus the `./internals` subpath and contract the root package exports to the new pipeline boundary.
2. Completed: migrate `apps/cli` lifecycle orchestration to `evaluateSpec` and `auditRun`, while keeping `policy.input.json`, policy artifacts, and resume behavior intact.
3. Completed: rework `packages/policy-engine` tests around the public boundary, keep a narrow internal test surface, and confirm CLI lifecycle tests still pass.
4. Completed: document the issue `#9` implementation and rerun repo validation from the new worktree.

## Acceptance Criteria

- `@gdh/policy-engine` root exports only `evaluateSpec`, `auditRun`, and `createApprovalResolutionRecord`.
- Low-level helpers remain available through `@gdh/policy-engine/internals` for the CLI loader path and narrow internal tests.
- `apps/cli` no longer reconstructs the fixed policy pipeline step by step before runner execution.
- Existing policy artifacts, approval artifacts, checkpoints, manifests, and `policy.input.json` stay compatible with the current verification and resume flow.
- Boundary-focused policy-engine tests and the CLI lifecycle suite pass after the migration.
- Repo validation passes and the docs reflect the completed issue `#9` implementation.

## Risks

- The workspace package exports still point runtime imports at built `dist` files, so dependent test runs need the usual package builds in place before Vitest resolves the workspace graph.
- The CLI still needs separate policy-pack loading for run metadata and `policy.input.json`, so the new pipeline boundary should not accidentally pull those caller-owned artifacts into the package contract.
- The audit migration must keep both the normal post-run path and the blocked-run path aligned, or policy-audit artifacts could drift between lifecycle outcomes.

## Verification Plan

- Package-level verification:
  - `pnpm --filter @gdh/domain build`
  - `pnpm --filter @gdh/shared build`
  - `pnpm --filter @gdh/policy-engine build`
  - `pnpm --filter @gdh/policy-engine test`
  - `pnpm --filter @gdh/cli typecheck`
  - `pnpm --filter @gdh/cli test`
- Repo-level verification:
  - `pnpm build`
  - `pnpm validate`

## Notes

- The deeper module boundary now lives in `packages/policy-engine`, while the CLI keeps ownership of run metadata persistence and the caller-owned `policy.input.json` artifact.
- `auditRun` intentionally re-reads the policy pack so the post-run audit remains consistent even when it happens after the pre-execution evaluation gap.
