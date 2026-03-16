# PLANS.md

## Objective
Implement only Phase 2 from `codex_governed_delivery_handoff_spec.md`: add deterministic policy evaluation, approval gating, protected-path handling, impact-preview artifacts, and a minimal CLI approval flow to the existing local `gdh run <spec-file>` path.

## Constraints
- Stay within Phase 2 boundaries.
- Treat `codex_governed_delivery_handoff_spec.md` as the architectural source of truth.
- Reuse the existing Phase 1 run flow, file-backed artifact store, and package boundaries unless a small refinement is required for coherence.
- Keep approvals and policy decisions in the tool’s governed flow rather than relying on Codex’s own approval UI.
- Add a read-only impact-preview step before any write-capable execution.
- Keep Codex sandboxing conservative: no `danger-full-access`, no network-enabled default, and no hidden widening of sandbox/approval settings.
- Do not implement Phase 3 verification gates, PR claim verification, GitHub side effects, resume workflows, or multi-agent orchestration.
- Keep persistence file-backed under `runs/` unless an existing Phase 1 choice makes that impossible.
- Favor deterministic, inspectable artifacts and CI-safe fake paths over opaque autonomy.

## Milestones
1. Capture the Phase 2 plan and live audit baseline for this implementation session.
2. Extend the domain contracts for policy packs, impact previews, approvals, policy audits, and new run events/statuses.
3. Implement the YAML policy DSL loader, normalization, matcher precedence, and deterministic evaluator in `packages/policy-engine`.
4. Add impact-preview generation, approval-packet generation, and policy-audit support with durable artifacts under `runs/local/<run-id>/`.
5. Integrate policy gating and interactive/non-interactive approval handling into the existing `gdh run <spec-file>` path.
6. Expand deterministic fake-run coverage and integration tests for allow, prompt, deny, forbid, and pending-approval cases.
7. Run workspace validation, fix issues, and update docs to reflect the real Phase 2 behavior and remaining Phase 3 work.

## Acceptance Criteria
- `gdh run <spec-file>` now normalizes the spec, generates a plan, creates an impact preview, evaluates the configured policy pack, and only then decides whether to continue, prompt, or stop.
- Policy evaluation is driven by version-controlled YAML policy files under `policies/`, not by hard-coded allow/block logic in the CLI.
- Protected paths and command categories can deterministically resolve to `allow`, `prompt`, or `forbid`.
- Prompted runs generate both `approval-packet.json` and `approval-packet.md` with enough context for a human decision.
- Interactive approval works within `gdh run`, and non-interactive mode exits cleanly with persisted pending-approval artifacts and `awaiting_approval` run state.
- Policy decisions, approval outcomes, impact preview creation, and blocked runs are recorded as structured events.
- A lightweight post-run policy audit is persisted and records scope drift or obvious policy breaches without overstating certainty.
- CI-safe tests cover policy parsing, precedence, matching, approval packet generation, and gated `gdh run` integration scenarios.
- Root `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass from the workspace root.
- `README.md`, `AGENTS.md`, and `documentation.md` describe the implemented Phase 2 guardrails and the work deferred to Phase 3.

## Risks
- Over-coupling the CLI to a single policy pack format in a way that would make later SDK or API reuse awkward.
- Making the impact preview look stricter than it really is; preview artifacts must clearly separate prediction from verified post-run evidence.
- Accidentally widening runner permissions while adding the preview/approval sequence.
- Breaking the Phase 1 happy path by replacing instead of extending the current run orchestration.
- Letting approval UX sprawl into a queue/resume system that belongs to a later phase.

## Verification Plan
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm --filter @gdh/policy-engine test`
- `pnpm --filter @gdh/cli test`
- manual `node apps/cli/dist/index.js run <spec-file> --runner fake --approval-mode interactive`
- manual `node apps/cli/dist/index.js run <spec-file> --runner fake --approval-mode fail`

## Rollback / Fallback
- Keep the policy gate additive around the existing Phase 1 run sequence so the deterministic fake runner still exercises the full flow without live Codex access.
- Prefer explicit preview heuristics and persisted uncertainty notes over brittle implicit reasoning.
- If live preview integration with Codex becomes unstable, keep the deterministic previewer as the default path and document the limitation honestly.
- Persist policy artifacts even on blocked or denied runs so failures remain inspectable without a resume system.

## Notes
- The Phase 2 implementation should seed a human-readable default policy pack plus at least one stricter example or fixture policy for tests.
- The approval flow should remain session-local inside `gdh run`; a durable approval queue and resume flow are intentionally deferred.
- Post-run policy audit is evidence collection for Phase 2, not a replacement for the fuller verification subsystem planned for Phase 3.
