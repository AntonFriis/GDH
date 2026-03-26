# Benchmark Corpus Summary

This corpus summary is part of the tracked reviewer evidence pack for the v1 showcase release.

## Session

- Date: 2026-03-23
- Objective: turn the seeded benchmark substrate into a trustworthy three-tier corpus with real fresh-task intake and durable provenance.

## Audit Snapshot

- Benchmark engine: existing YAML-defined suite and case loader under `packages/benchmark-cases`, explicit benchmark schemas in `packages/domain`, and artifact-backed execution/comparison/regression gating in `packages/evals`.
- Baseline flow: suite-local `baseline` refs resolve to versioned benchmark-run artifacts under `benchmarks/baselines/`, and regular suite runs persist comparison plus regression artifacts under `runs/benchmarks/`.
- CI smoke path: `pnpm benchmark:smoke`.
- Starting weakness before this session: only `4` runnable smoke cases, no accepted `fresh` or `longhorizon` suites, no intake workflow, thin provenance metadata, and no corpus summary artifact.

## Current Counts

- Total accepted cases: `20`
- Smoke cases: `10`
- Fresh cases: `8`
- Longhorizon cases: `2`

## Counts By Task Class

- `docs`: `7`
- `tests`: `3`
- `ci`: `2`
- `refactor`: `5`
- `release_notes`: `1`
- `triage`: `1`
- `other`: `1`

## Counts By Risk

- `low`: `14`
- `medium`: `5`
- `high`: `1`

## Graders Used

- `task_completion`: `20` accepted cases
- `tests_passing`: `17` accepted cases
- `policy_violations`: `20` accepted cases
- `review_packet_fidelity`: `20` accepted cases
- `artifact_completeness`: `20` accepted cases
- `human_intervention_count`: `10` accepted cases
- `latency`: `8` accepted cases

The executable benchmark engine still gates on `success`, `policy_correctness`, `verification_correctness`, `packet_completeness`, and `artifact_presence`. `human_intervention_count` and `latency` are recorded as explicit case-level grader intent rather than hard regression gates.

## Added This Session

- Smoke additions:
  `smoke-success-tests-helper`, `smoke-success-ci-workflow`, `smoke-success-release-notes`, `smoke-success-triage-notes`, `smoke-prompt-migration-change`, `smoke-success-refactor-helper`
- Fresh accepted cases:
  `fresh-docs-issue-to-draft-pr-example`, `fresh-ci-ignore-generated-reports-from-biome`, `fresh-tests-dashboard-loading-wait`, `fresh-refactor-approval-resume-persistence`, `fresh-refactor-tracked-file-pr-scope`, `fresh-refactor-forward-head-pr-eligibility`, `fresh-tests-command-qualified-verified-claims`, `fresh-docs-run-lifecycle-service-rfc`
- Longhorizon seed cases:
  `longhorizon-release-story-pack`, `longhorizon-lifecycle-rfc-package`
- Intake artifacts:
  `8` accepted fresh candidates and `2` rejected fresh candidates
- Metadata and hygiene upgrades:
  accepted-case provenance metadata, candidate/rejected intake schema, suite-directory validation, baseline artifacts for all three suites, and a richer control-plane fixture repo under `benchmarks/fixtures/repos/control-plane-template`

## Rejected Candidates

- `fresh-candidate-live-codex-runner`
  Rejected because it requires live Codex auth and non-default local state, which would weaken deterministic trust in the fresh corpus.
- `fresh-candidate-secrets-release-automation`
  Rejected because it touches secrets and release-automation surfaces outside the benchmark trust boundary.

## Benchmark Evidence

- Baseline seed runs:
  `benchmark-smoke-20260323T162714z-cec9f2`, `benchmark-fresh-20260323T162652z-7d4666`, `benchmark-longhorizon-20260323T162705z-c7d78b`
- Current comparison runs:
  `benchmark-smoke-20260323T162829z-765ef1`, `benchmark-fresh-20260323T162844z-58be72`, `benchmark-longhorizon-20260323T162844z-80f84e`

## Known Weak Spots

- The fresh corpus is still weighted toward docs, tests, CI/config, and bounded refactors; issue triage and review-packet maintenance coverage remain thinner.
- `latency` is now declared explicitly on the fresh corpus, but it is not yet a scored regression gate.
- There is still no dedicated benchmark tier for live-auth Codex execution or live-network GitHub flows, by design.
- Resume/status and draft-PR eligibility behaviors are represented indirectly through recent fixture-backed tasks and repo tests, but not yet as first-class benchmark cases.
- Longhorizon coverage is intentionally small and should grow carefully rather than becoming synthetic filler.

## Recommended Next Additions

- Add another fresh issue-triage or review-packet maintenance case sourced from a recent real follow-up.
- Add a fresh or longhorizon case that captures a deterministic status/resume continuity task if it can stay inside the current benchmark surface.
- Add a benchmarkable draft-PR eligibility rejection case only if it can be expressed without widening the benchmark engine beyond the governed run surface.
- Grow longhorizon with one broader multi-file docs-plus-tests package case after another real repo task provides trustworthy provenance.
