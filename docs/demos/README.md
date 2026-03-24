# Demo Walkthrough

The release-candidate demo stays local, deterministic, and honest. It does not require live GitHub access or live Codex execution unless you choose to try those flows separately.

## Default Demo Path

From the repo root:

```bash
pnpm demo:prepare
```

`pnpm demo:prepare` does three things:

1. builds the workspace
2. runs `gdh run runs/fixtures/release-candidate-demo-spec.md --runner fake --approval-mode fail --json`
3. runs `gdh benchmark run smoke --ci-safe --json`

It writes a local summary to `reports/release/demo-prep.latest.json`.

Because the governed demo run uses the repo’s real verification config, the default happy path assumes the checkout is clean or at least already validation-ready before you start.

That summary is the easiest place to start after the command finishes. It records the exact demo `runId`, the exact smoke `benchmarkRunId`, and the absolute artifact directories for both outputs.

If you want the local UI after the artifacts exist, run:

```bash
pnpm dashboard:dev
```

The dashboard is an inspection step, not part of artifact generation. `pnpm demo:prepare` is the default demo path; `pnpm dashboard:dev` reads the artifacts that were already written.

## Artifact Trail After `pnpm demo:prepare`

### Start Here

- summary report: `reports/release/demo-prep.latest.json`
- the report points to:
  - `demoRun.runId`
  - `demoRun.artifactsDirectory`
  - `demoRun.manifestPath`
  - `demoRun.reviewPacketPath`
  - `demoRun.verificationResultPath`
  - `benchmarkRun.benchmarkRunId`
  - `benchmarkRun.artifactsDirectory`
  - `benchmarkRun.comparisonReportPath`
  - `benchmarkRun.regressionResultPath`

## What To Inspect

### Governed Run

- spec fixture: `runs/fixtures/release-candidate-demo-spec.md`
- tracked docs target: `docs/demos/release-candidate-demo-output.md`
- durable run artifacts: `runs/local/<run-id>/`
- key files to open first:
  - `runs/local/<run-id>/session.manifest.json`
  - `runs/local/<run-id>/verification.result.json`
  - `runs/local/<run-id>/review-packet.md`
  - `runs/local/<run-id>/policy-audit.json`

In the dashboard, open:

- `/runs/<run-id>`

You should see:

- the normalized spec summary
- the generated plan
- policy state
- verification state
- review packet links
- changed-file and diff artifacts

### Benchmark

- suite: `benchmarks/smoke/suite.yaml`
- durable benchmark artifacts: `runs/benchmarks/<benchmark-run-id>/`
- key files to open first:
  - `runs/benchmarks/<benchmark-run-id>/comparison.report.json`
  - `runs/benchmarks/<benchmark-run-id>/regression.result.json`

In the dashboard, open:

- `/benchmarks/<benchmark-run-id>`

You should see:

- overall score
- case breakdowns
- comparison/regression state
- artifact links

## What The Default Demo Covers

- a local workspace build
- one deterministic fake-runner governed run against `runs/fixtures/release-candidate-demo-spec.md`
- one deterministic smoke benchmark run
- inspectable local artifacts under `reports/release/`, `runs/local/`, and `runs/benchmarks/`

## What The Default Demo Does Not Cover

- live Codex execution
- live GitHub issue ingestion
- draft PR creation
- any required network access

Those flows exist elsewhere in the product surface, but they are optional and intentionally outside this default walkthrough.

## Optional Live `codex-cli` Prerequisites

If you want to swap the fake runner for `--runner codex-cli` during a manual demo, make sure first that:

- `codex` is available on `PATH`
- the Codex CLI session is already authenticated
- `~/.codex` is writable and not stuck on a local state-db migration problem
- you are intentionally running against the current working tree state
- you remember GDH still keeps network access off by default unless policy explicitly allows it

While a live run is in progress, GDH now mirrors compact runner updates to the terminal and persists them to `runs/local/<run-id>/progress.latest.json`. If the run stalls, inspect:

- `pnpm gdh status <run-id>`
- `runs/local/<run-id>/progress.latest.json`
- `runs/local/<run-id>/runner.stderr.log`

The known `state_5.sqlite` / missing migration warning is a Codex-local `~/.codex` issue, not a GDH run-artifact issue.

## Optional Manual Variants

### CLI-Only Demo

```bash
pnpm build
pnpm gdh run runs/fixtures/release-candidate-demo-spec.md --runner fake --approval-mode fail --json
```

### Dashboard-Only Inspection

If you already have local run or benchmark artifacts:

```bash
pnpm dashboard:dev
```

## Extra Narrative Example

- [Issue to draft PR example](/workspace/GDH/docs/demos/issue-to-draft-pr-example.md): a marketable walkthrough of GDH as the governed layer between a GitHub issue and a reviewable draft PR.

## Notes

- The demo intentionally dirties `docs/demos/release-candidate-demo-output.md` because the governed run needs a tracked workspace file to modify.
- The fake runner is a deterministic stand-in for live Codex execution. It proves the governed artifact flow, not live external side effects.
- GitHub issue ingestion and draft-PR delivery remain available, but they are not part of the default demo path because this release candidate keeps networked flows optional.
- Each new `pnpm demo:prepare` run updates `reports/release/demo-prep.latest.json` with the newest run ids and artifact paths.
