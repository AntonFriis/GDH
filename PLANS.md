# PLANS.md

## Objective
Implement only Phase 4 from `codex_governed_delivery_handoff_spec.md`: durable run state, progress artifacts, interruption handling, resumable execution, `gdh status <run-id>`, and `gdh resume <run-id>` on top of the existing Phase 3 governed run and verification flow.

## Constraints
- Stay within Phase 4 boundaries.
- Treat `codex_governed_delivery_handoff_spec.md` as the architectural source of truth, while adapting to the repo’s current file-backed artifact-store design unless a minimal evolution is required.
- Preserve the existing Phase 2 and Phase 3 governance guarantees: policy evaluation remains artifact-backed, approval requirements are not bypassed, and verification still gates completion.
- Do not implement GitHub draft PR side effects, benchmark suites, regression gating, dashboards, analytics, or multi-agent orchestration.
- Do not add background daemons, queues, or cloud infrastructure for local durability.
- Prefer explicit persisted artifacts, deterministic resume rules, and safe checkpoint boundaries over clever in-memory continuation.
- Keep CI coverage deterministic and independent of live Codex access.

## Milestones
1. Capture the Phase 4 plan and live audit baseline for this implementation session.
2. Extend the domain contracts for durable run/session state, checkpointing, progress snapshots, continuity checks, resume eligibility, pending actions, and the new lifecycle events and statuses.
3. Evolve the file-backed artifact store to persist and load session manifests, checkpoints, progress snapshots, continuity assessments, resume decisions, and interruption records.
4. Refactor the governed run lifecycle so `gdh run` persists durable state after spec normalization, planning, policy evaluation, approval handling, runner execution, and verification, with restart-safe checkpoints and resumability decisions at each boundary.
5. Implement deterministic interruption classification, workspace continuity snapshots, and resume eligibility evaluation that preserve policy and verification guarantees.
6. Implement `gdh status <run-id>` and `gdh resume <run-id>` using persisted artifacts instead of transient session context.
7. Add deterministic tests for manifest updates, checkpoint persistence/loading, progress snapshots, continuity assessment, resume eligibility, and `status` / `resume` integration paths.
8. Run root validation, fix issues, and update the operating docs for the real Phase 4 behavior, limitations, and the remaining Phase 5 work.

## Acceptance Criteria
- `gdh run <spec-file>` persists a durable session manifest, checkpoint artifacts, and progress snapshots throughout the run lifecycle.
- Runs that stop before terminal completion are explicitly classified as resumable or not resumable, with reasons persisted in inspectable artifacts.
- `gdh status <run-id>` loads durable artifacts only, prints a concise summary, and can emit JSON without requiring live Codex access.
- `gdh resume <run-id>` validates the persisted state, performs continuity checks, restarts from the next safe checkpoint boundary, and preserves prior policy, approval, and verification evidence unless deterministic rules require re-entry.
- Approval-paused runs resume through the existing approval flow instead of creating a new run.
- Runs that completed execution but not verification resume into a clean verification boundary and cannot bypass verification.
- Missing critical artifacts, denied approvals, abandoned runs, corrupted state, or incompatible workspace continuity stop resume cleanly with explicit reasons.
- Root `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass from the workspace root.

## Risks
- Overloading the existing `Run` record with durable state that should instead live in explicit manifest/checkpoint artifacts.
- Re-entering an unsafe stage boundary after partial runner or verification work instead of resuming from a clean checkpoint.
- Accidentally weakening approval or verification guarantees while trying to make runs resumable.
- Creating duplicate sources of truth between `run.json`, the new session manifest, and progress artifacts.
- Making workspace continuity checks appear more certain than the available git/worktree evidence supports.

## Verification Plan
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm --filter @gdh/domain test`
- `pnpm --filter @gdh/artifact-store test`
- `pnpm --filter @gdh/cli test`
- manual `pnpm gdh run <spec-file> --runner fake --approval-mode fail`
- manual `pnpm gdh status <run-id>`
- manual `pnpm gdh resume <run-id>`

## Rollback / Fallback
- Keep durability additive around the current file-backed run artifact layout instead of rewriting storage for SQLite in this phase.
- Resume only from explicit safe checkpoints; if a stage cannot be resumed safely, record that it must be re-run rather than attempting arbitrary continuation.
- Prefer an honest `interrupted` or `failed` state with explicit follow-up guidance over ambiguous terminal summaries.
- Preserve inspectable artifacts even when resume is denied so humans can see what blocked continuity.

## Notes
- Phase 4 durable state should be artifact-first and restart-safe; raw CLI transcript replay is out of scope.
- The session manifest should become the compact source for `status` and `resume`, while detailed artifacts remain available for inspection.
- Workspace continuity checks should be lightweight and conservative: compatible, warning, or incompatible, with reasons recorded.
- SQLite-backed indexing remains a possible future refinement, but the initial Phase 4 implementation should first prove the resumable lifecycle on top of the current local artifact model.
