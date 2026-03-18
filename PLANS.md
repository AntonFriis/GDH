# PLANS.md

## Objective
Implement only Phase 7 from `codex_governed_delivery_handoff_spec.md`: a local dashboard and lightweight analytics layer that makes governed runs, approvals, verification, GitHub delivery, and benchmark outcomes legible on top of the existing Phase 6 artifact-backed control plane.

## Constraints
- Stay within Phase 7 boundaries.
- Treat `codex_governed_delivery_handoff_spec.md` as the architectural source of truth while adapting to the current file-backed run and artifact model.
- Preserve the existing guarantees: policy evaluation stays artifact-backed, approvals are never bypassed, verification still gates `completed`, resume remains continuity infrastructure, GitHub delivery stays a conservative packaging step, and benchmarks remain deterministic evidence rather than opaque scoring.
- Keep the dashboard local-first and lightweight: no hosted deployment, auth, multi-user state, background workers, or generic BI/reporting expansion.
- Use explicit read-model types and a dedicated query layer; do not bury filesystem traversal in React components or duplicate business logic inside `apps/api`.
- Derive analytics from persisted artifacts only; do not fabricate missing precision or imply live state that is not represented in the artifact store.
- Prefer clear operational views and artifact linking over polished productization.

## Milestones
1. Capture the Phase 7 plan and live audit baseline for this implementation session.
2. Extend the domain contracts with explicit dashboard read-model schemas for runs, approvals, verification, GitHub delivery, benchmarks, analytics summaries, timelines, and artifact links.
3. Implement an artifact-backed read/query layer that aggregates local run and benchmark artifacts into those views, gracefully handling missing earlier-phase files while surfacing richer Phase 4-6 data when present.
4. Expose the read models through the existing `apps/api` Fastify surface with thin local endpoints for overview, runs, approvals, benchmarks, and failure taxonomy.
5. Replace the `apps/web` Phase 0 scaffold with a lightweight routed dashboard that provides overview, run list, run detail, approvals, benchmarks, and failure taxonomy pages plus clear artifact links and paths.
6. Add deterministic tests for read-model aggregation, API endpoints, and main dashboard page rendering using fixture artifacts only.
7. Add root-local dashboard startup scripts, run workspace validation, and update repo docs so the implemented Phase 7 visibility layer, metrics, startup flow, and remaining Phase 8 scope are described accurately.

## Acceptance Criteria
- A local dashboard can be started from the repo and reads only from the existing local artifact model.
- The dashboard exposes overview, run list, run detail, approvals, benchmark, and failure-taxonomy views without requiring the operator to inspect raw JSON files first.
- Run list items show id, objective or title, status, created and updated timestamps, approval state, verification state, and GitHub state when present.
- Run detail views summarize the normalized spec, plan, timeline or event history, approvals, verification, review packet state, benchmark linkage, GitHub delivery state, and artifact outputs.
- Benchmark views surface suite or run status, overall score, regression or comparison state, and case-level outcomes from persisted benchmark artifacts.
- Analytics summaries derive run counts, approval-required counts, verification failures, benchmark regressions, and GitHub draft PR counts from persisted artifacts only.
- Root `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass from the workspace root after the changes.

## Risks
- Duplicating artifact interpretation across the API and web layers instead of concentrating it in a single explicit query layer.
- Overfitting the read models to the current small seed dataset and breaking when older runs are missing later-phase artifacts or when future runs add new artifacts.
- Turning the dashboard into a second source of truth by inventing derived status transitions that are not backed by persisted evidence.
- Building a heavier frontend stack than the repo needs for a local operational surface.
- Making artifact linking confusing or unsafe if the browser cannot access local files directly.
- Adding analytics that look precise despite the underlying artifacts not recording enough detail.

## Verification Plan
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm --filter @gdh/domain test`
- `pnpm --filter @gdh/artifact-store test`
- `pnpm --filter @gdh/api test`
- `pnpm --filter @gdh/web test`
- `pnpm build`

## Rollback / Fallback
- Keep the dashboard query layer additive and read-only over the current artifact directories instead of changing the run or benchmark write paths.
- Reuse the existing `apps/api` package as the only backend surface; if a view is not ready, expose the underlying summary in the API first rather than teaching the web app to read files directly.
- Treat missing artifacts conservatively: render incomplete sections as unavailable or partial rather than guessing richer state.
- If direct artifact preview URLs prove awkward for the browser, fall back to consistent path display plus API-backed content views instead of adding OS-specific file-link behavior.

## Notes
- The dashboard remains a visibility layer; artifact-backed run, approval, verification, GitHub, and benchmark logic stays in the existing governed packages.
- Read models should normalize older Phase 1-2 runs and richer Phase 4-6 runs into one coherent UI without pretending the earlier artifacts contain later metadata.
- Failure taxonomy should stay operational and narrow: policy blocks, approval pauses or denials, verification failures, benchmark regressions, and GitHub sync failures if present.
- Phase 8 can harden installation, demos, architecture docs, and release packaging on top of this Phase 7 visibility layer without rewriting the read-model contract.
