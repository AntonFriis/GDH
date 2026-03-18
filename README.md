# Governed Delivery Control Plane

This repository is a Codex-first governed execution layer for agentic software delivery. It now implements the local Phase 7 loop: governed runs remain artifact-backed and local-first, and the repo adds a lightweight dashboard plus analytics layer that makes approvals, verification, GitHub draft-PR delivery, and benchmark outcomes legible without reading raw JSON files first.

## Phase 7 Status

The local governed flow now includes:

- spec normalization from local markdown or `--github-issue`
- deterministic plan generation
- read-only impact preview before write-capable execution
- YAML policy evaluation under `policies/`
- interactive or fail-fast approval handling inside `gdh run`
- write-capable execution through the configured runner
- changed-file capture, diff capture, command capture, and post-run policy audit
- deterministic verification with persisted `verification.result.json`
- evidence-based review packet generation in JSON and Markdown
- durable `session.manifest.json` state per run
- restart-safe checkpoints, progress snapshots, and continuity artifacts
- `gdh status <run-id>` for durable inspection
- `gdh resume <run-id>` for continuing approval-paused or interrupted runs from a safe boundary
- `gdh verify <run-id>` for deterministic re-verification
- branch preparation and draft PR creation through `gdh pr create <run-id>`
- PR body and supplemental comment publication through `gdh pr sync-packet <run-id>`
- conservative PR comment ingestion and `/gdh iterate` normalization through `gdh pr comments <run-id>` and `gdh pr iterate <run-id>`
- benchmark suite and case loading from repo-local YAML artifacts under `benchmarks/`
- `gdh benchmark run <suite-or-case>` for deterministic benchmark execution and persisted score breakdowns
- `gdh benchmark compare <lhs> <rhs>` and `gdh benchmark compare --against-baseline <run-id>` for persisted comparison and regression reports
- `gdh benchmark show <run-id>` for artifact-only benchmark inspection
- CI-safe smoke benchmark execution through fixture repos and the fake runner only
- a local Fastify-backed dashboard read surface over persisted run and benchmark artifacts
- overview, runs, approvals, benchmarks, failure taxonomy, and run/benchmark detail views in `apps/web`
- artifact-derived analytics for run counts, approval-required runs, verification failures, draft PR counts, and benchmark regressions
- artifact preview links for review packets, approval packets, verification results, GitHub metadata artifacts, and benchmark reports when those files are locally previewable

Phase 7 still stays deliberately narrow:

- draft PRs only
- no auto-merge
- no deploy hooks
- no multi-agent orchestration yet
- no hosted eval platform or cloud benchmark dependency
- no broad self-optimization or autotuning loop
- no background queues, daemons, webhooks, or hosted services
- the artifact store is still local and file-backed for now, even though later phases may add stronger indexing

## Local Dashboard

Start the dashboard from the workspace root:

```bash
pnpm dashboard:dev
```

That runs:

- the local API on port `3000`
- the Vite dashboard on port `5173`

The dashboard reads only from persisted local artifacts under:

- `runs/local/`
- `runs/benchmarks/`

The data path stays intentionally thin:

- `packages/domain` defines explicit dashboard read-model types
- `packages/artifact-store` aggregates run and benchmark artifacts into those views
- `apps/api` exposes the read models through local endpoints
- `apps/web` renders those views with lightweight routing and filtering

Current pages:

- overview
- runs list
- run detail
- approvals
- benchmarks list
- benchmark detail
- failure taxonomy

## CLI Surface

Primary commands:

```bash
gdh run [<spec-file>] [--github-issue <owner/repo#123>] [--runner codex-cli|fake] [--approval-mode interactive|fail] [--policy <policy-file>] [--json]
gdh status <run-id> [--json]
gdh resume <run-id> [--json]
gdh verify <run-id> [--json]
gdh pr create <run-id> [--branch <branch-name>] [--base-branch <base-branch>] [--json]
gdh pr sync-packet <run-id> [--comment-id <comment-id>] [--json]
gdh pr comments <run-id> [--json]
gdh pr iterate <run-id> [--json]
gdh benchmark run <suite-or-case> [--ci-safe] [--json]
gdh benchmark compare <lhs> [<rhs>] [--against-baseline] [--json]
gdh benchmark show <run-id> [--json]
```

From a source checkout, the practical local wrapper is:

```bash
pnpm gdh run [<spec-file>] [--github-issue <owner/repo#123>] [--runner codex-cli|fake] [--approval-mode interactive|fail] [--policy <policy-file>] [--json]
pnpm gdh status <run-id> [--json]
pnpm gdh resume <run-id> [--json]
pnpm gdh verify <run-id> [--json]
pnpm gdh pr create <run-id> [--branch <branch-name>] [--base-branch <base-branch>] [--json]
pnpm gdh pr sync-packet <run-id> [--comment-id <comment-id>] [--json]
pnpm gdh pr comments <run-id> [--json]
pnpm gdh pr iterate <run-id> [--json]
pnpm gdh benchmark run <suite-or-case> [--ci-safe] [--json]
pnpm gdh benchmark compare <lhs> [<rhs>] [--against-baseline] [--json]
pnpm gdh benchmark show <run-id> [--json]
```

Current options:

- `--github-issue <owner/repo#123>` resolves a GitHub issue, materializes a durable local source snapshot, and runs the normal governed flow from that input.
- `--runner codex-cli` uses the local Codex CLI via `codex exec`.
- `--runner fake` uses the deterministic fake runner for CI-safe tests and smoke checks.
- `--approval-mode interactive` pauses in the CLI and asks a human to approve or deny prompted work.
- `--approval-mode fail` persists the approval packet, leaves the run in `awaiting_approval`, and exits non-zero.
- `--policy <policy-file>` points at a repo-local YAML policy pack; the default is `policies/default.policy.yaml`.
- `--branch` and `--base-branch` override the default branch derivation during draft PR creation.
- `--comment-id` updates an existing supplemental PR comment instead of creating a new one during `pr sync-packet`.
- `benchmark run <suite-or-case>` accepts either a suite id or a single case id; `--ci-safe` forces deterministic fixture mode.
- `benchmark compare <lhs> <rhs>` compares two persisted benchmark runs, while `benchmark compare <run-id> --against-baseline` resolves the suite baseline from the run metadata or the suite definition.
- `benchmark show <run-id>` re-loads a persisted benchmark run plus any current comparison/regression artifacts without re-running cases.
- `--json` prints the terminal summary as JSON.

## GitHub Configuration

GitHub integration is explicit and fails closed when configuration is missing.

Environment variables:

- `GITHUB_TOKEN` is required for GitHub issue ingestion, draft PR creation, PR body/comment publication, and PR comment reads.
- `GITHUB_API_URL` is optional for GitHub Enterprise or other non-default API roots.

Repo-local config lives in `gdh.config.json`:

```json
{
  "verification": {
    "preflight": ["pnpm lint", "pnpm typecheck"],
    "postrun": ["pnpm test"],
    "optional": ["pnpm test:e2e"]
  },
  "github": {
    "defaultBaseBranch": "main",
    "iterationCommandPrefix": "/gdh iterate"
  },
  "benchmark": {
    "thresholds": {
      "maxOverallScoreDrop": 0,
      "requiredMetrics": [
        "success",
        "policy_correctness",
        "verification_correctness",
        "packet_completeness",
        "artifact_presence"
      ],
      "failOnNewlyFailingCases": true
    }
  }
}
```

Current GitHub behavior is conservative:

- missing credentials fail clearly instead of silently no-oping
- draft PR creation stages only the run-captured changed files
- local branch switching is blocked when unrelated dirty-worktree changes are present
- PR comments are treated as iteration requests only when they start with the configured explicit prefix

## Durable Run Model

Each run writes durable state under `runs/local/<run-id>/`.

Key Phase 4 durability artifacts remain first-class:

- `run.json`
- `events.jsonl`
- `session.manifest.json`
- `sessions/<session-id>.json`
- `progress.latest.json`
- `progress/<progress-id>.json`
- `checkpoints/<checkpoint-id>.json`
- `workspace.latest.json`
- `continuity/<assessment-id>.json`
- `resume/<plan-id>.json`

Execution and verification artifacts remain first-class too:

- `spec.normalized.json`
- `plan.json`
- `impact-preview.json`
- `policy.input.json`
- `policy.decision.json`
- `approval-packet.json` / `approval-packet.md`
- `approval-resolution.json`
- `runner.prompt.md`
- `runner.stdout.log`
- `runner.stderr.log`
- `runner.result.json`
- `commands-executed.json`
- `changed-files.json`
- `diff.patch`
- `policy-audit.json`
- `verification.result.json`
- `review-packet.json`
- `review-packet.md`

Phase 5 adds GitHub delivery artifacts when that path is used:

- `github/issue.source.md`
- `github/issue.ingestion.json`
- `github/branch-prepared.json`
- `github/draft-pr.request.json`
- `github/draft-pr.result.json`
- `github/pr-body.md`
- `github/pr-comment.md`
- `github/pr-publication.json`
- `github/pr-comments.json`
- `github/iteration-requests/<id>.json`
- `github/iteration-requests/<id>.md`

Phase 6 adds benchmark artifacts under `runs/benchmarks/<benchmark-run-id>/`:

- `benchmark.run.json`
- `benchmark.suite.json`
- `events.jsonl`
- `cases/<case-id>.definition.json`
- `cases/<case-id>.result.json`
- `comparison.report.json`
- `regression.result.json`

## Benchmark Suites And Regression Gates

Benchmark definitions are repo-local artifacts rather than hard-coded test cases.

- Each suite lives under `benchmarks/<suite-id>/suite.yaml`.
- Each case lives under `benchmarks/<suite-id>/cases/<case-id>.yaml`.
- Suites can point at a baseline artifact under `benchmarks/baselines/`.
- Case execution points at deterministic spec fixtures and fixture repos so CI does not require live Codex or live GitHub.

Each case definition stays intentionally small and explicit:

- id, title, description, tags, and suite membership
- execution mode, runner, approval mode, and fixture repo path
- input spec fixture and target path
- expected governed-run outcomes such as run status, policy decision, approval state, verification status, packet status, and required artifacts
- metric weights for success, policy correctness, verification correctness, packet completeness, and artifact presence

The seeded smoke suite currently covers:

- a successful low-risk docs path
- a policy prompt path
- a policy forbid path
- a deterministic verification failure path

Threshold-based regression detection is explicit and artifact-backed:

- score drops are measured against a baseline or another benchmark run
- required metrics can fail the comparison even if the aggregate score looks acceptable
- newly failing cases can fail the regression result outright
- CI fails non-zero when those configured thresholds are exceeded

## Draft PR Eligibility

`gdh pr create <run-id>` is blocked unless all of the following are true:

- the run status is `completed`
- the run reached `verification_completed`
- `verification.result.json` recorded a passing verification status
- the durable manifest also records a passing verification state
- the review packet is `ready`
- claim verification passed
- required approval is not pending or denied
- workspace continuity is not `incompatible`
- the run captured at least one non-artifact file change
- the run does not already have a recorded draft PR

If any of those checks fail, the command stops cleanly and leaves the GitHub artifacts untouched.

## Review Packet Publication

GitHub gets a PR-safe rendering of the structured review packet rather than raw local packet markdown.

The draft PR body includes:

- objective
- summary of changes
- files changed
- verification summary
- approvals and policy summary
- risks and open questions
- limitations
- artifact references
- rollback hint

`gdh pr sync-packet <run-id>` updates that body and can publish a supplemental PR comment with a concise artifact snapshot.

## Comment-To-Iterate Loop

The comment loop is local-operator initiated and narrow by design.

- `gdh pr comments <run-id>` fetches PR comments and records them under `github/pr-comments.json`.
- Only comments that start with the configured prefix, `/gdh iterate` by default, are treated as iteration requests.
- Matching comments are normalized into structured iteration-request artifacts.
- `gdh pr iterate <run-id>` materializes a follow-up markdown input artifact that a later governed run can consume.

What this does not do:

- no webhook listeners
- no background polling
- no automatic re-run creation
- no autonomous comment handling

## Verification Guarantees

Earlier guarantees remain intact:

- policy evaluation still happens before write-capable execution
- prompted work still requires approval evidence
- `completed` still requires a persisted passing `VerificationResult`
- `gdh verify <run-id>` still re-runs deterministic verification and refreshes the packet artifacts
- review packets remain evidence-backed and conservative
- GitHub publication is additive on top of those guarantees, not a replacement for them

## Smoke Paths

Safe local smoke path:

```bash
pnpm gdh run runs/fixtures/phase2-policy-smoke-spec.md --runner fake --approval-mode fail
```

GitHub issue ingestion path:

```bash
pnpm gdh run --github-issue owner/repo#123 --runner fake --approval-mode fail
```

Draft PR publication path:

```bash
pnpm gdh pr create <run-id>
```

Sync the PR surface from the latest review packet:

```bash
pnpm gdh pr sync-packet <run-id>
```

Inspect and materialize explicit PR iteration requests:

```bash
pnpm gdh pr comments <run-id>
pnpm gdh pr iterate <run-id>
```

Phase 6 benchmark smoke path:

```bash
pnpm benchmark:smoke
pnpm gdh benchmark compare <benchmark-run-id> --against-baseline
pnpm gdh benchmark show <benchmark-run-id>
```

## Validation

The root workspace validation flow still runs from the repo root:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm validate`

The benchmark-specific smoke path is intentionally separate so it can be run locally or in CI without requiring live external services:

- `pnpm benchmark:smoke`

The dashboard-specific local startup path is separate from CLI validation:

- `pnpm dashboard:dev`

## Repository Operating Surface

The repo is still designed for long-horizon Codex work:

- `AGENTS.md` defines project purpose, boundaries, commands, and done criteria.
- `PLANS.md` holds the durable implementation plan for the current phase.
- `implement.md` defines the implementation runbook.
- `documentation.md` is the live audit log and Phase-by-phase progress ledger.
- `.codex/config.toml` provides conservative local Codex defaults.

## Dashboard Metrics

The overview and detail pages derive their metrics from persisted artifacts only.

Current top-level analytics include:

- run counts by status
- approval-required, pending, and denied counts
- verification pass/fail counts
- GitHub draft PR counts when local run artifacts recorded PR state
- benchmark regression counts
- recent run and benchmark activity

Current detail views surface:

- normalized spec and plan summaries
- timeline events from `events.jsonl`
- approval and verification summaries
- GitHub delivery state when recorded
- benchmark run linkage when a benchmark case references a governed run id
- artifact links and paths for operator inspection

Current limitations:

- older Phase 1 and Phase 2 runs are normalized conservatively because they predate some later artifact fields
- artifact preview links only open files that are locally reachable through the API preview route
- the dashboard does not mutate run state, approvals, GitHub delivery, or benchmark results
- cost and latency analytics remain omitted because the underlying artifacts do not record them reliably enough yet

## What Remains For Phase 8

Phase 8 should harden the now-functional local control plane into a cleaner external artifact:

- install and onboarding docs
- demo repo and demo flow polish
- architecture diagrams and higher-level decision docs
- benchmark reporting and packaging cleanup
- security and release notes for external readers
