# Governed Delivery Control Plane

Version: `0.8.0-rc.1`

GDH is a Codex-first governed execution layer for software-delivery work. It sits above a coding runner and turns a spec or GitHub issue into a bounded run with policy evaluation, approval stops, deterministic verification, durable artifacts, review-packet output, benchmark scoring, and a local dashboard over the resulting evidence.

This repository is in Phase 8: release hardening, packaging, demo readiness, and documentation polish on top of the already-built governed run, benchmark, and dashboard surface.

## Why This Project Exists

Coding agents can produce useful changes, but the surrounding process is usually weak: plans live in chat, policy decisions are implicit, verification is easy to skip, and review context disappears once the session ends.

GDH exists to make that process inspectable:

- normalize work into a durable spec and plan
- evaluate repo policy before write-capable execution
- require approval for protected work
- persist run, diff, checkpoint, verification, and review artifacts locally
- package verified work for careful draft-PR review rather than direct merge
- benchmark the control plane itself with deterministic fixture-backed cases

## What Makes It Distinct

- It is not another coding agent. It is the governed layer above a coding agent.
- It is local-first and artifact-first. The source of truth is persisted evidence under `runs/` and `reports/`, not a hosted control plane or a chat transcript.
- It treats policy, approvals, verification, and review packets as first-class product surfaces.
- It measures itself with deterministic benchmarks aimed at the governed workflow, not with vague anecdotal demos.

## Current Scope

The current release candidate includes:

- `gdh run <spec-file>` and `gdh run --github-issue <owner/repo#123>`
- YAML policy packs with `allow`, `prompt`, and `forbid` outcomes
- approval packets and resumable approval-paused runs
- deterministic verification with persisted `verification.result.json`
- durable manifests, checkpoints, progress snapshots, `gdh status`, and `gdh resume`
- evidence-based review packets
- draft-PR-only GitHub delivery and local `/gdh iterate` comment intake
- deterministic benchmark execution, comparison, and regression gating
- a local API and dashboard over persisted run and benchmark artifacts

## Non-Goals

This release candidate does not include:

- autonomous merge or deploy automation
- hosted multi-user infrastructure
- background workers, daemons, or webhook processors
- multi-agent orchestration
- open internet access by default
- broad self-optimization loops

## Quickstart

### Requirements

- Node.js `20` or newer
- pnpm `10` or newer
- a local Git checkout
- optional: local Codex CLI auth for live `--runner codex-cli` runs
- optional: `GITHUB_TOKEN` for GitHub issue or draft-PR flows

### Install

```bash
git clone <repo-url>
cd GDH
pnpm bootstrap
```

`pnpm bootstrap` installs dependencies with the lockfile and prepares the tracked runtime directories used by runs, reports, and docs.

### Validate

```bash
pnpm release:validate
```

That runs the main local release-candidate sweep:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm benchmark:smoke`

## How To Evaluate This Project

If you are reviewing the repo quickly, this is the shortest honest path:

1. Read this README for scope, non-goals, and the reviewer path.
2. Read [docs/architecture-overview.md](/workspace/GDH/docs/architecture-overview.md) for the system shape and why it is different from a generic coding agent wrapper.
3. Run `pnpm release:validate` to confirm the local release-candidate flow still passes.
4. Run `pnpm demo:prepare` and then [docs/demo-walkthrough.md](/workspace/GDH/docs/demo-walkthrough.md) to inspect a governed run, approval surface, verification surface, benchmark surface, and dashboard surface.
5. Read [reports/benchmark-summary.md](/workspace/GDH/reports/benchmark-summary.md) and [reports/release-candidate-report.md](/workspace/GDH/reports/release-candidate-report.md) for current evidence and remaining gaps.

The default evaluator path is local-first and does not require live GitHub or live Codex execution.

## Architecture At A Glance

The core lifecycle is:

1. Normalize a spec or GitHub issue into a durable `Spec`.
2. Generate a bounded `Plan`.
3. Evaluate policy and create an approval packet when required.
4. Execute through the configured runner.
5. Persist run state, checkpoints, diffs, commands, and policy audit artifacts.
6. Run deterministic verification before completion.
7. Render a review packet.
8. Optionally package the verified run for a draft PR.
9. Expose the persisted evidence through the local API and dashboard.

Start with the concise architecture doc:

- [docs/architecture-overview.md](/workspace/GDH/docs/architecture-overview.md)

For the more detailed release-candidate package layout:

- [docs/architecture/release-candidate-overview.md](/workspace/GDH/docs/architecture/release-candidate-overview.md)

## Demo

The default demo path is:

```bash
pnpm demo:prepare
pnpm dashboard:dev
```

`pnpm demo:prepare` builds the workspace, runs a safe fake-runner governed demo spec, runs the smoke benchmark suite, and writes a summary to [reports/release/demo-prep.latest.json](/workspace/GDH/reports/release/demo-prep.latest.json).

Because the governed demo run executes the repo’s real verification commands against the current checkout, the happy path assumes a clean or otherwise validation-ready working tree.

Use the walkthrough for the full reviewer script, including approval, verification, benchmark, dashboard, and optional GitHub steps:

- [docs/demo-walkthrough.md](/workspace/GDH/docs/demo-walkthrough.md)

## Benchmark Evidence

The benchmark surface is meant to validate the governed control plane, not to claim general autonomous coding performance.

Current corpus:

- `smoke`: `10` CI-safe cases
- `fresh`: `8` recent repo tasks normalized into deterministic cases
- `longhorizon`: `2` broader multi-file cases

Current reviewer-facing evidence:

- [reports/benchmark-summary.md](/workspace/GDH/reports/benchmark-summary.md)
- [reports/benchmark-corpus-summary.md](/workspace/GDH/reports/benchmark-corpus-summary.md)

The latest referenced suite evidence in the repo shows:

- `smoke`: `10/10` passed with score `1.00` on `2026-03-24`
- `fresh`: `8/8` passed with score `1.00` on `2026-03-23`
- `longhorizon`: `2/2` passed with score `1.00` on `2026-03-23`

## Command Surface

### Governed Runs

```bash
pnpm gdh run [<spec-file>] [--github-issue <owner/repo#123>] [--runner codex-cli|fake] [--approval-mode interactive|fail] [--policy <policy-file>] [--json]
pnpm gdh status <run-id> [--json]
pnpm gdh resume <run-id> [--json]
pnpm gdh verify <run-id> [--json]
```

### GitHub Delivery

```bash
pnpm gdh pr create <run-id> [--branch <branch-name>] [--base-branch <base-branch>] [--json]
pnpm gdh pr sync-packet <run-id> [--comment-id <comment-id>] [--json]
pnpm gdh pr comments <run-id> [--json]
pnpm gdh pr iterate <run-id> [--json]
```

GitHub behavior stays conservative:

- draft PRs only
- no merge automation
- no deploy hooks
- no background polling
- missing credentials fail clearly

### Benchmarks

```bash
pnpm gdh benchmark run <suite-or-case> [--ci-safe] [--json]
pnpm gdh benchmark compare <lhs> [<rhs>] [--against-baseline] [--json]
pnpm gdh benchmark show <run-id> [--json]
pnpm benchmark:smoke
```

### Dev And Release Scripts

```bash
pnpm dev:api
pnpm dev:web
pnpm dashboard:dev
pnpm validate
pnpm release:validate
pnpm demo:prepare
pnpm release:package
pnpm release:rc
```

## Artifact Model

Governed runs persist under `runs/local/<run-id>/`. Important artifacts include:

- `run.json`
- `events.jsonl`
- `session.manifest.json`
- `progress.latest.json`
- `plan.json`
- `impact-preview.json`
- `policy.decision.json`
- `approval-packet.*`
- `commands-executed.json`
- `changed-files.json`
- `diff.patch`
- `verification.result.json`
- `review-packet.*`
- `github/*` when GitHub delivery is used

Benchmarks persist under `runs/benchmarks/<benchmark-run-id>/`.

## Known Limitations

- Live `codex-cli` command capture remains partially self-reported.
- Verification is deterministic and evidence-backed, but it is not a proof system.
- Resume works only from explicit safe checkpoints.
- `/gdh iterate` handling is local-operator initiated and comment-prefix based.
- The dashboard is read-only over persisted artifacts; it does not mutate run state.
- GitHub draft-PR delivery exists, but the local release-candidate evidence is stronger for the offline path than for the publish-capable path because recent validation was limited by missing `GITHUB_TOKEN`.
- `smoke` is the default CI-safe regression gate; broader `fresh` and `longhorizon` coverage are available but intentionally non-default.

## Live `codex-cli` Notes

Live `--runner codex-cli` runs are optional. Before using them, make sure:

- `codex` is available on `PATH`
- the local Codex CLI session is authenticated
- `~/.codex` is writable and its local state is healthy
- you understand GDH keeps network access off by default unless policy explicitly allows it

If a live run appears stuck, inspect:

- `pnpm gdh status <run-id>`
- `runs/local/<run-id>/progress.latest.json`
- `runs/local/<run-id>/runner.stderr.log`

The observed `state_5.sqlite` missing-migration warning is a Codex-local `~/.codex` issue, not a GDH artifact-store issue.

## Status

- Version: `0.8.0-rc.1`
- License: `UNLICENSED`
- Status: local release candidate for portfolio demos, technical review, and careful early use
