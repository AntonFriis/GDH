# Example: From GitHub Issue To Governed Draft PR

If you need a one-page explanation of what this project is for, use this scenario:

A team wants Codex to work on a real GitHub issue, but it does not want "the agent said it was done" to be the operating model. The team wants a governed path from issue intake to reviewable draft PR, with inspectable artifacts at every step.

## Scenario

An engineer opens `acme/payments#184`:

> Login recovery copy is outdated and the audit note is missing in the auth flow.

The team wants the speed of an agent, but this touches an auth-adjacent area, so they also want policy checks, explicit approval boundaries, deterministic verification, and a clean review packet.

## How GDH Gets Used

1. An operator starts a governed run from the issue:

```bash
pnpm gdh run --github-issue acme/payments#184 --runner codex-cli
```

GDH fetches the issue, normalizes it into the same internal spec format used for local markdown specs, creates a bounded plan, generates an impact preview, and evaluates repo policy before write-capable execution starts.

The run immediately begins producing durable artifacts such as:

- `spec.normalized.json`
- `plan.json`
- `impact-preview.json`
- `policy.input.json`
- `policy.decision.json`

2. The operator checks the run:

```bash
pnpm gdh status <run-id>
```

If policy allows the task, execution continues. If policy decides the task needs human review, GDH pauses cleanly and writes:

- `approval-packet.json`
- `approval-packet.md`

That means the approval boundary is visible and inspectable. The run does not quietly continue into protected scope.

3. A reviewer resumes the paused run when ready:

```bash
pnpm gdh resume <run-id>
```

In an interactive terminal, the reviewer can approve or deny the run. GDH resumes from the last safe checkpoint instead of rerunning the whole workflow blindly.

4. The runner executes and GDH records evidence:

- `commands-executed.json`
- `changed-files.json`
- `diff.patch`
- `policy-audit.json`
- `session.manifest.json`
- `progress.latest.json`
- `checkpoints/*`

This is the operational point of the system: the run is not just "done" or "not done." It is inspectable.

5. GDH verifies before completion:

```bash
pnpm gdh verify <run-id>
```

In the normal `gdh run` flow verification is already part of completion, but teams can also rerun it explicitly. A run cannot reach `completed` without a persisted passing `verification.result.json`.

6. Once the run is verified, the operator packages it for review:

```bash
pnpm gdh pr create <run-id>
```

GDH creates a draft PR only. It does not merge, deploy, or hide the review surface. The PR is paired with the review packet so reviewers can see the summary, checks, and policy evidence alongside the diff.

7. Review feedback can come back into the same governed loop:

```bash
pnpm gdh pr comments <run-id>
pnpm gdh pr iterate <run-id>
```

Explicit `/gdh iterate` comments are materialized into follow-up local artifacts rather than disappearing into chat history.

8. The operator or reviewer can inspect everything locally:

```bash
pnpm dashboard:dev
```

The dashboard reads persisted artifacts for runs, approvals, verification, GitHub state, and benchmarks. It is a visibility layer over evidence, not a second control plane.

## What This Story Sells

- You still get agent speed, but the agent does not bypass policy.
- Protected work stops at a visible approval boundary.
- Verification is a completion gate, not a nice-to-have.
- Reviewers get a draft PR plus evidence, not just a patch and a promise.
- The whole flow stays local-first and file-backed, which keeps it demoable and inspectable.

## Why This Is Different From "Just Let The Agent Run"

- A plain agent session can finish without leaving durable state. GDH writes artifacts for plan, policy, approval, execution, verification, and review.
- A plain agent session can blur prediction and reality. GDH keeps impact preview, post-run audit, and verification separate.
- A plain agent session can make review harder. GDH packages the work into a draft-PR-ready review packet.
- A plain agent session usually has weak continuity. GDH has manifests, checkpoints, snapshots, status, and resume.

## Local Demo Variant

For demos where you do not want live GitHub or live Codex dependencies, use the same story with the deterministic local fixtures:

```bash
pnpm demo:prepare
pnpm dashboard:dev
```

Or run the core path directly:

```bash
pnpm gdh run runs/fixtures/release-candidate-demo-spec.md --runner fake --approval-mode fail
pnpm dashboard:dev
```

That gives you the same governed artifact flow without requiring network access or external credentials.
