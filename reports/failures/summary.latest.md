# Failure Summary

Generated: 2026-03-24T12:23:29.632Z
Total records: 6
Active records: 6

## Counts By Category

- Policy False Positive: 0
- Policy Miss: 1
- Approval Ux Friction: 0
- Verification False Positive: 1
- Verification False Negative: 0
- Review Packet Claim Mismatch: 0
- Packet Completeness Issue: 0
- Resumability Failure: 1
- Continuity Workspace Mismatch: 0
- Github Delivery Failure: 0
- Benchmark Instability: 0
- Benchmark Contamination: 0
- Architecture Hotspot: 0
- Operator Confusion Dx: 1
- Command Reporting Gap: 1
- Artifact Persistence Inconsistency: 1
- Flaky Test Or Benchmark: 0
- Unknown Needs Triage: 0

## Counts By Severity

- Low: 1
- Medium: 1
- High: 3
- Critical: 1

## Counts By Status

- Open: 5
- Triaged: 1
- Investigating: 0
- Mitigated: 0
- Resolved: 0
- Wont Fix: 0

## Counts By Source Surface

- Run: 2
- Benchmark: 1
- Dogfooding: 0
- Approval: 0
- Verification: 1
- Resume: 1
- Github Delivery: 0
- Review Packet: 0
- Policy: 1
- Operator Feedback: 0
- Release Validation: 0
- Other: 0

## Latest Records

- [failure-artifact-persistence-inconsistency-missing-changed-files-20260324T093000z] Interrupted live run dirtied the workspace without matching changed-file artifacts (Artifact Persistence Inconsistency / High / Open)
  Timestamp: 2026-03-24T09:30:00.000Z
  Surface: Run
  Run: demo-walkthrough-clarity-pass-20260324T082542z-e1ea41
  Links: run.json (runs/local/demo-walkthrough-clarity-pass-20260324T082542z-e1ea41/run.json), workspace.latest.json (runs/local/demo-walkthrough-clarity-pass-20260324T082542z-e1ea41/workspace.latest.json), dogfooding report (reports/dogfooding-report.md)
- [failure-command-reporting-gap-live-runner-opaque-20260324T093000z] Live runner provided no meaningful heartbeat while work was in progress (Command Reporting Gap / Medium / Open)
  Timestamp: 2026-03-24T09:30:00.000Z
  Surface: Run
  Run: demo-walkthrough-clarity-pass-20260324T082542z-e1ea41
  Links: progress.latest.json (runs/local/demo-walkthrough-clarity-pass-20260324T082542z-e1ea41/progress.latest.json), dogfooding report (reports/dogfooding-report.md), documentation.md (documentation.md)
- [failure-operator-confusion-benchmark-inner-run-hidden-20260324T093000z] Benchmark summary made operators open raw JSON to find the governed run id (Operator Confusion Dx / Low / Triaged)
  Timestamp: 2026-03-24T09:30:00.000Z
  Surface: Benchmark
  Benchmark: benchmark-fresh-tests-dashboard-loading-wait-20260324T082956z-407e87
  Links: benchmark.run.json (runs/benchmarks/benchmark-fresh-tests-dashboard-loading-wait-20260324T082956z-407e87/benchmark.run.json), dogfooding report (reports/dogfooding-report.md)
- [failure-policy-miss-ci-workflow-auto-allow-20260324T093000z] Workflow edit was auto-allowed instead of pausing for approval (Policy Miss / Critical / Open)
  Timestamp: 2026-03-24T09:30:00.000Z
  Surface: Policy
  Run: ci-workflow-comment-cleanup-20260324T082817z-692373
  Links: policy.decision.json (runs/local/ci-workflow-comment-cleanup-20260324T082817z-692373/policy.decision.json), documentation.md (documentation.md), dogfooding report (reports/dogfooding-report.md)
- [failure-resumability-failure-interrupted-runner-completed-20260324T093000z] Interrupted live run was marked resumable from runner_completed without runner result evidence (Resumability Failure / High / Open)
  Timestamp: 2026-03-24T09:30:00.000Z
  Surface: Resume
  Run: demo-walkthrough-clarity-pass-20260324T082542z-e1ea41
  Links: run.json (runs/local/demo-walkthrough-clarity-pass-20260324T082542z-e1ea41/run.json), progress.latest.json (runs/local/demo-walkthrough-clarity-pass-20260324T082542z-e1ea41/progress.latest.json), dogfooding report (reports/dogfooding-report.md)
- [failure-verification-false-positive-ci-safe-claim-20260324T093000z] Good docs run failed verification because the runner summary said CI-safe (Verification False Positive / High / Open)
  Timestamp: 2026-03-24T09:30:00.000Z
  Surface: Verification
  Run: readme-benchmark-tier-note-20260324T082226z-4d05bf
  Links: verification.result.json (runs/local/readme-benchmark-tier-note-20260324T082226z-4d05bf/verification.result.json), claim-checks.json (runs/local/readme-benchmark-tier-note-20260324T082226z-4d05bf/claim-checks.json), dogfooding report (reports/dogfooding-report.md)
