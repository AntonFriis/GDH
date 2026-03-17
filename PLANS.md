# PLANS.md

## Objective
Implement only Phase 6 from `codex_governed_delivery_handoff_spec.md`: benchmark suites, regression gating, and run-to-run evaluation on top of the existing Phase 5 governed run, verification, durable artifact, and draft-PR delivery flow.

## Constraints
- Stay within Phase 6 boundaries.
- Treat `codex_governed_delivery_handoff_spec.md` as the architectural source of truth while adapting to the current file-backed run and artifact model.
- Preserve the existing guarantees: policy evaluation stays artifact-backed, approvals are never bypassed, verification still gates `completed`, resume remains continuity infrastructure, and GitHub delivery stays a conservative packaging step.
- Make benchmarks first-class repo artifacts instead of ad hoc test scripts.
- Keep benchmark execution reproducible, inspectable, deterministic in CI-safe mode, and independent of live Codex or live GitHub.
- Prefer explicit benchmark metrics, thresholds, and persisted comparison artifacts over opaque grader logic.
- Keep the schema minimal and versioned; do not overbuild for speculative later phases.
- Do not add dashboards, analytics, hosted eval platforms, cloud dependencies, multi-agent orchestration, or autonomous self-optimization loops in this phase.

## Milestones
1. Capture the Phase 6 plan and live audit baseline for this implementation session.
2. Extend the domain contracts and lifecycle events for benchmark suites, benchmark runs, per-case results, scores, metrics, comparisons, baselines, thresholds, and regression reports.
3. Implement repo-local benchmark case and suite loading with simple versioned artifact files under `benchmarks/`, including deterministic fixture-backed smoke cases and baseline references.
4. Implement the benchmark execution loop in `@gdh/evals`, driven by the existing governed run surface through an injected executor, with persisted run metadata, per-case score breakdowns, and CI-safe mode.
5. Implement explicit metric scoring, score aggregation, run-to-run comparison, baseline resolution, and threshold-based regression detection with deterministic non-zero failure behavior.
6. Wire the CLI surface for `gdh benchmark run`, `gdh benchmark compare`, and `gdh benchmark show`, plus root script and CI workflow updates for a smoke benchmark pass.
7. Add deterministic tests for schema parsing, suite loading, scoring, comparison logic, regression gating, and CLI benchmark flows using the fake runner and local fixtures only.
8. Run root validation and benchmark smoke validation, then update the repo docs so the Phase 6 benchmark substrate, thresholds, artifacts, and remaining Phase 7 scope are described accurately.

## Acceptance Criteria
- Benchmark cases and suites can be defined as repo artifacts without code changes.
- `gdh benchmark run <suite-or-case>` executes a case or suite through the governed local run surface, persists inspectable benchmark artifacts, and records per-case metric scores plus an overall score.
- `gdh benchmark compare <lhs> <rhs>` and `gdh benchmark compare --against-baseline <run-id>` persist a comparison report with per-case deltas, overall deltas, and an explicit regression result.
- Regression detection is deterministic and supports threshold checks for overall score drop, required-metric failures, and newly failing cases.
- CI-safe smoke benchmark execution runs without live Codex or live GitHub and fails non-zero when configured regression thresholds are exceeded.
- Root `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass from the workspace root after the changes.

## Risks
- Duplicating governed-run logic inside the benchmark layer instead of reusing the existing run/verify/artifact entrypoints.
- Hiding benchmark grading inside coarse pass/fail logic that is hard to inspect or compare later.
- Letting benchmark fixtures depend on live services or mutable repo state, which would make CI flaky.
- Making the benchmark schema too abstract for the current smoke-suite needs and forcing a rewrite later.
- Treating run comparisons as summaries only and failing to persist enough case-level evidence for regression debugging.
- Creating CI benchmark checks that are so expensive or broad that they slow normal iteration.

## Verification Plan
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm --filter @gdh/domain test`
- `pnpm --filter @gdh/benchmark-cases test`
- `pnpm --filter @gdh/evals test`
- `pnpm --filter @gdh/cli test`
- `pnpm gdh benchmark run smoke --ci-safe --json`

## Rollback / Fallback
- Keep benchmark state additive under the local artifact store instead of rewriting the existing governed run directories.
- Use injected execution adapters so benchmark orchestration can reuse the current CLI flow without introducing a hard package cycle or hidden side path.
- If a benchmark case cannot run safely in CI mode, mark it as non-CI-safe in suite metadata and exclude it from the smoke baseline instead of adding live-service dependencies.
- If comparison inputs are incomplete or incompatible, fail explicitly with a persisted comparison artifact rather than guessing a baseline or silently skipping cases.

## Notes
- Benchmark artifacts should live beside the existing run artifacts so a benchmark case can link directly to the underlying governed run directory it produced.
- Initial scoring should stay explicit and narrow: success state, policy correctness, verification correctness, review packet completeness, and required artifact presence.
- The first seed suite should be intentionally small but exercise both happy-path and negative-path governed behaviors using deterministic fixtures and the fake runner.
- Phase 7 can build richer long-horizon suites, dashboards, and learning loops on top of this artifact-backed evaluation substrate without redesigning the scoring model.
