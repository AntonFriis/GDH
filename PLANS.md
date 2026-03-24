# PLANS.md

## Objective
Deepen the local dashboard read model behind a snapshot-loading service plus a separate artifact preview service, then migrate the API and web adapters to consume that coherent artifact-backed boundary.

## Constraints

- Read and follow `codex_governed_delivery_handoff_spec.md`, `AGENTS.md`, `implement.md`, `documentation.md`, and `README.md` before editing.
- Stay inside Phase 8 scope by hardening the existing local dashboard architecture rather than adding hosted services, background workers, or new control-plane behavior.
- Keep the read model file-backed and deterministic; the dashboard must continue deriving everything from persisted artifacts under `runs/` and related repo-local evidence.
- Preserve backward-compatible normalization for mixed-version or partial artifacts inside the artifact-store layer instead of pushing that logic into API routes or React pages.
- Keep artifact preview as a separate guarded capability with repo-root path validation.
- Update `documentation.md` after meaningful milestones, decisions, and verification runs.

## Milestones

1. Completed: inspect the current artifact-store dashboard module, API routes, web data-loading flow, and existing tests to confirm the current shallow-getter seam.
2. Completed: add a stable `DashboardSnapshot` contract in `packages/domain` plus snapshot/preview services in `packages/artifact-store`, while keeping the legacy query service as a thin compatibility adapter.
3. Completed: migrate `apps/api` to slice the loaded snapshot through thin transport routes and add a first-class `/api/dashboard` endpoint.
4. Completed: migrate `apps/web` to fetch one snapshot-shaped payload and render page-specific slices locally instead of depending on many unrelated endpoint contracts.
5. Completed: tighten boundary-focused tests, run verification, and document the implementation plus verification outcome.

## Acceptance Criteria

- A `DashboardSnapshotService` loads one coherent dashboard snapshot with overview, run lists and detail lookups, approvals, benchmark lists and detail lookups, and failure taxonomy.
- An `ArtifactPreviewService` performs safe artifact reads with repo-root path guarding separated from snapshot loading.
- API routes become thin adapters over the snapshot service instead of recomputing dashboard concerns through many deep getters.
- The web consumes snapshot-shaped data rather than separate overview, list, and detail endpoint contracts.
- Tests focus on the snapshot boundary and adapter wiring rather than duplicating the full read-model expectations at every layer.
- Repo validation passes for the affected packages and the changed docs are updated with the new session scope and outcome.

## Risks

- The snapshot payload is larger than the previous page-specific responses, so the refactor must keep the contract stable and avoid accidental shape drift across the API and web.
- Route-level filtering and sorting still belong in adapters; pushing too much of that back into the read model would recreate the shallow-interface problem under a new name.
- Keeping the legacy query service for compatibility risks duplicated logic unless it is implemented strictly as a thin wrapper around the new snapshot and preview services.

## Verification Plan

- Package-level verification:
  - `pnpm --filter @gdh/domain typecheck`
  - `pnpm --filter @gdh/artifact-store test`
  - `pnpm --filter @gdh/api test`
  - `pnpm --filter @gdh/web test`
- Repo-level verification:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`

## Notes

- The read model should stay the deep module; the API and web should only project and format slices from the loaded snapshot.
- Keeping the old route surface during the migration is acceptable as long as those routes are now thin snapshot adapters.
