# PLANS.md

## Objective
Implement only Phase 3 from `codex_governed_delivery_handoff_spec.md`: add deterministic verification, configured verification commands, claim verification, packet completeness checks, a run completion gate, `gdh verify <run-id>`, and evidence-based review packets to the existing Phase 2 governed run flow.

## Constraints
- Stay within Phase 3 boundaries.
- Treat `codex_governed_delivery_handoff_spec.md` as the architectural source of truth.
- Reuse the existing file-backed run store under `runs/` unless a tiny refinement is required to support inspectable verification artifacts.
- Do not implement Phase 4 durable resume state, SQLite migration, GitHub draft PR creation, benchmark suites, regression gating, or multi-agent orchestration.
- Keep verification deterministic, inspectable, and CI-safe without live Codex access.
- Keep configured verification commands repo-local instead of burying them in CLI branches.
- Ensure `completed` is impossible without a persisted `VerificationResult`.
- Keep review packet claims evidence-backed and explicitly fail unsupported claims instead of narrating past uncertainty.

## Milestones
1. Capture the Phase 3 plan and live audit baseline for this implementation session.
2. Extend the domain contracts for verification artifacts, claim checks, packet completeness, completion decisions, review packet structure, and verification lifecycle events.
3. Add the smallest repo-local verification config surface and load/normalize it deterministically.
4. Implement the verification engine in `packages/verification`, including diff checks, configured command execution, policy compliance checks, claim verification, packet completeness, artifact completeness, and final aggregation.
5. Refactor `packages/review-packets` so packets are generated from structured evidence and include verification and claim-check summaries without overstating certainty.
6. Integrate verification into `gdh run` and implement `gdh verify <run-id>` on the same engine and artifact flow.
7. Add deterministic fixtures and tests for config parsing, command execution, diff parsing, claim rules, completeness checks, `gdh verify`, and `gdh run` success/failure paths.
8. Run root validation, fix issues, and update operating docs for the real Phase 3 behavior and the remaining Phase 4 work.

## Acceptance Criteria
- `gdh run <spec-file>` enters `verifying` after execution and does not reach `completed` until a `VerificationResult` is persisted.
- `gdh verify <run-id>` loads an existing run, executes configured verification commands, persists verification artifacts, emits verification events, prints a summary, and exits non-zero on mandatory failure.
- Verification artifacts are individually inspectable under `runs/local/<run-id>/`, including command results, claim checks, packet completeness, and the aggregated verification result.
- Configured mandatory verification commands are repo-local, deterministic, and recorded with exit code, duration, stdout/stderr artifacts, and mandatory/optional status.
- Claim verification is rule-based, evidence-first, and fails unsupported review-packet claims.
- Packet completeness verifies the required sections and feeds the final verification result.
- Policy compliance verification consumes the Phase 2 policy decision, approval, and policy audit artifacts instead of re-implementing policy evaluation.
- Review packets are generated from structured evidence, include verification outcomes and claim summaries, and avoid unsupported “safe” / “production-ready” style assertions unless explicit evidence exists.
- Root `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass from the workspace root.

## Risks
- Introducing circular dependencies between verification aggregation and final packet rendering.
- Treating runner-reported narration as trustworthy instead of preserving it as non-authoritative evidence.
- Making verification command configuration too implicit or too CLI-specific for later reuse.
- Breaking the existing Phase 2 happy path while adding the `verifying` gate and explicit re-verification entrypoint.
- Over-designing the artifact store or state machine in ways that really belong to Phase 4 durability work.

## Verification Plan
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm --filter @gdh/verification test`
- `pnpm --filter @gdh/review-packets test`
- `pnpm --filter @gdh/cli test`
- manual `pnpm gdh run <spec-file> --runner fake --approval-mode fail`
- manual `pnpm gdh verify <run-id>`

## Rollback / Fallback
- Keep verification additive around the existing file-backed artifacts and CLI flow instead of redesigning storage for Phase 4.
- Prefer explicit failed verification results and packet limitations over weak “partial success” narration.
- If full packet regeneration and verification orchestration become too tangled, keep review packet structure simple and evidence-backed rather than introducing speculative abstractions.
- Preserve inspectable artifacts on verification failure so a human can see why completion was blocked.

## Notes
- The Phase 3 implementation should keep rule-based claim verification first and defer any LLM-assisted verifier to a later phase.
- The default repo-local verification config should live in version control and stay easy to override in tests with deterministic commands.
- Review packet Markdown should be a rendering of the structured packet JSON, not an independent source of truth.
