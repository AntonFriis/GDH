# Benchmark Corpus

The benchmark corpus is a trust surface for the governed delivery control plane. Every accepted case must stay inspectable, reproducible, and versioned under `benchmarks/` without turning current model output into ground truth.

## Tiers

- `smoke`: fast, deterministic, CI-safe control-plane coverage that should stay cheap enough for regular validation.
- `fresh`: recent real repo tasks normalized into deterministic fixture-backed cases with preserved provenance and explicit curation notes.
- `longhorizon`: broader multi-file milestone tasks that remain runnable on demand, but do not need to stay in the default CI path.

## Corpus Quality Rules

- Allowed fresh sources: recent repo commits, issue follow-ups, review-packet follow-ups, documentation log entries, and human curation tied back to recent repo work.
- Minimum evidence for a fresh candidate: a concrete source reference, a collection date, a task class, a risk class, a human-curated success summary, and a reproducible fixture/spec target.
- Required accepted-case metadata: `candidateId`, `sourceType`, `sourceProvenance`, `collectionDate`, `acceptedDate`, `taskClass`, `riskClass`, `successCriteria`, `allowedPolicies`, `expectedVerificationCommands`, `graders`, `simplificationNotes`, `contaminationNotes`, `acceptanceNotes`, and `maintainerNotes`.
- Smoke suitability: deterministic fixture repo, local-only verification commands, no live network dependency, no auth requirement, and a clear expected terminal state.
- Fresh suitability: recent and realistic repo work, bounded fixture-backed execution, explicit provenance, explicit grader mapping, and no truth labels derived from the current system output.
- Longhorizon suitability: clearly broader than smoke/fresh, multi-file or milestone-shaped, still fixture-backed, and intentionally runnable outside the default CI path.
- Invalid or contaminated cases: live-auth requirements, secret-bearing work, release automation, migrations, hidden external dependencies, vague success criteria, or expectations copied from current model output and treated as truth.

## Intake Workflow

1. Add a candidate record under `benchmarks/fresh/candidates/`.
2. Preserve provenance, collection context, simplification notes, contamination notes, and the review decision in that candidate artifact.
3. If the task is accepted, create a runnable case under `benchmarks/fresh/cases/`, add the matching fixture spec under `benchmarks/fixtures/specs/fresh/`, and set `review.acceptedCaseId` on the candidate.
4. If the task is rejected, keep the record under `benchmarks/fresh/rejected/` with `review.status: rejected` and explicit rejection reasons.
5. Refresh the relevant suite baseline only after the accepted corpus is green and inspectable.

## Fixture Hygiene

- Fixture repos live under `benchmarks/fixtures/repos/`.
- Fixture specs live under `benchmarks/fixtures/specs/<suite>/`.
- Accepted benchmark definitions live under `benchmarks/<suite>/cases/`.
- Candidate and rejected intake artifacts stay separate from accepted cases.
- Persisted benchmark runs belong under `runs/benchmarks/`, not under `benchmarks/`.
- Redactions and simplifications must be recorded in case or intake metadata.

## Commands

```bash
pnpm benchmark:smoke
pnpm gdh benchmark run fresh --ci-safe --json
pnpm gdh benchmark run longhorizon --ci-safe --json
pnpm gdh benchmark compare <benchmark-run-id> --against-baseline
pnpm gdh benchmark show <benchmark-run-id>
```

See [reports/benchmark-corpus-summary.md](/Users/anf/Repos/GDH/reports/benchmark-corpus-summary.md) for the current corpus inventory and [docs/benchmark-report.md](/Users/anf/Repos/GDH/docs/benchmark-report.md) for the benchmark architecture and latest evidence.
