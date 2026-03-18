# Demo Walkthrough

The release-candidate demo stays local, deterministic, and honest. It does not require live GitHub access or live Codex execution unless you choose to try those flows separately.

## Fast Path

From the repo root:

```bash
pnpm demo:prepare
pnpm dashboard:dev
```

`pnpm demo:prepare` does three things:

1. builds the workspace
2. runs `gdh run runs/fixtures/release-candidate-demo-spec.md --runner fake --approval-mode fail --json`
3. runs `gdh benchmark run smoke --ci-safe --json`

It writes a local summary to `reports/release/demo-prep.latest.json`.

## What To Inspect

### Governed Run

- spec fixture: `runs/fixtures/release-candidate-demo-spec.md`
- tracked docs target: `docs/demos/release-candidate-demo-output.md`
- durable run artifacts: `runs/local/<run-id>/`

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

In the dashboard, open:

- `/benchmarks/<benchmark-run-id>`

You should see:

- overall score
- case breakdowns
- comparison/regression state
- artifact links

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

- [Issue to draft PR example](/Users/anf/Repos/GDH/docs/demos/issue-to-draft-pr-example.md): a marketable walkthrough of GDH as the governed layer between a GitHub issue and a reviewable draft PR.

## Notes

- The demo intentionally dirties `docs/demos/release-candidate-demo-output.md` because the governed run needs a tracked workspace file to modify.
- The fake runner is a deterministic stand-in for live Codex execution. It proves the governed artifact flow, not live external side effects.
- GitHub issue ingestion and draft-PR delivery remain available, but they are not part of the default demo path because this release candidate keeps networked flows optional.
