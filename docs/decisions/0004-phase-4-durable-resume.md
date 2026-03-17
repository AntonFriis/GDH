# 0004 Phase 4 Durable Resume

## Status
Accepted

## Context

Phase 3 already had deterministic planning, policy gating, verification, and evidence-backed review packets, but the run lifecycle still assumed a single uninterrupted CLI session. Approval-paused work, runner interruptions, and verification restarts all required humans to reconstruct state manually from raw artifacts.

The handoff calls for durable state, checkpoints, progress artifacts, interruption handling, and resumable runs. At the same time, the repository already has a working local file-backed artifact layout, and this phase explicitly avoids queues, daemons, cloud infrastructure, and other large storage rewrites unless they are required to make resumability possible.

## Decision

Implement Phase 4 durability on top of the existing local file-backed artifact model:

- Persist a compact `session.manifest.json` per run as the durable source for `gdh status` and `gdh resume`.
- Persist historical checkpoint artifacts under `checkpoints/` and progress snapshots under `progress/`.
- Persist one `sessions/<session-id>.json` record per initial or resumed invocation.
- Persist workspace continuity snapshots and continuity assessments as explicit artifacts.
- Resume only from explicit safe boundaries rather than attempting arbitrary mid-subprocess continuation.
- Keep policy, approval, and verification guarantees intact during resume.

The artifact store remains file-backed in Phase 4. SQLite-backed indexing is still a valid later refinement, but it is not required to ship a coherent resumable lifecycle locally.

## Consequences

Positive:

- Interrupted work can be inspected and resumed without replaying raw chat history.
- Resume decisions are explicit, inspectable, and testable in CI.
- The existing run flow gains continuity without forcing a storage rewrite mid-stream.
- Phase 5 can build GitHub packaging on top of the same durable run model instead of redesigning control flow again.

Tradeoffs:

- File-backed durability is simple and local, but it does not yet provide richer query/index surfaces.
- Continuity checks are intentionally conservative and heuristic rather than fully reproducible.
- `status` and `resume` rely on durable artifact completeness, so missing files correctly block continuation.
