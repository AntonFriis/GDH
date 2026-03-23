# PLANS.md

## Objective
Strengthen the benchmark corpus inside the existing Phase 6-8 benchmark/eval substrate so the repo ends this session with a trustworthy, inspectable, and maintainable three-tier corpus: a credible CI-safe `smoke` suite, a real `fresh` suite sourced from recent repo work, and a seeded `longhorizon` suite for broader governed-run tasks.

## Constraints
- Stay within the implemented benchmark architecture; keep the existing benchmark engine, CLI surface, artifact model, and suite layout unless a small schema or fixture-hygiene change is required.
- Treat this as release hardening and evidence building on top of the completed benchmark system, not as a new product phase.
- Preserve deterministic CI behavior for the smoke suite and keep network access optional and off by default.
- Do not add multi-agent orchestration, hosted eval services, merge/deploy automation, or a self-improvement/autotuning loop.
- Do not contaminate benchmark truth labels with the system’s own current outputs; fresh-task success criteria must remain human-curated and provenance-backed.
- Keep fixture repos, suite metadata, baselines, and reports inspectable and versioned under `benchmarks/`, `runs/benchmarks/`, and `reports/`.

## Milestones
1. Audit the current benchmark corpus, suite layout, grader model, baselines, and CI smoke path, then record the starting weaknesses in the live audit log.
2. Add explicit corpus quality rules plus a versioned intake format for fresh-task candidates, accepted cases, and rejected cases.
3. Extend the benchmark domain/catalog layer just enough to preserve provenance, grader selection, fixture metadata, and suite-hygiene validation.
4. Expand the deterministic fixture substrate and grow the suite corpus:
   - materially enlarge `smoke`
   - add a real accepted `fresh` suite sourced from recent repo tasks
   - seed a small `longhorizon` set
5. Add or refine tests for the new corpus metadata, intake loading, suite separation, and fresh-case discovery/run behavior.
6. Run benchmark commands plus root validation, generate a benchmark corpus summary artifact, and update repo-facing docs for ongoing corpus maintenance.

## Acceptance Criteria
- The benchmark corpus is materially larger than the current four-case smoke seed.
- `fresh` contains accepted cases derived from recent real repo tasks with explicit provenance, curation notes, success criteria, and grader alignment.
- `smoke`, `fresh`, and `longhorizon` remain clearly separated in layout, metadata, and documentation.
- Every accepted case records task class, risk class, allowed policy expectations, verification expectations, and grader selections.
- Fixture hygiene is clear: benchmark fixtures are separated from live run artifacts, and simplification/redaction decisions are recorded.
- The benchmark loader and runner can load the expanded corpus without schema breakage.
- `pnpm benchmark:smoke` remains deterministic and CI-suitable.
- Root `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass after the changes.

## Risks
- Overfitting the corpus to synthetic happy paths while only renaming them as “fresh.”
- Widening the benchmark engine too much when metadata and fixture-hygiene changes would suffice.
- Weak provenance or curation notes making fresh-task cases hard to trust later.
- Growing the smoke suite so much that CI becomes slow or brittle.
- Introducing live-only or flaky cases into the default validation path.

## Verification Plan
- `pnpm --filter @gdh/benchmark-cases test`
- `pnpm --filter @gdh/evals test`
- `pnpm --filter @gdh/cli test -- --runInBand`
- `pnpm benchmark:smoke`
- `pnpm gdh benchmark run fresh --ci-safe --json`
- `pnpm gdh benchmark run <representative-fresh-case> --ci-safe --json`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

## Rollback / Fallback
- Keep schema changes additive and optional where possible so existing benchmark artifacts continue to load.
- If a case proves too contaminated or too flaky for acceptance, keep it in `benchmarks/fresh/rejected/` with explicit rationale instead of forcing it into the runnable corpus.
- If a richer longhorizon execution mode would require larger engine changes, seed the cases and document their intentional run mode instead of redesigning the benchmark executor in this session.
- If smoke expansion starts to threaten CI practicality, preserve the most control-plane-representative deterministic cases and shift broader coverage into `fresh`.

## Notes
- The benchmark corpus is a trust surface for this repo: provenance, determinism, and inspectability matter more than raw case volume.
- Fresh-task realism should come from recent repo work and preserved collection context, not from model-authored “ground truth.”
- The final corpus summary should capture both what is covered now and what remains weak so future sessions can extend the corpus deliberately.
