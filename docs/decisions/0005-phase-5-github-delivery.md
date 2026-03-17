# 0005 Phase 5 GitHub Delivery

## Status
Accepted

## Context

Phase 4 made the local governed run lifecycle durable, inspectable, and resumable, but successful work still stopped at local artifacts. The handoff calls for GitHub issue ingestion, branch preparation, draft PR creation, and review packet publication without turning GitHub into the control plane itself.

The repository already has:

- durable run and manifest artifacts
- deterministic verification and claim checking
- evidence-based review packets
- a placeholder `@gdh/github-adapter` package

Phase 5 needs to add a real GitHub delivery path while preserving the existing policy, approval, verification, and continuity guarantees.

## Decision

Implement GitHub delivery as a thin, explicit packaging layer on top of the existing run lifecycle:

- keep a dedicated `@gdh/github-adapter` package for GitHub reads and writes
- materialize GitHub issues into durable local source snapshots before the run continues
- persist a `github` state block onto the run and session manifest instead of scattering ad hoc fields
- create draft PRs only after explicit eligibility checks against run status, verification, approvals, claim verification, changed files, and continuity state
- publish a PR-safe rendering of the review packet rather than dumping raw local packet markdown into GitHub
- keep PR comment ingestion local-operator initiated and only honor explicit `/gdh iterate` requests

GitHub remains a delivery surface, not a second source of truth for planning or policy.

## Consequences

Positive:

- a verified governed run can now land in the normal draft PR workflow without weakening earlier safeguards
- issue ingestion, PR publication, and iteration requests remain inspectable through local artifacts
- the CLI and domain layers stay cleaner because GitHub HTTP details remain behind a dedicated adapter
- Phase 6 can build benchmarks and regression gates on top of the same verified run and PR artifacts

Tradeoffs:

- branch preparation and PR publication remain local-operator initiated rather than background-driven
- draft PR publication relies on a configured GitHub token and a compatible local git remote/push path
- the iteration loop is intentionally narrow and does not yet create new runs automatically
- there is still no merge, approval, or deploy automation path in this phase
