# Governed Delivery Control Plane

This repository is a Codex-first governed execution layer for agentic software delivery. It now implements the local Phase 3 loop: normalize and plan the work, preview likely impact, evaluate repo policy, gate approvals, execute inside the approved boundary, run deterministic verification, and generate evidence-based review packets before a run can be marked complete.

## Phase 3 Status

The local governed flow now includes:

- spec normalization into a durable `Spec`
- deterministic plan generation
- read-only impact preview before write-capable execution
- YAML policy evaluation under `policies/`
- interactive or fail-fast approval handling inside `gdh run`
- write-capable execution through the configured runner
- changed-file capture, diff capture, command capture, and post-run policy audit
- deterministic verification with persisted `verification.result.json`
- configured verification commands from `gdh.config.json`
- deterministic claim verification and packet completeness checks
- evidence-based review packet generation in JSON and Markdown
- explicit re-verification through `gdh verify <run-id>`

Phase 3 still stays deliberately narrow:

- no durable approval queue or resume flow yet
- no SQLite-backed run store yet
- no GitHub draft PR creation yet
- no benchmark or regression gating
- no multi-agent orchestration

## CLI Surface

Primary commands:

```bash
gdh run <spec-file> [--runner codex-cli|fake] [--approval-mode interactive|fail] [--policy <policy-file>] [--json]
gdh verify <run-id> [--json]
```

From a source checkout, the practical local wrapper is:

```bash
pnpm gdh run <spec-file> [--runner codex-cli|fake] [--approval-mode interactive|fail] [--policy <policy-file>] [--json]
pnpm gdh verify <run-id> [--json]
```

Current options:

- `--runner codex-cli` uses the local Codex CLI via `codex exec`
- `--runner fake` uses the deterministic fake runner for CI-safe tests and smoke checks
- `--approval-mode interactive` pauses in the CLI and asks a human to approve or deny prompted work
- `--approval-mode fail` persists the approval packet, leaves the run in `awaiting_approval`, and exits non-zero
- `--policy <policy-file>` points at a repo-local YAML policy pack; the default is `policies/default.policy.yaml`
- `--json` prints the terminal summary as JSON

## Governed Run Sequence

`gdh run` now follows this order:

1. validate and normalize the spec
2. create the deterministic plan
3. write the initial run record and planning artifacts
4. generate `impact-preview.json`
5. evaluate the preview against the selected policy pack
6. if the decision is `prompt`, persist approval artifacts and resolve or stop
7. if execution is allowed, run the write-capable runner
8. capture changed files, `diff.patch`, command evidence, and `policy-audit.json`
9. move the run into `verifying`
10. execute configured verification commands
11. run deterministic diff, policy, claim, packet, and artifact completeness checks
12. write verification artifacts and the final review packet
13. mark the run terminal only after a persisted `VerificationResult` exists

`gdh verify <run-id>` reloads an existing run, re-executes the configured verification commands, re-runs the deterministic verification checks, persists a fresh `verification.result.json`, updates the review packet outputs, appends verification events, and exits non-zero if any mandatory verification check fails.

## Verification Configuration

Repo-local verification commands live in [`gdh.config.json`](/workspace/GDH/gdh.config.json).

Example:

```json
{
  "verification": {
    "preflight": ["pnpm lint", "pnpm typecheck"],
    "postrun": ["pnpm test"],
    "optional": ["pnpm test:e2e"]
  }
}
```

Rules:

- `preflight` and `postrun` commands are mandatory
- `optional` commands are recorded but do not block completion on their own
- every configured command records command text, exit code, duration, status, and stdout/stderr artifacts
- a run fails verification if no mandatory verification commands are configured

## Verification Gates

Every executed run is checked for:

- configured mandatory verification commands executed
- diff presence and git-style parsability
- policy-compliance confirmation from Phase 2 artifacts
- deterministic review-packet claim verification
- review-packet completeness
- run artifact completeness

`completed` is strictly blocked unless verification produces a persisted passing `VerificationResult`.

## Review Packet Rules

Review packets are generated from structured evidence, not broad model narration. The packet includes:

- objective
- plan summary
- files changed
- tests and checks run
- policy decisions
- approvals required and granted
- risks and open questions
- verification summary
- claim verification summary
- limitations and unresolved issues
- rollback hint

Allowed claim categories are limited to evidence-backed facts such as:

- files changed
- commands and checks executed
- approval state
- policy decisions
- verification outcomes

Disallowed broad claims without explicit evidence include:

- `safe`
- `production-ready`
- `fully resolves all edge cases`
- `complete`
- `verified`

If the raw runner summary contains unsupported certainty language, verification fails and the packet replaces that narration with an evidence-based note instead of repeating the unsupported claim.

## Artifacts

Each run writes evidence under `runs/local/<run-id>/`, including:

- `run.json`
- `events.jsonl`
- `spec.normalized.json`
- `plan.json`
- `impact-preview.json`
- `policy.input.json`
- `policy.decision.json`
- `approval-packet.json` when prompting is required
- `approval-packet.md` when prompting is required
- `approval-resolution.json` when an interactive approval is resolved
- `runner.prompt.md` when the runner executes
- `runner.stdout.log` when the runner executes
- `runner.stderr.log` when the runner executes
- `runner.result.json`
- `commands-executed.json`
- `changed-files.json`
- `diff.patch`
- `policy-audit.json`
- `verification/commands/*.stdout.log`
- `verification/commands/*.stderr.log`
- `claim-checks.json`
- `packet-completeness.json`
- `verification.checks.json`
- `verification.result.json`
- `review-packet.json`
- `review-packet.md`

## Verification Failure Causes

A run fails deterministic verification when any mandatory check fails, for example:

- a mandatory verification command exits non-zero
- the diff artifact is missing or not parsable
- approval was required but no approved resolution exists
- the post-run policy audit records a policy breach
- the review packet omits required sections
- the packet or raw runner summary contains unsupported certainty claims
- expected run artifacts are missing

## Smoke Paths

Safe local smoke path:

```bash
pnpm gdh run runs/fixtures/phase2-policy-smoke-spec.md --runner fake --approval-mode fail
```

Re-verify an existing run:

```bash
pnpm gdh verify <run-id>
```

If you want to exercise the prompt flow locally, point a spec at a protected path such as `src/auth/**` and run:

```bash
pnpm gdh run <spec-file> --runner fake --approval-mode interactive
```

## Validation

The root workspace validation flow still runs from the repo root:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm validate`

## Repository Operating Surface

The repo is still designed for resumable Codex work:

- [`AGENTS.md`](/workspace/GDH/AGENTS.md) defines project purpose, boundaries, commands, and done criteria.
- [`PLANS.md`](/workspace/GDH/PLANS.md) holds the durable implementation plan for the current phase.
- [`implement.md`](/workspace/GDH/implement.md) defines the implementation runbook.
- [`documentation.md`](/workspace/GDH/documentation.md) is the live audit log.
- [`.codex/config.toml`](/workspace/GDH/.codex/config.toml) provides conservative local Codex defaults.

## What Remains For Phase 4

Phase 4 should add durable state and resume without rewriting the Phase 3 run flow:

- durable run and approval state
- resume support for interrupted runs
- more durable artifact indexing and replay surfaces

GitHub draft PR automation, broader release-side effects, regression suites, benchmarks, and orchestration still remain later work after the durability phase.
