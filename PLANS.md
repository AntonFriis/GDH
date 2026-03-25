# PLANS.md

## Objective
Deepen benchmark execution behind a `BenchmarkTargetService` so `@gdh/evals` exposes one small benchmark-session boundary while the CLI benchmark commands and bounded optimization flow depend on that service instead of scattered orchestration helpers.

## Constraints

- Read and follow `codex_governed_delivery_handoff_spec.md`, `AGENTS.md`, `implement.md`, `documentation.md`, and `README.md` before editing.
- Stay inside Phase 8 scope by refactoring the benchmark boundary for maintainability without changing the current artifact model, benchmark product surface, or release-candidate command set.
- Keep benchmark execution deterministic, fixture-backed, and artifact-backed; no live GitHub or network dependency should be introduced.
- Preserve existing benchmark artifacts, event names, baseline behavior, exit-code policy, and `gdh benchmark show` inspection behavior.
- Keep `packages/evals` public exports small and explicit, and move the deep orchestration into focused internal collaborators.
- Update `documentation.md` after implementation milestones and verification runs.

## Milestones

1. Completed: inspect the existing benchmark flow across `packages/evals`, `packages/benchmark-cases`, `apps/cli`, and `apps/cli/src/optimize.ts`, then fetch issue `AntonFriis/GDH#8`.
2. Completed: introduce a public `BenchmarkTargetService` boundary in `@gdh/evals` with `runTarget` and `compareRunArtifacts`, plus explicit run/config/catalog/persistence collaborators behind the service.
3. Completed: migrate CLI benchmark commands and the bounded optimization workflow onto the new service boundary and remove the old top-level orchestration helpers from the package surface.
4. Completed: deepen package-level benchmark tests around the new service boundary and keep CLI tests focused on wiring and command-surface behavior.
5. Completed: update architecture/session docs and run verification on the changed code.

## Acceptance Criteria

- `@gdh/evals` exports a small benchmark-session API centered on `createBenchmarkTargetService()`, `BenchmarkTargetService`, `runTarget`, and `compareRunArtifacts`.
- Catalog loading, target resolution, config/run loading, artifact persistence, case execution coordination, and comparison/regression evaluation are separated into internal collaborators instead of one orchestration helper.
- `apps/cli` benchmark commands and `apps/cli/src/optimize.ts` use the service boundary instead of standalone benchmark helper functions.
- Package-level tests prove suite execution, single-case execution, `ci_safe` workspace preparation, persisted benchmark/comparison/regression artifacts, and compare-path regression behavior without relying on live services.
- The benchmark artifact format and command summaries remain backward-compatible for existing local runs and tests.

## Risks

- The package runtime export for `@gdh/evals` points at built `dist` outputs, so dependent tests must be verified against rebuilt runtime artifacts after the public surface changes.
- Benchmark comparisons can fail because of score regressions or case-presence drift; service tests need to assert the actual regression signals instead of assuming only score deltas matter.
- Repo-wide `pnpm validate` can be blocked by unrelated local files outside the tracked workspace surface, so verification notes must distinguish implementation results from environment-local lint noise.

## Verification Plan

- `pnpm --filter @gdh/evals typecheck`
- `pnpm --filter @gdh/evals test`
- `pnpm --filter @gdh/evals build`
- `pnpm --filter @gdh/cli test -- program.test.ts optimize.test.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- Attempt `pnpm validate` and record any environment-local blockers separately from the code change itself.

## Notes

- `gdh benchmark show` remains a direct persisted-artifact inspection path rather than a service operation.
- The injected governed-run executor stays the controlled benchmark seam; the service owns orchestration, not runner implementation.
- The new package-level benchmark tests use synthetic run artifacts to keep the service boundary deterministic and independent from CLI-owned behavior.
