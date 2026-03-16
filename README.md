# Governed Delivery Control Plane

This repository is a Codex-first governed execution layer for agentic software delivery. It now implements the local Phase 2 guardrail loop: plan the work, preview likely impact, evaluate repo policy, request approval when needed, execute inside the approved boundary, and persist inspectable artifacts the whole way through.

## Phase 2 Status

The local `cp run <spec-file>` flow now does all of the following:

- normalizes a markdown spec into a durable `Spec`
- creates a deterministic `Plan`
- generates a read-only `ImpactPreview` before any write-capable runner executes
- evaluates a version-controlled YAML policy pack under `policies/`
- returns `allow`, `prompt`, or `forbid`
- generates approval packets in JSON and Markdown when prompting is required
- supports interactive approval inside `cp run`
- leaves pending approval artifacts in non-interactive mode
- captures changed files, command evidence, and a lightweight post-run policy audit
- generates a review packet that includes policy decision and audit context

Phase 2 still stays deliberately narrow:

- no Phase 3 verification gates or PR claim verification yet
- no GitHub side effects or draft PR creation
- no resume flow or approval queue
- no multi-agent orchestration
- no SQLite-backed run store yet

## Primary CLI Path

```bash
cp run <spec-file> [--runner codex-cli|fake] [--approval-mode interactive|fail] [--policy <policy-file>] [--json]
```

Current options:

- `--runner codex-cli` uses the local Codex CLI via `codex exec`
- `--runner fake` uses the deterministic fake runner for CI-safe tests and smoke checks
- `--approval-mode interactive` pauses in the CLI and asks a human to approve or deny prompted work
- `--approval-mode fail` persists the approval packet, leaves the run in `awaiting_approval`, and exits non-zero
- `--policy <policy-file>` points at a repo-local YAML policy pack; the default is `policies/default.policy.yaml`
- `--json` prints the terminal summary as JSON

## Gated Run Sequence

`cp run` now follows this order:

1. validate and normalize the spec
2. create the deterministic plan
3. write the initial run record and planning artifacts
4. generate `impact-preview.json`
5. evaluate the preview against the selected policy pack
6. if the decision is `allow`, continue automatically
7. if the decision is `prompt`, generate `approval-packet.json` and `approval-packet.md`
8. if prompting is interactive, ask for approve or deny in the CLI
9. if prompting is non-interactive, persist the pending state and stop with `awaiting_approval`
10. if approved, execute the write-capable runner
11. capture changed files, diff evidence, and `policy-audit.json`
12. generate the final review packet

## Policy DSL

Policy packs are human-authored YAML files. The canonical default pack is [`policies/default.policy.yaml`](/Users/anf/Repos/GDH/policies/default.policy.yaml), and a stricter example pack lives at [`policies/conservative.policy.yaml`](/Users/anf/Repos/GDH/policies/conservative.policy.yaml).

The DSL currently supports decisions by:

- path glob
- action kind
- command prefix
- command regex matcher
- task class
- risk hint
- documented fallback decision

The evaluator precedence is:

1. `forbid` beats everything
2. `prompt` beats `allow`
3. more specific matches beat less specific matches
4. path / command / action rules outrank task-class defaults when severity is equal
5. unresolved cases use the pack’s explicit fallback decision

The default pack protects examples such as:

- auth and permissions paths
- billing and subscription paths
- migrations and schema paths
- secrets and env files
- release, deploy, publish, and infra surfaces
- destructive filesystem commands
- remote git / GitHub mutation commands
- publish / deploy commands
- network-fetching shell commands

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
- `review-packet.json`
- `review-packet.md`

## Preview Vs Enforcement

Two different artifact types matter here:

- `impact-preview.json` is predictive. It uses explicit spec hints plus deterministic heuristics to estimate touched paths, commands, sandbox needs, and uncertainty.
- `policy-audit.json` is observed. It compares the preview against actual changed files and captured commands after the run.

Phase 2 is honest about that difference:

- preview drives the allow / prompt / forbid decision before execution
- audit records scope drift or obvious policy breaches after execution
- full verification and claim-checking are still Phase 3 work

## Smoke Fixtures

Safe Phase 2 smoke path:

```bash
node apps/cli/dist/index.js run runs/fixtures/phase2-policy-smoke-spec.md --runner fake --approval-mode fail
```

The smoke spec lives at [`runs/fixtures/phase2-policy-smoke-spec.md`](/Users/anf/Repos/GDH/runs/fixtures/phase2-policy-smoke-spec.md).

If you want to exercise the prompt flow locally, point a spec at a protected path such as `src/auth/**` and run:

```bash
node apps/cli/dist/index.js run <spec-file> --runner fake --approval-mode interactive
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

- [`AGENTS.md`](/Users/anf/Repos/GDH/AGENTS.md) defines project purpose, boundaries, commands, and done criteria.
- [`PLANS.md`](/Users/anf/Repos/GDH/PLANS.md) holds the durable implementation plan for the current phase.
- [`implement.md`](/Users/anf/Repos/GDH/implement.md) defines the implementation runbook.
- [`documentation.md`](/Users/anf/Repos/GDH/documentation.md) is the live audit log.
- [`.codex/config.toml`](/Users/anf/Repos/GDH/.codex/config.toml) provides conservative local Codex defaults.

## What Remains For Phase 3

Phase 3 should add the first real verification gate:

- lint / typecheck / test command integration as governed verification
- review packet claim verification against diff evidence
- packet completeness checks
- completion gating based on verification status

Later phases can still add resume support, SQLite-backed durability, GitHub draft PR flow, benchmarks, and the dashboard without rewriting the Phase 2 run sequence.
