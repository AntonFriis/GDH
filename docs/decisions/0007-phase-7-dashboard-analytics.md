# 0007 Phase 7 Dashboard And Analytics

## Status

Accepted

## Context

Phase 6 left the control plane with durable run, approval, verification, GitHub, and benchmark artifacts, but operators still had to read raw files to understand what happened in a run. The handoff specification defines Phase 7 as the point where the system becomes legible to non-authors through a local dashboard and lightweight analytics layer.

The key architectural requirement is that the dashboard stays a visibility layer rather than becoming a second source of truth. The repo already had:

- `apps/api` as the intended thin local inspection surface
- `apps/web` as a React + Vite dashboard scaffold
- `packages/domain` for shared contracts
- `packages/artifact-store` for file-backed run and benchmark persistence

## Decision

Implement Phase 7 as an explicit read-model layer over the existing artifact store.

Concretely:

- add dashboard read-model schemas to `@gdh/domain`
- implement artifact-backed query and aggregation functions in `@gdh/artifact-store`
- keep `apps/api` thin by exposing those read models through local endpoints only
- keep `apps/web` local-first and lightweight, using simple routed pages and minimal filtering
- derive analytics strictly from persisted artifacts instead of introducing live mutable dashboard state
- expose artifact links and preview routes where files are locally available, and otherwise show stable paths

## Consequences

Positive:

- operators can understand runs, approvals, verification, GitHub draft PR state, and benchmark regressions without reading raw JSON files first
- dashboard behavior remains testable through deterministic fixture artifacts
- the API and web app share a single read-model contract instead of duplicating ad hoc parsing logic
- Phase 8 can harden docs, demos, and release polish without redesigning the visibility layer

Tradeoffs:

- older Phase 1 and Phase 2 run artifacts require conservative normalization because they predate later durability fields
- local artifact previews intentionally stay narrow and do not attempt full desktop file integration
- analytics remain intentionally small until the artifact model records richer cost and latency data
