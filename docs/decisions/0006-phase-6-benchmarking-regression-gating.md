# 0006 Phase 6 Benchmarking And Regression Gating

## Status
Accepted

## Context

Phase 5 made the governed run lifecycle durable, verifiable, resumable, and publishable to GitHub draft PRs, but the repo still lacked a first-class way to measure whether changes to prompts, policy, verification, packets, or runner behavior improved or regressed the system.

The handoff calls for:

- repo-local benchmark suites
- deterministic graders
- persisted benchmark history
- CI-safe regression detection

The repository already has the pieces needed to build that measurement layer without introducing a second execution stack:

- governed local run entrypoints
- deterministic fake-runner coverage
- durable file-backed artifacts
- explicit verification and review-packet artifacts

## Decision

Implement Phase 6 benchmarking as an artifact-backed layer on top of the existing governed run flow:

- define suites and cases as versioned YAML artifacts under `benchmarks/`
- execute benchmark cases through the same governed CLI run surface rather than duplicating run logic inside the eval layer
- keep the first scoring model explicit and narrow: success state, policy correctness, verification correctness, packet completeness, and required artifact presence
- persist benchmark runs, per-case definitions, per-case results, comparison reports, and regression results under `runs/benchmarks/`
- support deterministic baseline comparison and threshold-based regression failure in CI-safe mode without requiring live Codex or live GitHub

The benchmark substrate is intentionally small but real. It should be sufficient for smoke and regression gating now while leaving room for richer suites later.

## Consequences

Positive:

- meaningful control-plane changes are now measurable through persisted benchmark artifacts
- regression checks stay inspectable because metrics, weights, deltas, and failed thresholds are explicit in the artifacts
- CI can exercise benchmark smoke coverage without external service dependencies
- later phases can add richer suites and reporting surfaces without rewriting the benchmark execution model

Tradeoffs:

- the initial grading model is intentionally conservative and does not attempt long-horizon qualitative scoring yet
- the seeded suite is small and fixture-driven, so coverage is useful for smoke regression detection but not broad capability claims
- benchmark history is persisted locally as artifact directories rather than exposed through a dedicated UI or analytics surface
- live benchmark modes remain optional and outside the default CI path
