# Failure Feedback Loop

This repo records operator-observed failures as durable, typed artifacts so we can learn from real runs without hiding the evidence inside `documentation.md` prose or ad hoc chat notes.

## Storage Layout

- Failure records: `reports/failures/records/*.json`
- Generated machine summary: `reports/failures/summary.latest.json`
- Generated operator report: `reports/failures/summary.latest.md`

Keep links inside failure records repo-relative whenever the evidence lives in this checkout.

## Record Shape

Each failure record stores:

- `id`
- `timestamp`
- `category`
- `severity`
- `sourceSurface`
- `runId` or `benchmarkRunId` when relevant
- `title`
- `description`
- `reproductionNotes`
- `suspectedCause`
- `status`
- `owner`
- `links[]` with `{ label, path }`

The authoritative machine-readable schema lives in `packages/domain/src/contracts.ts` as `FailureRecordSchema`.

## Taxonomy

| Category | Meaning | Use when |
| --- | --- | --- |
| `policy-false-positive` | Policy blocked or paused acceptable low-risk work. | The guardrail was too strict for the actual task. |
| `policy-miss` | Policy allowed or under-scoped risky work that should have been stopped or approved. | Protected paths, actions, or task classes slipped through. |
| `approval-ux-friction` | Approval flow was technically correct but awkward or unclear. | Operators struggled to understand or resolve an approval. |
| `verification-false-positive` | Verification reported failure even though the evidence-backed outcome was acceptable. | Claim checks or completion gates rejected a good result. |
| `verification-false-negative` | Verification passed even though a material problem remained. | Deterministic checks missed a real defect. |
| `review-packet-claim-mismatch` | The review packet or runner summary made claims the artifacts did not support. | Packet language overstated, omitted, or misrepresented the diff or evidence. |
| `packet-completeness-issue` | The review packet was missing expected sections or evidence. | Required packet content was absent or structurally incomplete. |
| `resumability-failure` | Resume eligibility or interrupted-run handling was wrong or misleading. | A run could not resume safely, or was marked resumable incorrectly. |
| `continuity-workspace-mismatch` | Persisted continuity state did not match the actual workspace. | Resume or status relied on stale or misleading workspace assumptions. |
| `github-delivery-failure` | Draft PR creation, sync, comments, or iteration flow failed materially. | The GitHub packaging layer broke after verification. |
| `benchmark-instability` | Benchmark results were noisy or not reproducible enough to trust. | Re-running the same fixture gave inconsistent outcomes. |
| `benchmark-contamination` | A benchmark case or candidate has provenance or truth-label problems. | The case depends on current model output, live auth, or hidden context. |
| `architecture-hotspot` | The failure exposed structural code debt that keeps recurring. | A maintainability seam, ownership problem, or coupling issue is the real blocker. |
| `operator-confusion-dx` | The product surface confused operators even if the core behavior was technically correct. | Output, naming, or docs made the system harder to use or trust. |
| `command-reporting-gap` | The operator could not clearly see what commands were running or had run. | Live execution lacked enough progress or command visibility. |
| `artifact-persistence-inconsistency` | Persisted artifacts did not match observed run behavior. | Changed files, checkpoints, or summaries disagreed with reality. |
| `flaky-test-or-benchmark` | A test or benchmark is intermittently unreliable. | The same change passes and fails without a meaningful code difference. |
| `unknown-needs-triage` | The issue is real but not yet classified confidently. | Capture first, classify after review. |

## Severity

- `low`: useful cleanup or clarity issue
- `medium`: meaningful friction or trust cost
- `high`: serious operator-risk issue
- `critical`: trust-boundary or correctness problem that can invalidate governed use

## Status

- `open`: newly captured and not yet reviewed
- `triaged`: classified and accepted as real
- `investigating`: actively being worked
- `mitigated`: partially reduced but not fully closed
- `resolved`: fixed and no longer active
- `wont_fix`: accepted as out of scope or intentionally unchanged

## Workflow

1. Capture the evidence first.
   Use run artifacts, benchmark artifacts, dogfooding reports, approval packets, verification results, and `documentation.md`.
2. Log the failure.

```bash
pnpm gdh failures log \
  --title "Workflow edit bypassed approval" \
  --category policy-miss \
  --severity critical \
  --source-surface policy \
  --run-id ci-workflow-comment-cleanup-20260324T082817z-692373 \
  --description "A protected workflow write was auto-allowed during a real dogfooding run." \
  --reproduction-notes "Run the guarded CI workflow dogfood spec with --runner codex-cli." \
  --suspected-cause "Command-prefix matching outranked protected-path intent." \
  --link runs/local/ci-workflow-comment-cleanup-20260324T082817z-692373/policy.decision.json
```

3. Review the current record set.

```bash
pnpm gdh failures list
pnpm gdh failures list --status open --severity high
```

4. Refresh the generated summaries.

```bash
pnpm gdh failures summary
```

5. Update ownership or status directly in the JSON record for now, then rerun `pnpm gdh failures summary`.

There is intentionally no heavy incident-management system here yet. The workflow stays file-backed, explicit, and inspectable in Git.

## Operator Rules

- Prefer recording one concrete failure per record.
- Link to the exact artifacts that justify the classification.
- Use `unknown-needs-triage` instead of forcing an uncertain category.
- Do not paste secrets, tokens, or private environment values into records.
- When a benchmark case itself is the problem, record it here and also preserve the benchmark provenance under `benchmarks/fresh/{candidates,rejected}` as appropriate.
