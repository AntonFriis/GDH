# 0002: Deterministic Phase 2 Policy Gating

## Status
Accepted

## Context

Phase 2 needs a real guardrail layer before write-capable execution, but the repository is still intentionally local, file-backed, and CI-safe. The handoff requires:

- YAML policy packs under `policies/`
- deterministic allow / prompt / forbid evaluation
- approval packets for prompted work
- an interactive CLI approval path
- a lightweight post-run policy audit
- no durable approval queue, resume flow, or GitHub side effects yet

## Decision

Implement Phase 2 as a two-step local gate around the existing Phase 1 `gdh run` flow:

1. Generate a read-only `ImpactPreview` from the normalized spec and deterministic heuristics.
2. Evaluate that preview against a YAML policy pack before invoking the write-capable runner.

If policy returns:

- `allow`: continue automatically
- `prompt`: persist an approval packet and either ask the human inline or stop in `awaiting_approval`
- `forbid`: persist the decision and stop before execution

After execution, write a lightweight `policy-audit.json` artifact that compares the preview against actual changed files and captured commands.

## Consequences

- Policy behavior is explicit, version-controlled, and testable in CI without live Codex access.
- Approval remains session-local in Phase 2, which keeps the implementation small and avoids premature queue or resume machinery.
- The preview is heuristic by design, so Phase 2 artifacts must clearly separate predictive evidence from observed audit evidence.
- Later phases can replace or augment the previewer, verifier, or storage layer without rewriting the run orchestration contract.
