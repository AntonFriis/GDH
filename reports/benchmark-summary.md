# Benchmark Summary

Date: 2026-03-24
Purpose: provide an external-review snapshot of GDH’s benchmark surface, current suite coverage, latest relevant evidence, and interpretation limits.

## What The Benchmarks Are For

The benchmark surface exists to measure the governed control plane itself. It is meant to catch regressions in planning, policy handling, verification behavior, review-packet completeness, and durable artifact output.

It is not meant to prove broad autonomous software-engineering capability.

## Corpus At A Glance

- accepted cases: `20`
- suites: `3`
- default CI-safe gate: `smoke`
- broader intentional suites: `fresh`, `longhorizon`

Suite breakdown:

| Suite | Purpose | Cases | Default |
| --- | --- | ---: | --- |
| `smoke` | Fast deterministic control-plane regression gate | 10 | Yes |
| `fresh` | Recent real repo tasks normalized into reproducible cases | 8 | No |
| `longhorizon` | Broader multi-file tasks for intentional evaluation | 2 | No |

The executable regression metrics are:

- `success`
- `policy_correctness`
- `verification_correctness`
- `packet_completeness`
- `artifact_presence`

## Latest Referenced Suite Evidence

| Date | Suite | Benchmark Run ID | Result | Regression |
| --- | --- | --- | --- | --- |
| 2026-03-24 | `smoke` | `benchmark-smoke-20260324T123701z-8391dd` | `10/10` passed, score `1.00` | `passed` |
| 2026-03-23 | `fresh` | `benchmark-fresh-20260323T162844z-58be72` | `8/8` passed, score `1.00` | `passed` |
| 2026-03-23 | `longhorizon` | `benchmark-longhorizon-20260323T162844z-80f84e` | `2/2` passed, score `1.00` | `passed` |

All three referenced suite runs reported:

- overall score drop: `0`
- newly failing cases: none
- required metric failures: none

## Additional Fresh Evidence In This Repo

The repo also includes targeted single-case fresh runs from 2026-03-24:

- `benchmark-fresh-docs-issue-to-draft-pr-example-20260324T082948z-5f7322`
- `benchmark-fresh-tests-dashboard-loading-wait-20260324T082956z-407e87`

Those are useful as concrete spot checks, but the main suite-level evidence for external review remains the full `fresh` suite run from 2026-03-23 plus the current `smoke` gate from 2026-03-24.

## How To Reproduce The Main Evidence

Run the default regression gate:

```bash
pnpm benchmark:smoke
```

Run the broader suites intentionally:

```bash
pnpm gdh benchmark run fresh --ci-safe --json
pnpm gdh benchmark run longhorizon --ci-safe --json
```

Inspect a persisted run:

```bash
pnpm gdh benchmark show <benchmark-run-id> --json
pnpm gdh benchmark compare <benchmark-run-id> --against-baseline --json
```

## What This Evidence Supports

- The control plane has a real deterministic benchmark harness.
- The repo can regression-test policy behavior, verification behavior, review-packet completeness, and artifact persistence.
- Benchmark suites and baselines are versioned as repo artifacts rather than hidden hosted state.
- The default CI-safe benchmark gate is cheap enough to run as part of release validation.

## What This Evidence Does Not Prove

- It does not prove correctness for live-network tasks.
- It does not prove correctness for live-auth GitHub publication flows.
- It does not prove correctness for every live `codex-cli` environment.
- It does not prove broad agent performance outside the governed surfaces represented in the corpus.

## Known Gaps

- The `fresh` corpus is still weighted toward docs, tests, CI/config, and bounded refactors.
- `longhorizon` coverage is intentionally small.
- `latency` and `human_intervention_count` are tracked as declared grader intent in some cases, but they are not executable regression gates yet.
- There is no benchmark tier for live-auth Codex or live-network GitHub flows, by design.

## Related Artifacts

- [benchmarks/README.md](/Users/anf/Repos/GDH/benchmarks/README.md)
- [reports/benchmark-corpus-summary.md](/Users/anf/Repos/GDH/reports/benchmark-corpus-summary.md)
- [reports/release-candidate-report.md](/Users/anf/Repos/GDH/reports/release-candidate-report.md)
