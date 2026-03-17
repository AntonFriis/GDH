# PLANS.md

## Objective
Implement only Phase 5 from `codex_governed_delivery_handoff_spec.md`: GitHub issue ingestion, branch preparation, draft PR creation, review-surface publication, and conservative PR comment iteration scaffolding on top of the existing Phase 4 governed run, verification, and durable artifact flow.

## Constraints
- Stay within Phase 5 boundaries.
- Treat `codex_governed_delivery_handoff_spec.md` as the architectural source of truth while adapting to the current file-backed run and artifact model.
- Preserve all earlier guarantees: policy evaluation stays artifact-backed, approvals are never bypassed, verification still gates `completed`, and draft PR creation must add no side door around those controls.
- Keep GitHub as a delivery surface, not a replacement control plane.
- Keep the GitHub path local-operator initiated; do not add background polling, webhook servers, hosted services, merge automation, deploy hooks, or broad GitHub workflow automation.
- Keep credentials explicit and fail clearly when GitHub integration is requested without configuration.
- Prefer thin adapter boundaries, deterministic eligibility checks, and inspectable artifacts over convenience behavior.
- Keep CI coverage deterministic and independent of live GitHub or live Codex access.

## Milestones
1. Capture the Phase 5 plan and live audit baseline for this implementation session.
2. Extend the domain contracts for GitHub issue, repo, branch, PR, comment, iteration, publication, and run-state artifacts plus the new Phase 5 lifecycle events.
3. Implement or refine the dedicated `@gdh/github-adapter` package with explicit issue, repo, branch, draft PR, body/comment publication, and comment-reading methods plus repo-local GitHub config loading.
4. Add GitHub issue ingestion and normalization into the governed run pipeline, including persisted source linkage and durable issue-ingestion artifacts.
5. Implement conservative branch preparation, PR eligibility checks, draft PR creation, review packet publication, and persisted GitHub state/artifacts for verified runs only.
6. Implement a narrow local-operator PR comment sync path that detects explicit `/gdh iterate` requests, normalizes them into follow-up input artifacts, and records the linkage without adding background listeners.
7. Add deterministic tests for issue-ref parsing, issue-to-spec normalization, PR eligibility, PR body rendering, adapter behavior, and CLI integration flows for issue ingestion, draft PR creation, blocked PR creation, and comment-to-iterate normalization.
8. Run root validation, fix issues, and update the operating docs so the repo accurately describes the new Phase 5 GitHub delivery path, its required configuration, and the remaining Phase 6 scope.

## Acceptance Criteria
- `gdh run --github-issue <owner/repo#123>` can ingest a GitHub issue into a normalized `Spec`, persist the source linkage, and execute the normal governed run flow.
- A verified eligible run can prepare or reuse a conservative branch state, create a draft PR only, and persist the PR metadata and publication artifacts into the run directory.
- Draft PR creation is blocked when verification failed, required approval remains unresolved or denied, the run is incomplete, or branch/workspace continuity is incompatible with safe PR publication.
- The PR body or related GitHub comment is generated from the structured review packet and stays concise, evidence-backed, and explicit about limitations.
- PR comments can be fetched locally, explicit `/gdh iterate` comments can be normalized into follow-up iteration artifacts, and the linkage between the run, PR, and comment is persisted.
- No merge, approval, deploy, branch deletion, force-push, webhook, or background automation path is implemented.
- Root `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass from the workspace root.

## Risks
- Letting GitHub delivery logic leak into the CLI or domain layers instead of staying behind a thin adapter and explicit run artifacts.
- Treating a run as PR-eligible without re-checking approval, verification, claim-verification, and workspace/branch continuity state.
- Making branch preparation too clever and accidentally touching unrelated dirty-worktree changes.
- Overloading the PR body with raw logs or unverifiable claims instead of concise, evidence-backed packet content.
- Adding GitHub write side effects that are hard to test locally or that silently no-op when configuration is missing.
- Normalizing comment-to-iterate requests too loosely and turning normal discussion into unintended follow-up work.

## Verification Plan
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm --filter @gdh/domain test`
- `pnpm --filter @gdh/github-adapter test`
- `pnpm --filter @gdh/review-packets test`
- `pnpm --filter @gdh/cli test`

## Rollback / Fallback
- Keep GitHub delivery state additive to the existing run and manifest artifacts instead of rewriting the core Phase 4 lifecycle.
- If branch preparation cannot prove the workspace is compatible with the run’s captured changes, stop with an explicit reason rather than guessing.
- If GitHub publication cannot proceed safely, preserve the local review packet and GitHub request artifacts so an operator can inspect what blocked publication.
- Treat PR comment iteration as opt-in local ingestion only; if a comment is ambiguous, record that it was ignored instead of auto-generating follow-up work.

## Notes
- Issue ingestion should materialize a durable local source snapshot so resumed runs do not depend on a live GitHub re-fetch.
- Draft PR publication should record both the request payload and the observed GitHub response as inspectable artifacts.
- The initial GitHub adapter should remain mock-friendly and explicit: read issue data, inspect repo metadata, prepare branches, create draft PRs, update PR surfaces, and read PR comments.
- Phase 6 can build benchmark and regression gating on top of the same verified run and GitHub delivery artifacts instead of redesigning the delivery surface again.
