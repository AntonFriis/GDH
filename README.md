# Governed Delivery Control Plane

This repository is a Codex-first governed execution layer for agentic software delivery. It sits above a coding agent and is responsible for planning, running, documenting, and packaging bounded work under explicit repository rules.

## Phase 1 Status

Phase 1 is now implemented for the local run loop:

- `cp run <spec-file>` normalizes a markdown spec into a durable `Spec`
- a deterministic `Plan` is created and persisted
- a `Run` record and structured lifecycle events are written under `runs/local/<run-id>/`
- execution can be routed through `CodexCliRunner` or the deterministic `FakeRunner`
- changed files are captured from before/after workspace snapshots rather than model claims
- executed commands are captured with explicit provenance and completeness metadata
- a conservative markdown and JSON review packet is generated from run evidence

Phase 1 stays deliberately narrow:

- no real approvals or path-based policy enforcement yet
- no GitHub side effects or draft PR creation
- no multi-agent orchestration
- no resume flow
- no SQLite-backed durability yet

## Primary CLI Path

The first real CLI contract is:

```bash
cp run <spec-file> [--runner codex-cli|fake] [--json]
```

Current options:

- `--runner codex-cli` uses the local Codex CLI via `codex exec`
- `--runner fake` uses a deterministic runner for CI-safe tests and smoke checks
- `--json` prints the terminal summary as JSON

The command:

1. validates the spec path
2. normalizes the markdown spec
3. creates a run id and `runs/local/<run-id>/` workspace
4. generates a deterministic plan
5. resolves the Phase 1 placeholder policy
6. invokes the selected runner
7. persists runner logs, events, changed files, commands, and a diff
8. generates a markdown and JSON review packet
9. prints a conservative completion summary

## Supported Spec Format

Phase 1 supports markdown specs with optional frontmatter.

Useful fields:

- `title`
- `summary`
- `objective`
- `task_type`
- `constraints`
- `acceptance_criteria`
- `risk_hints`

Section headings such as `## Summary`, `## Objective`, `## Constraints`, and `## Acceptance Criteria` are also recognized. Missing fields are inferred conservatively and recorded in the normalized spec artifact.

## Smoke Example

CI-safe smoke path:

```bash
node apps/cli/dist/index.js run runs/fixtures/phase1-smoke-spec.md --runner fake
```

Live Codex CLI path when local Codex auth is available:

```bash
node apps/cli/dist/index.js run runs/fixtures/phase1-smoke-spec.md --runner codex-cli
```

The smoke fixture lives at [`runs/fixtures/phase1-smoke-spec.md`](/workspace/GDH/runs/fixtures/phase1-smoke-spec.md) and targets [`docs/demos/phase1-smoke-output.md`](/workspace/GDH/docs/demos/phase1-smoke-output.md).

## Phase 1 Artifacts

Each run writes evidence under `runs/local/<run-id>/`, including:

- `run.json`
- `events.jsonl`
- `spec.normalized.json`
- `plan.json`
- `runner.prompt.md`
- `runner.stdout.log`
- `runner.stderr.log`
- `runner.result.json`
- `changed-files.json`
- `commands-executed.json`
- `diff.patch`
- `review-packet.md`
- `review-packet.json`

## Command And Change Capture

Changed files are captured from the actual workspace state using before/after snapshots of git-tracked and non-ignored files. The current run directory is excluded from that evidence set.

Command capture depends on the runner:

- `FakeRunner`: commands are directly observed from the deterministic implementation
- `CodexCliRunner`: commands are captured from the runner’s structured final response and are marked as self-reported unless a later phase adds direct observability

Phase 1 is intentionally honest here: command lists may be partial, and that partiality is recorded in both the command artifact and the review packet.

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

## What Remains For Phase 2

Phase 2 should add the first real guardrail layer:

- policy DSL evaluation against paths and actions
- protected-zone blocking and approval packets
- CLI approval flow
- clearer handling for blocked runs instead of the current placeholder resolution

Later phases can then add verification gates, resume support, SQLite-backed durability, GitHub draft PR flow, benchmarks, and the dashboard without rewriting the Phase 1 run loop.
