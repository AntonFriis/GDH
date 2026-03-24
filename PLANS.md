# PLANS.md

## Objective
Add a bounded self-improvement workflow that evaluates config-only optimization candidates against the existing benchmark corpus without granting broad autonomy or write access to protected core logic. The loop must stay artifact-backed, benchmark-driven, and conservative by default.

## Constraints

- Read and follow `codex_governed_delivery_handoff_spec.md`, `AGENTS.md`, `implement.md`, `documentation.md`, and `README.md` before editing.
- Stay inside Phase 8 scope by adding release-hardening style bounded optimization scaffolding rather than a broad autonomous improvement system.
- Keep the mutable optimization surface explicitly allowlisted and reviewable; reject or block anything outside that boundary.
- Do not let the optimization loop mutate core persistence logic, approval semantics, verification semantics, CLI run semantics, destructive command rules, security-sensitive defaults, or GitHub merge/deploy behavior.
- Keep benchmark evidence deterministic, local-first, and file-backed.
- Update `documentation.md` after each meaningful milestone, decision, blocker, or verification run.

## Milestones

1. Completed: inspect the authoritative docs plus the existing benchmark, comparison, config, and artifact surfaces to find the narrowest safe extension point.
2. Completed: define the bounded optimization search space and decision policy, then refresh the planning and documentation docs to reflect the new session scope.
3. Completed: implement the optimization config, candidate validation, benchmark execution, comparison, and durable artifact logging flow.
4. Completed: add deterministic tests for allowed-surface enforcement, benchmark-driven keep/reject decisions, and blocked unsafe candidates.
5. Completed: run `pnpm lint`, `pnpm typecheck`, and `pnpm test`, then update `documentation.md` with the verified outcome and remaining trust limits.

## Acceptance Criteria

- A repo-local optimization config defines the only surfaces the loop may change.
- Optimization candidates are supplied as explicit reviewable artifacts rather than open-ended source-tree mutation.
- The optimization workflow runs the configured benchmark target, compares the candidate against a persisted baseline, and records the evidence durably.
- Keep/reject decisions are explicit, deterministic, and fail closed on ambiguity, blocked surfaces, or safety/policy/verification regressions.
- The workflow does not mutate disallowed files through this loop.
- The docs explain the workflow, the allowed surfaces, the blocked surfaces, and the current trust limits clearly.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass.

## Risks

- A self-improvement feature can accidentally look broader than it is, so the config and docs must make the hard boundary obvious.
- Allowing benchmark-related files directly would risk evaluation gaming, so the implementation must keep the benchmark corpus and baselines outside the mutable surface.
- Prompt-only surfaces may have weak immediate benchmark sensitivity; the decision rules therefore need a conservative tie-break that rejects non-improving or ambiguous candidates.
- Copying candidate artifacts into temporary evaluation workspaces can hide provenance unless the original manifest, file payloads, and resolved config snapshot are persisted in the run artifacts.

## Verification Plan

- Unit and integration coverage for the optimization workflow:
  - targeted Vitest coverage for config parsing, candidate auditing, keep/reject rules, and CLI wiring
- Repo validation:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`

## Notes

- The first bounded optimization surface should be config-only and benchmark-visible, not arbitrary TypeScript source edits.
- Default behavior should evaluate candidates and record a keep/reject decision without auto-applying source-tree mutations.
- The benchmark corpus remains the trust anchor; the optimizer may tune only the bounded surface, never the benchmark truth labels or protected core guarantees.
