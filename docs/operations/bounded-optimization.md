# Bounded Optimization Workflow

The bounded optimization loop exists to evaluate narrowly scoped self-improvement candidates against the persisted benchmark corpus without granting the system broad autonomy.

## Current Mutable Surface

Only the following repo path is mutable through `gdh optimize`:

- `config/optimization/impact-preview-hints.json`

That file contains deterministic impact-preview routing hints that influence pre-run path prediction before policy evaluation. It is config-only, reviewable, and benchmark-visible.

Everything else is blocked by default, including:

- `apps/**`
- `packages/**`
- `scripts/**`
- `benchmarks/**`
- `policies/**`
- `gdh.config.json`
- destructive command rules
- approval, verification, persistence, GitHub delivery, and security-sensitive logic

## Candidate Format

`gdh optimize run` consumes an explicit candidate manifest JSON file. The manifest points to one or more payload files relative to the manifest directory.

Example:

```json
{
  "version": 1,
  "id": "docs-auth-hint",
  "title": "Docs Task Protected Auth Hint",
  "summary": "Route docs-class protected auth requests into the approval surface before execution.",
  "files": [
    {
      "path": "config/optimization/impact-preview-hints.json",
      "sourcePath": "files/impact-preview-hints.json"
    }
  ],
  "notes": ["Optional human notes."]
}
```

The workflow rejects the candidate before benchmarking if any target path falls outside the configured allowlist.

## Commands

```bash
pnpm gdh optimize run <candidate-manifest> [--json]
pnpm gdh optimize compare <optimization-run-id> [--json]
pnpm gdh optimize decide <optimization-run-id> [--json]
```

## Workflow

1. Load `gdh.optimize.json` and the candidate manifest.
2. Audit the candidate target paths against the allowlisted optimization surface.
3. If the candidate escapes the allowlist, write a blocked run and reject it immediately.
4. If the candidate stays inside the allowlist, copy the bounded runtime inputs into a temporary evaluation workspace.
5. Apply the candidate in that temporary workspace only.
6. Run the configured benchmark target, currently `smoke`, in CI-safe mode.
7. Compare the candidate benchmark run against the persisted suite baseline.
8. Write the candidate snapshot, audit, baseline copy, benchmark artifacts, comparison, decision, and notes under `runs/optimizations/<run-id>/`.

The workflow records evidence but does not auto-apply accepted candidates back onto the main repo checkout.

## Decision Rules

A candidate is rejected when any of the following is true:

- it touches a path outside the configured optimization surface
- the benchmark comparison is missing or ambiguous
- the candidate does not improve the benchmark score
- the candidate ties the baseline score
- any protected metric regresses
- the benchmark regression result fails

Protected metrics are currently:

- `success`
- `policy_correctness`
- `verification_correctness`
- `packet_completeness`
- `artifact_presence`

The tie-break policy is intentionally conservative: ties reject.

## Artifacts

Each optimization run persists under `runs/optimizations/<run-id>/` with:

- `optimization.run.json`
- `resolved-config.json`
- `candidate.manifest.json`
- `candidate.audit.json`
- `candidate/files/**`
- `baseline/benchmark.run.json`
- `baseline/ref.json`
- `benchmark/run/benchmark.run.json`
- `benchmark/run/comparison.report.json`
- `benchmark/run/regression.result.json`
- `decision.json`
- `notes.md`

These artifacts are the durable source of truth for why a candidate was kept or rejected.
