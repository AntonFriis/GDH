# Benchmark Report

The release candidate now ships with a three-tier benchmark corpus under `benchmarks/`:

- `smoke`: deterministic CI-safe control-plane coverage
- `fresh`: recent real repo tasks normalized into reproducible fixture-backed cases
- `longhorizon`: broader multi-file tasks for intentional benchmark runs

## Purpose

The benchmark surface exists to catch regressions in the governed control plane itself, not to overclaim broad autonomous software-engineering capability or open-ended coding performance.

## Current Corpus

- accepted cases: `20`
- suites: `smoke (10)`, `fresh (8)`, `longhorizon (2)`
- baseline artifacts: `benchmarks/baselines/smoke-baseline.json`, `benchmarks/baselines/fresh-baseline.json`, `benchmarks/baselines/longhorizon-baseline.json`
- intake workflow: `benchmarks/fresh/candidates/`, `benchmarks/fresh/cases/`, `benchmarks/fresh/rejected/`

## Metrics And Graders

The executable benchmark engine scores:

- `success`
- `policy_correctness`
- `verification_correctness`
- `packet_completeness`
- `artifact_presence`

Accepted cases also record grader intent for:

- `task_completion`
- `tests_passing`
- `policy_violations`
- `review_packet_fidelity`
- `artifact_completeness`
- `human_intervention_count`
- `latency`

`human_intervention_count` and `latency` are currently metadata-backed review dimensions; the first five metrics remain the executable regression gates.

## Usage

Run the deterministic CI-safe smoke gate:

```bash
pnpm benchmark:smoke
```

Run or inspect the broader suites intentionally:

```bash
pnpm gdh benchmark run fresh --ci-safe --json
pnpm gdh benchmark run longhorizon --ci-safe --json
pnpm gdh benchmark show <benchmark-run-id>
```

Compare a run against its configured baseline:

```bash
pnpm gdh benchmark compare <benchmark-run-id> --against-baseline
```

## Interpretation

- `smoke` should stay deterministic and cheap enough for regular CI.
- `fresh` should stay recent, provenance-backed, and reproducible without collapsing into toy fixtures.
- `longhorizon` should stay inspectable and runnable on demand without becoming the default gate.
- A passing corpus run does not prove correctness on live-network tasks, live-auth Codex runs, production release automation, or protected surfaces.

## Latest Evidence

During the benchmark-corpus stabilization session on 2026-03-23:

- `benchmark-smoke-20260323T162829z-765ef1` passed `10/10` cases with regression status `passed` against `Smoke baseline 2026-03-23`
- `benchmark-fresh-20260323T162844z-58be72` passed `8/8` cases with regression status `passed` against `Fresh baseline 2026-03-23`
- `benchmark-longhorizon-20260323T162844z-80f84e` passed `2/2` cases with regression status `passed` against `Longhorizon baseline 2026-03-23`

See [benchmarks/README.md](/Users/anf/Repos/GDH/benchmarks/README.md) for intake and quality rules, and [reports/benchmark-corpus-summary.md](/Users/anf/Repos/GDH/reports/benchmark-corpus-summary.md) for the current corpus inventory and known gaps.
