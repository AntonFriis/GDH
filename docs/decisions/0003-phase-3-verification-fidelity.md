# 0003 Phase 3 Verification Fidelity

## Status
Accepted

## Context

Phase 2 added policy evaluation, approval gating, artifact persistence, and post-run audit evidence, but a run could still move from execution straight to completion without a deterministic verification stage. Review packets also still risked overstating the work by repeating broad runner narration instead of deriving claims from structured evidence.

Phase 3 needed to make completion depend on inspectable verification artifacts while staying inside the existing file-backed run model and without adding durable resume, GitHub side effects, or LLM-based verification.

## Decision

Adopt a deterministic, repo-local verification subsystem with these properties:

- `gdh run` moves executed runs into `verifying` and only marks them terminal after verification writes `verification.result.json`.
- `gdh verify <run-id>` reloads an existing run, re-executes configured verification commands, re-runs deterministic verification, and refreshes the packet outputs.
- Verification commands are configured in `gdh.config.json` under `verification.preflight`, `verification.postrun`, and `verification.optional`.
- Mandatory completion checks are explicit and inspectable: configured mandatory commands, diff parsability, policy compliance, claim verification, packet completeness, and artifact completeness.
- Claim verification is rule-based and deterministic. Unsupported certainty phrases fail verification.
- Review packets are generated from structured evidence. If raw runner narration contains unsupported certainty language, the packet replaces it with a conservative note instead of repeating the unsupported claim.

## Consequences

Positive:

- Completed runs now require a persisted verification result.
- Verification outcomes and supporting artifacts are inspectable per run.
- Packet fidelity is stricter and less likely to overstate what the system actually proved.
- The current run flow is ready for later durable-state and GitHub packaging phases without rewriting the control flow again.

Tradeoffs:

- Verification commands are shell-based and repo-local, so command correctness still depends on the repo’s configuration.
- Claim verification is intentionally conservative and phrase-based in Phase 3.
- The repo still relies on file-backed artifacts and session-local approvals until the durability phase lands.
