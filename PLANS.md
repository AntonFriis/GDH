# PLANS.md

## Objective
Deepen the repeated GitHub load-modify-persist ceremony behind a dedicated `GithubSyncService`, then migrate the CLI and run-lifecycle issue-ingestion flow onto that boundary so GitHub state updates remain durable, testable, and evidence-backed.

## Constraints

- Read and follow `codex_governed_delivery_handoff_spec.md`, `AGENTS.md`, `implement.md`, `documentation.md`, and `README.md` before editing.
- Stay inside Phase 8 scope by hardening the existing local GitHub delivery boundary rather than adding hosted services, merge automation, or new background workflows.
- Keep GitHub publication conservative and artifact-backed: local run state, manifest state, event emission, and intermediate request/result artifacts must stay inspectable under `runs/`.
- Keep the public CLI contract stable. `gdh pr create`, `gdh pr sync-packet`, `gdh pr comments`, and `gdh pr iterate` should remain thin operator entrypoints.
- Update `documentation.md` after meaningful milestones, decisions, and verification runs.

## Milestones

1. Completed: inspect the repeated GitHub state-management ceremony in `apps/cli/src/program.ts`, the issue-ingestion path in `transition-engine.ts`, and the current `github-flow.test.ts` coverage gaps.
2. Completed: add `apps/cli/src/services/github-sync/service.ts` with named operations plus an internal execution template that owns lifecycle loading, GitHub client resolution, state merging, persistence, and failure-event emission.
3. Completed: migrate the CLI PR/comment flows and the run-lifecycle issue-ingestion step onto the new service, removing the old shallow `updateGithubState()` and `emitGithubFailureEvent()` helpers.
4. Completed: expand boundary and integration coverage for draft PR persistence, packet sync, comment sync, iteration-request accumulation, and failure-event emission, then rerun repo validation.

## Acceptance Criteria

- A dedicated `GithubSyncService` owns the durable GitHub sync ceremony instead of duplicating it across multiple CLI commands.
- `createDraftPr`, `syncPacket`, `syncComments`, `materializeIteration`, and issue-ingestion all persist `run.json` and `session.manifest.json` through one deeper boundary.
- GitHub sync failures still append a durable `github.sync.failed` event with the operation name and error message.
- Existing CLI commands remain the public surface, but their implementations become thin wrappers over the sync service.
- Tests cover the persistence path for draft PR creation, packet/comment sync flows, iteration-request accumulation, and failure-event emission.
- Repo validation passes after the refactor.

## Risks

- The new service must not accidentally require GitHub credentials for blocked flows that should return before making network-capable calls.
- Issue-ingestion now shares the same deeper service boundary as later PR/comment sync operations, so the transition-engine integration must avoid introducing lifecycle import cycles.
- The workspace package exports still point runtime consumers at built `dist` outputs, so verification has to include a build-aware test pass rather than source-only unit execution.

## Verification Plan

- Targeted CLI verification:
  - `pnpm --filter @gdh/cli typecheck`
  - `pnpm --filter @gdh/cli test`
- Repo-level verification:
  - `pnpm validate`

## Notes

- Keep GitHub adapter resolution internal to the sync service for run-scoped operations, while allowing the pre-run issue fetch path to keep its existing resolver.
- Prefer a deeper execution template plus named operation methods over additional tiny helpers so the hard part of the GitHub flow stays in one place.
