# Governed Delivery Control Plane

This repository is a Codex-first governed execution layer for agentic software delivery. It now implements the local Phase 4 loop: normalize and plan the work, preview likely impact, evaluate repo policy, gate approvals, execute inside the approved boundary, verify deterministically, and persist enough durable state to inspect, pause, interrupt, and resume a run safely.

## Phase 4 Status

The local governed flow now includes:

- spec normalization into a durable `Spec`
- deterministic plan generation
- read-only impact preview before write-capable execution
- YAML policy evaluation under `policies/`
- interactive or fail-fast approval handling inside `gdh run`
- write-capable execution through the configured runner
- changed-file capture, diff capture, command capture, and post-run policy audit
- deterministic verification with persisted `verification.result.json`
- evidence-based review packet generation in JSON and Markdown
- durable `session.manifest.json` state per run
- restart-safe checkpoints under `checkpoints/`
- progress snapshots with `progress.latest.json`
- workspace continuity snapshots and continuity assessments
- `gdh status <run-id>` for durable inspection
- `gdh resume <run-id>` for continuing approval-paused or interrupted runs from a safe boundary
- explicit re-verification through `gdh verify <run-id>`

Phase 4 still stays deliberately narrow:

- no GitHub draft PR creation yet
- no benchmark or regression gating yet
- no dashboard or analytics work yet
- no multi-agent orchestration yet
- no background queues or daemons
- no cloud infrastructure
- the artifact store is still local and file-backed for now, even though later phases may add stronger indexing

## CLI Surface

Primary commands:

```bash
gdh run <spec-file> [--runner codex-cli|fake] [--approval-mode interactive|fail] [--policy <policy-file>] [--json]
gdh status <run-id> [--json]
gdh resume <run-id> [--json]
gdh verify <run-id> [--json]
```

From a source checkout, the practical local wrapper is:

```bash
pnpm gdh run <spec-file> [--runner codex-cli|fake] [--approval-mode interactive|fail] [--policy <policy-file>] [--json]
pnpm gdh status <run-id> [--json]
pnpm gdh resume <run-id> [--json]
pnpm gdh verify <run-id> [--json]
```

Current options:

- `--runner codex-cli` uses the local Codex CLI via `codex exec`
- `--runner fake` uses the deterministic fake runner for CI-safe tests and smoke checks
- `--approval-mode interactive` pauses in the CLI and asks a human to approve or deny prompted work
- `--approval-mode fail` persists the approval packet, leaves the run in `awaiting_approval`, and exits non-zero
- `--policy <policy-file>` points at a repo-local YAML policy pack; the default is `policies/default.policy.yaml`
- `--json` prints the terminal summary as JSON

## Durable Run Model

Each run writes durable state under `runs/local/<run-id>/`.

Key Phase 4 artifacts:

- `run.json`: current persisted run record
- `events.jsonl`: append-only lifecycle events
- `session.manifest.json`: compact durable run/session manifest for `status` and `resume`
- `sessions/<session-id>.json`: one record per initial or resumed invocation
- `progress.latest.json`: latest progress snapshot
- `progress/<progress-id>.json`: progress history
- `checkpoints/<checkpoint-id>.json`: restart-safe checkpoint history
- `workspace.latest.json`: latest workspace continuity snapshot
- `continuity/<assessment-id>.json`: workspace continuity assessments
- `resume/<plan-id>.json`: persisted resume plans

Existing execution and verification artifacts still remain first-class:

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

## Checkpoints

Checkpoints are written only at safe boundaries:

1. after spec normalization
2. after plan generation
3. after policy evaluation
4. after approval resolution
5. after post-run execution artifacts are complete
6. after verification result persistence

The system does not attempt arbitrary mid-process continuation inside a failed subprocess. Resume always starts from the next safe stage recorded in durable state.

## Progress Snapshots

`progress.latest.json` and the historical `progress/*.json` snapshots summarize:

- what just completed
- what remains
- current blockers and risks
- current approved scope
- verification state
- related artifact paths
- the next recommended step

Snapshots are written at least for:

- plan creation
- policy evaluation
- approval request
- runner start
- runner completion
- verification start
- verification completion
- interruption detection
- resume start
- resume end

## `gdh status`

`gdh status <run-id>` reads durable artifacts only. It does not need live Codex access.

It reports:

- run status
- current stage
- last completed stage
- next stage
- approval state
- verification state
- resume eligibility
- latest progress summary
- key artifact paths

If it detects that a previous invocation stopped while the manifest still said `created`, `planning`, `in_progress`, `resuming`, or `verifying`, it records that interruption explicitly and reevaluates resumability from the last safe checkpoint.

## `gdh resume`

`gdh resume <run-id>`:

1. loads the session manifest, latest progress snapshot, and last checkpoint
2. performs workspace continuity checks
3. evaluates deterministic resume eligibility
4. creates a new resume session record
5. resumes from the next safe stage
6. updates the manifest, progress snapshots, checkpoints, and events as it continues

Resume behavior is conservative:

- approval-paused runs continue through the existing approval artifact
- approved runs reuse the persisted approval evidence
- post-run interruptions resume into verification from a clean verification boundary
- incompatible continuity or missing critical artifacts stop the resume cleanly

## Continuity Checks

Phase 4 continuity checks are lightweight and honest. They compare persisted state against the current repo and classify the result as:

- `compatible`
- `warning`
- `incompatible`

Signals checked:

- repository root path
- git HEAD, when available
- dirty working tree state, when available
- known run-changed files
- presence of required artifacts for the next safe stage

Current limitations:

- repos without a valid git HEAD degrade to a warning-based assessment instead of a strong compatibility verdict
- continuity checks are designed to avoid blind resumes, not to guarantee bit-for-bit reproducibility

## Verification Guarantees

Phase 2 and Phase 3 guarantees remain intact:

- policy evaluation still happens before write-capable execution
- prompted work still requires approval evidence
- `completed` still requires a persisted passing `VerificationResult`
- `gdh verify <run-id>` still re-runs deterministic verification and refreshes the packet artifacts
- review packets remain evidence-backed and conservative

## Smoke Paths

Safe local smoke path:

```bash
pnpm gdh run runs/fixtures/phase2-policy-smoke-spec.md --runner fake --approval-mode fail
```

Inspect an existing run:

```bash
pnpm gdh status <run-id>
```

Resume a paused or interrupted run:

```bash
pnpm gdh resume <run-id>
```

Re-verify an existing run:

```bash
pnpm gdh verify <run-id>
```

## Validation

The root workspace validation flow still runs from the repo root:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm validate`

## Repository Operating Surface

The repo is still designed for long-horizon Codex work:

- `AGENTS.md` defines project purpose, boundaries, commands, and done criteria.
- `PLANS.md` holds the durable implementation plan for the current phase.
- `implement.md` defines the implementation runbook.
- `documentation.md` is the live audit log.
- `.codex/config.toml` provides conservative local Codex defaults.

## What Remains For Phase 5

Phase 5 should add normal GitHub packaging around the now-durable run flow:

- issue ingestion
- branch naming
- draft PR creation
- injecting the review packet into PR context

Benchmarking, regression gating, dashboards, analytics, and orchestration still remain later work after the GitHub workflow phase.
