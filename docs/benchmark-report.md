# Benchmark Report

The release candidate ships with a deterministic smoke benchmark suite under `benchmarks/smoke/`.

## Purpose

The benchmark surface exists to catch regressions in the governed control plane itself, not to overclaim broad autonomous software-engineering capability.

The smoke suite focuses on the current release candidate guarantees:

- successful low-risk docs execution
- policy prompt behavior
- policy forbid behavior
- deterministic verification failure handling

## Inputs

- suite definition: `benchmarks/smoke/suite.yaml`
- baseline artifact: `benchmarks/baselines/smoke-baseline.json`
- fixture specs: `benchmarks/fixtures/specs/`
- fixture repos: `benchmarks/fixtures/repos/`

## Metrics

The current suite scores:

- `success`
- `policy_correctness`
- `verification_correctness`
- `packet_completeness`
- `artifact_presence`

## Release-Candidate Usage

Run the smoke suite from the repo root:

```bash
pnpm benchmark:smoke
```

Compare a run against the configured baseline:

```bash
pnpm gdh benchmark compare <benchmark-run-id> --against-baseline
```

Inspect an existing run without re-running it:

```bash
pnpm gdh benchmark show <benchmark-run-id>
```

## Interpretation

- The smoke suite is CI-safe and deterministic by design.
- A passing smoke run indicates the seeded governed-run surfaces still behave as expected against the tracked fixtures.
- A passing smoke run does not prove general correctness on open-ended tasks, live GitHub flows, or long-horizon real-world work.

## Latest Release-Candidate Evidence

During the Phase 8 release-hardening session on 2026-03-18:

- `benchmark-smoke-20260318T182313z-3f7930` passed with score `1.00` during `pnpm release:validate`
- `benchmark-smoke-20260318T182338z-84c115` passed with score `1.00` during `pnpm demo:prepare`

The live audit log in `documentation.md` records the full command sequence and any later benchmark evidence added by future sessions.
