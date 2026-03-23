# PLANS.md

## Objective
Refactor the repo’s largest and most responsibility-mixed implementation files into smaller, cohesive modules so the codebase is materially easier to navigate and extend without changing intended behavior.

## Constraints
- Stay inside the implemented Phase 8 release-candidate scope; this is structural cleanup and architectural hygiene, not a new feature phase.
- Preserve the existing CLI/API/web/package behavior unless a clear bug is uncovered during refactoring.
- Keep public entrypoints stable and small. Internal structure can change, but exports and command surfaces should remain compatible.
- Prefer responsibility-based modules over generic `utils` dumping grounds or abstract interface layers with no immediate value.
- Avoid circular dependencies, especially around `apps/cli` depending on workspace packages and `packages/domain` remaining the lowest-level shared contract package.
- Keep the repo runnable after each major slice whenever practical, and verify local behavior before claiming completion.

## Hotspot Audit
- Completed: the governed lifecycle moved out of `apps/cli/src/program.ts` into `apps/cli/src/services/run-lifecycle/`, leaving `program.ts` as a thinner command shell for option validation, approval prompts, summary formatting, GitHub delivery, and benchmark wiring.
- `packages/domain/src/index.ts` is the canonical shared contract package, but it currently combines enum/value definitions, every Zod schema, markdown and GitHub issue normalization, plan creation, run/session/checkpoint factories, and identifier helpers in one 2.8k-line file.
- `packages/evals/src/index.ts` mixes fixture workspace setup, run persistence, metric scoring, comparison/regression logic, and benchmark orchestration in one 1.3k-line file.
- `packages/verification/src/index.ts` mixes config loading, command execution, claim verification, packet completeness, review-packet rendering, and overall verification orchestration in one 1.2k-line file.
- `packages/policy-engine/src/index.ts` mixes YAML loading, policy normalization, preview heuristics, match logic, approval packet rendering, and post-run auditing in one 1.2k-line file.
- `packages/artifact-store/src/dashboard.ts`, `packages/artifact-store/src/index.ts`, and `apps/web/src/App.tsx` are still oversized mixed-responsibility files, but they are secondary to the five hotspots above for this pass.

## Milestones
1. Completed: recorded the hotspot audit and replaced the stale session plan with this structural-refactor plan.
2. Completed: refactored `@gdh/domain` into value, contracts, spec/planning, and run/session modules while keeping the package surface stable.
3. Completed: refactored `@gdh/policy-engine`, `@gdh/verification`, and `@gdh/evals` so each public `index.ts` is a small export surface over focused modules.
4. Completed: extracted the first CLI helper slice into `src/types.ts`, `src/git.ts`, and `src/summaries.ts`, and reduced `apps/cli/src/index.ts` to a tiny public entrypoint that re-exports `src/program.ts`.
5. Completed: updated the repo docs to describe the new structure and passed `pnpm validate` at the repo root.
6. Completed: extracted the governed lifecycle behind `apps/cli/src/services/run-lifecycle/` (`types`, `context`, `inspection`, `commit`, `transition-engine`, and `service`), rewired `program.ts` to thin wrappers over that service, moved orchestration-heavy CLI tests into a dedicated lifecycle-service suite, and passed `pnpm lint`, `pnpm typecheck`, and `pnpm test`.

## Acceptance Criteria
- The biggest responsibility-mixed source files are materially smaller or reduced to composition/export entrypoints.
- `apps/cli/src/index.ts` no longer contains unrelated helper clusters for every workflow concern.
- `packages/domain`, `packages/policy-engine`, `packages/verification`, and `packages/evals` each have a clear internal structure with practical module boundaries.
- Public behavior and exports are preserved for the CLI and package consumers.
- Documentation captures the hotspot audit, new module boundaries, and any remaining structural debt.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass after the refactor.

## Risks
- Large-file extraction can accidentally create circular dependencies or fragile barrel-export chains if the split is too mechanical.
- The CLI file is so large that moving helpers without a clear ownership map can create subtle behavior regressions in run, resume, or GitHub flows.
- Domain/package refactors touch shared imports across the workspace, so export compatibility needs to stay exact.
- Refactoring for structure alone can create noisy churn unless slices stay tightly scoped and compile after each step.

## Verification Plan
- Focused package tests and typechecks after each major slice where coverage exists.
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

## Rollback / Fallback
- Keep package public exports stable so internal modules can be collapsed back into an entrypoint if a slice proves too disruptive.
- If the CLI extraction becomes riskier than expected, stop after the highest-value helper clusters are moved and document the remaining debt instead of forcing a full decomposition in one pass.
- If a package split exposes unclear behavior, preserve current semantics and record the ambiguity in `documentation.md` instead of “cleaning up” by changing workflow logic.

## Notes
- The goal of this session is not theoretical architectural purity; it is a cleaner, still-working codebase focused on the worst files first.
- Deep modules are preferred here: narrow public surfaces with richer internal implementations behind them.
- Remaining highest-value refactor seams after this pass are the still-bulky GitHub publication helpers in `apps/cli/src/program.ts`, plus `packages/artifact-store/src/dashboard.ts`, `packages/domain/src/contracts.ts`, and `apps/web/src/App.tsx`.
