# Demo Walkthrough

This walkthrough is designed for external technical review. It exercises the main governed surfaces without requiring live GitHub access or a live Codex run.

## What This Demo Proves

- GDH can run a safe governed task end to end.
- policy and approval behavior are visible, not implicit
- verification is a required surface, not a hand-waved step
- benchmark results are persisted and inspectable
- the dashboard reads durable artifacts instead of hidden runtime state

## Default Reviewer Path

### 1. Validate the v1 baseline

```bash
pnpm release:validate
```

What to say:

- this is the local v1 validation sweep
- it checks lint, typecheck, test, build, and the smoke benchmark gate
- the default evaluator path is local-first and network-optional

### 2. Prepare fresh demo artifacts

```bash
pnpm demo:prepare
```

This builds the workspace, runs a safe fake-runner governed demo spec, runs the smoke benchmark suite, and updates `reports/release/demo-prep.latest.json`.

What to show:

- `demoRun.runId`
- `demoRun.reviewPacketPath`
- `demoRun.verificationResultPath`
- `benchmarkRun.benchmarkRunId`
- `benchmarkRun.comparisonReportPath`
- `benchmarkRun.regressionResultPath`

Important note:

- the demo run uses the repo’s real verification commands, so the happy path assumes a clean or validation-ready working tree

## Governed Run Surface

Start with the run id from `reports/release/demo-prep.latest.json`, then inspect it:

```bash
pnpm gdh status <demo-run-id> --json
pnpm gdh verify <demo-run-id> --json
```

What to highlight:

- the run has a durable id and artifact directory
- policy decision, stage, resumability, and verification status are inspectable after the fact
- verification can be re-run against the persisted artifact set

Good first files to open:

- `runs/local/<demo-run-id>/session.manifest.json`
- `runs/local/<demo-run-id>/policy-audit.json`
- `runs/local/<demo-run-id>/verification.result.json`
- `runs/local/<demo-run-id>/review-packet.md`

## Approval Surface

Run the protected-path smoke fixture:

```bash
pnpm gdh run benchmarks/fixtures/specs/smoke/smoke-policy-prompt.md --runner fake --approval-mode fail --json
```

What to highlight:

- the run stops at `awaiting_approval`
- GDH writes `approval-packet.json` and `approval-packet.md`
- the system does not silently continue into write-capable execution

If you want to show resumability on the paused run:

```bash
pnpm gdh resume <approval-paused-run-id> --json
```

What to highlight:

- resume is conservative
- unresolved approval state is preserved rather than bypassed

## Forbidden Policy Surface

Run the forbidden-path smoke fixture:

```bash
pnpm gdh run benchmarks/fixtures/specs/smoke/smoke-policy-forbid.md --runner fake --approval-mode fail --json
```

What to highlight:

- policy can block work before write-capable execution begins
- the decision is persisted as evidence under `policy.decision.json` and `policy-audit.json`

## Benchmark Surface

The fastest path is to reuse the smoke benchmark created by `pnpm demo:prepare`, but you can also run it directly:

```bash
pnpm benchmark:smoke
```

Then inspect either the benchmark id from `reports/release/demo-prep.latest.json` or the fresh id printed by the command:

```bash
pnpm gdh benchmark show <benchmark-run-id> --json
```

What to highlight:

- the benchmark is deterministic and fixture-backed
- the benchmark persists comparison and regression artifacts
- the scored metrics focus on the governed workflow:
  `success`, `policy_correctness`, `verification_correctness`, `packet_completeness`, and `artifact_presence`

Good first files to open:

- `runs/benchmarks/<benchmark-run-id>/benchmark.run.json`
- `runs/benchmarks/<benchmark-run-id>/comparison.report.json`
- `runs/benchmarks/<benchmark-run-id>/regression.result.json`

## Dashboard Surface

Start the local inspection UI:

```bash
pnpm dashboard:dev
```

Then open:

- `http://localhost:5173/runs/<demo-run-id>`
- `http://localhost:5173/benchmarks/<benchmark-run-id>`

What to highlight:

- the dashboard is derived from persisted artifacts under `runs/local/` and `runs/benchmarks/`
- it makes policy, verification, checkpoints, review packets, benchmark cases, and artifact links legible without opening raw files first
- it does not mutate run state

## Optional GitHub Draft-PR Surface

This path is supported, but it is intentionally not part of the default offline walkthrough.

Prerequisites:

- `GITHUB_TOKEN` present
- a safe repo target
- a verified eligible run
- a clean or otherwise acceptable working tree for the branch-preparation step

Command:

```bash
pnpm gdh pr create <demo-run-id> --json
```

What to highlight if the environment supports it:

- only draft PRs are created
- the review packet is packaged onto the PR surface
- GitHub metadata is persisted back into the run artifacts

What to say if the environment does not support it:

- the offline governed workflow is still the primary review target for v1
- the local repo currently carries stronger fresh evidence for the offline path than for the publish-capable path

## Short Script For A 10-Minute Review

1. `pnpm release:validate`
2. `pnpm demo:prepare`
3. Open `reports/release/demo-prep.latest.json`
4. `pnpm gdh status <demo-run-id> --json`
5. `pnpm gdh verify <demo-run-id> --json`
6. `pnpm gdh run benchmarks/fixtures/specs/smoke/smoke-policy-prompt.md --runner fake --approval-mode fail --json`
7. `pnpm dashboard:dev`
8. Open the run and benchmark pages in the browser

## Supporting Artifacts

- [architecture-overview.md](architecture-overview.md)
- [../reports/benchmark-summary.md](../reports/benchmark-summary.md)
- [../reports/v1-release-report.md](../reports/v1-release-report.md)
- [demos/issue-to-draft-pr-example.md](demos/issue-to-draft-pr-example.md)
