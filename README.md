# Governed Delivery Control Plane

Version: `0.8.0-rc.1`

This repository is a Codex-first governed execution layer for agentic software delivery. It plans work, evaluates policy before write-capable execution, records durable artifacts, re-verifies results, packages evidence for review, runs deterministic benchmark suites, and exposes a local dashboard over those persisted artifacts.

Phase 8 is the current boundary for this repo: release hardening, packaging, demo readiness, conservative defaults, and documentation polish on top of the completed Phase 1-7 control plane.

## What The Release Candidate Includes

- `gdh run <spec-file>` for governed local runs from markdown specs
- `gdh run --github-issue <owner/repo#123>` for GitHub issue ingestion into the same governed flow
- YAML policy packs under `policies/` with allow, prompt, and forbid decisions
- approval packets and durable approval state for protected work
- deterministic verification and persisted `verification.result.json`
- durable manifests, checkpoints, progress snapshots, continuity checks, `gdh status`, and `gdh resume`
- evidence-based review packets plus draft-PR-only GitHub delivery and local `/gdh iterate` handling
- deterministic benchmark execution, comparison, and regression gating under `benchmarks/`
- a local API plus dashboard for overview, runs, approvals, benchmarks, and failure taxonomy
- release-candidate scripts for validation, demo preparation, and local source packaging

## Non-Goals For This Release Candidate

- no autonomous merge or deploy automation
- no hosted multi-user control plane
- no background workers, daemons, or webhook processors
- no multi-agent orchestration
- no broad self-optimization loop
- no hidden network access by default

## Quick Start

### Requirements

- Node.js `20` or newer
- pnpm `10` or newer
- a local Git checkout
- optional: Codex CLI auth for live `--runner codex-cli` runs
- optional: `GITHUB_TOKEN` for GitHub issue or PR workflows

### Install

```bash
git clone <repo-url>
cd GDH
pnpm bootstrap
```

`pnpm bootstrap` performs a frozen-lockfile install and prepares the tracked local directories used by runs, reports, and docs.

### Validate

```bash
pnpm release:validate
```

That runs:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm benchmark:smoke`

### Run The Local Demo

```bash
pnpm demo:prepare
pnpm dashboard:dev
```

`pnpm demo:prepare` builds the workspace, runs the deterministic release-candidate demo spec, runs the smoke benchmark suite, and writes a local summary to `reports/release/demo-prep.latest.json`.

Then start the dashboard:

- API: `http://localhost:3000`
- Web UI: `http://localhost:5173`

The dashboard reads only from persisted local artifacts under:

- `runs/local/`
- `runs/benchmarks/`

## Example Use Case

The shortest honest pitch for GDH is this: a team wants Codex to work on a real issue, but it does not want planning, policy, verification, and review evidence to disappear into a chat transcript.

### From GitHub Issue To Governed Draft PR

1. Start a governed run from a real issue:

```bash
pnpm gdh run --github-issue acme/payments#184 --runner codex-cli
```

GDH ingests the issue, normalizes it into a shared spec, generates a bounded plan, predicts likely impact, evaluates repo policy before write-capable execution, and persists the artifacts locally under `runs/local/<run-id>/`.

2. Inspect the run state:

```bash
pnpm gdh status <run-id>
```

If the task touches a protected area, GDH pauses at the approval boundary and writes an approval packet instead of continuing silently.

3. Continue from the checkpoint when a reviewer is ready:

```bash
pnpm gdh resume <run-id>
```

In an interactive terminal, a human can approve or deny the paused run. Low-risk work can continue without that stop when policy allows it.

4. Publish only after verification passes:

```bash
pnpm gdh pr create <run-id>
```

Eligible runs can be packaged into a draft PR with the review packet attached. Unverified runs do not get published.

5. Inspect everything locally:

```bash
pnpm dashboard:dev
```

The dashboard reads the same persisted run, approval, verification, and benchmark artifacts, so leads and reviewers can inspect what happened without replaying the session.

This is the core product story: GDH is the control plane between "give the agent an issue" and "open a reviewable draft PR."

For a fuller narrative you can reuse in demos or outreach, see [docs/demos/issue-to-draft-pr-example.md](/Users/anf/Repos/GDH/docs/demos/issue-to-draft-pr-example.md).

## Command Surface

The practical source-checkout wrapper is `pnpm gdh ...`.

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

Current GitHub behavior stays conservative:

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

The maintained benchmark corpus now has three explicit tiers:

- `smoke`: deterministic CI-safe control-plane coverage
- `fresh`: recent real repo tasks curated into deterministic fixture-backed cases
- `longhorizon`: broader multi-file tasks for intentional benchmark runs

Benchmark intake, quality rules, and fixture hygiene live in [benchmarks/README.md](/Users/anf/Repos/GDH/benchmarks/README.md). The current corpus inventory, rejection decisions, and weak spots live in [reports/benchmark-corpus-summary.md](/Users/anf/Repos/GDH/reports/benchmark-corpus-summary.md).

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

`pnpm release:package` creates a versioned source bundle and release manifest in `reports/release/`.

## Configuration

### Repo-Local Config

`gdh.config.json` is committed and authoritative for:

- verification commands
- GitHub delivery defaults
- benchmark regression thresholds

### Environment

Copy `.env.example` to `.env.local` if you want repo-local overrides.

Supported variables:

- `API_PORT` for the local API server
- `WEB_PORT` for the local dashboard dev server
- `GITHUB_TOKEN` for GitHub issue or PR flows
- `GITHUB_API_URL` for GitHub Enterprise or a non-default API root

Unsupported or misleading env toggles were intentionally removed from `.env.example`. Codex runner defaults live in `.codex/config.toml`, not in ad hoc environment variables.

### Conservative Defaults

The repo ships conservative Codex defaults in `.codex/config.toml`:

- model: `gpt-5.4`
- approval policy: `on-request`
- sandbox mode: `workspace-write`
- network access: `false`

## Architecture Summary

High-level flow:

1. Normalize a spec or GitHub issue into a durable `Spec`.
2. Generate a bounded `Plan`.
3. Evaluate policy and produce an impact preview plus approval packet when needed.
4. Execute through the configured runner.
5. Persist diff, changed-file, command, policy-audit, and session artifacts.
6. Run deterministic verification.
7. Generate a review packet.
8. Optionally package the verified run for draft-PR delivery.
9. Expose persisted run and benchmark state through the local API and dashboard.

Key packages:

- `apps/cli`: governed CLI entrypoint
- `apps/api`: local Fastify inspection API
- `apps/web`: local React/Vite dashboard
- `packages/domain`: shared schemas and lifecycle contracts
- `packages/artifact-store`: file-backed persistence and dashboard query layer
- `packages/policy-engine`: policy parsing, previewing, evaluation, and audit helpers
- `packages/verification`: deterministic verification engine
- `packages/github-adapter`: thin GitHub delivery boundary
- `packages/evals`: benchmark execution, comparison, and regression logic

Current internal seams for the main refactor hotspots:

- `apps/cli`: `src/index.ts` stays a tiny public entrypoint; `src/program.ts` holds command composition while extracted helpers such as `src/types.ts`, `src/git.ts`, and `src/summaries.ts` keep option contracts, git behavior, and terminal formatting out of the entry surface.
- `packages/domain`: `src/values.ts` holds shared enum arrays, `src/contracts.ts` holds the canonical schema surface, `src/specs.ts` owns spec normalization and plan creation, and `src/runs.ts` owns run/session/checkpoint factories.
- `packages/policy-engine`: `src/loading.ts`, `src/preview.ts`, `src/matching.ts`, `src/approval.ts`, and `src/audit.ts` separate policy-pack IO, predictive previewing, rule evaluation, approval artifact rendering, and post-run audit work behind a small `src/index.ts`.
- `packages/verification`: `src/config.ts`, `src/commands.ts`, `src/claims.ts`, `src/completion.ts`, and `src/orchestrator.ts` separate config loading, command execution, claim checks, completion gating, and overall verification orchestration.
- `packages/evals`: `src/scoring.ts`, `src/workspace.ts`, `src/comparison.ts`, and `src/service.ts` separate benchmark scoring, fixture workspace setup, run comparison, and benchmark-run orchestration.

More detail:

- architecture overview: [docs/architecture/release-candidate-overview.md](/Users/anf/Repos/GDH/docs/architecture/release-candidate-overview.md)
- lifecycle refactor RFC: [docs/architecture/run-lifecycle-service-rfc.md](/Users/anf/Repos/GDH/docs/architecture/run-lifecycle-service-rfc.md)
- benchmark report: [docs/benchmark-report.md](/Users/anf/Repos/GDH/docs/benchmark-report.md)
- demo walkthrough: [docs/demos/README.md](/Users/anf/Repos/GDH/docs/demos/README.md)
- security and conservative-ops notes: [SECURITY.md](/Users/anf/Repos/GDH/SECURITY.md)

## Artifact Model

Governed runs persist under `runs/local/<run-id>/`.

Important artifacts include:

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

- No hosted or multi-user environment exists yet.
- No background worker or queue infrastructure exists yet.
- No merge, deploy, branch deletion, or force-push automation exists.
- Command capture from the live Codex runner remains partially self-reported.
- Verification is deterministic and evidence-based, but it is not a formal proof of correctness.
- `/gdh iterate` handling is local-operator initiated and comment-prefix based.
- Resume works only from explicit safe checkpoints.
- The dashboard is read-only over persisted artifacts; it does not mutate run state.
- The seeded benchmark suite is still the smoke suite only; richer `fresh` and `longhorizon` suites remain future work.

## Release Candidate Workflow

Use this sequence on a clean checkout:

```bash
pnpm bootstrap
pnpm release:validate
pnpm demo:prepare
pnpm release:package
```

That gives you:

- a verified workspace build
- a fresh demo governed run
- a fresh smoke benchmark run
- a versioned source bundle in `reports/release/`

## License And Status

- Version: `0.8.0-rc.1`
- License: `UNLICENSED`
- Status: local release candidate for portfolio demos, technical review, and careful early use
