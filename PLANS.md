# PLANS.md

## Objective
Implement only Phase 1 from `codex_governed_delivery_handoff_spec.md`: a local end-to-end `cp run <spec-file>` flow that normalizes a markdown spec, creates a plan and run record, executes through a runner, persists inspectable artifacts and events, captures changed files and commands, and generates a conservative markdown review packet.

## Constraints
- Stay within Phase 1 boundaries.
- Follow the handoff document as the source of truth for architecture, layout, stack, and operating conventions.
- Use Node.js 20+, TypeScript, pnpm workspaces, and Turborepo.
- Use the Codex CLI as the Phase 1 execution path and keep the interface ready for a later Codex SDK adapter.
- Keep approvals, real policy enforcement, GitHub side effects, draft PR creation, multi-agent orchestration, and dashboard work out of scope.
- Prefer file-backed run storage under `runs/` for Phase 1 unless existing repo choices make that inconsistent.
- Keep implementations minimal, compilable, deterministic where possible, and internally consistent.

## Milestones
1. Capture the Phase 1 plan and live audit baseline for this implementation session.
2. Refine the domain contracts for specs, plans, runs, events, runner IO, artifacts, and review packets.
3. Implement the file-backed run artifact store, event log, spec normalization, and deterministic planning path.
4. Implement `CodexCliRunner`, a deterministic fake runner, and wire `cp run <spec-file>` end to end.
5. Generate conservative review packets and diff-based evidence artifacts for completed runs.
6. Add CI-safe unit and integration coverage, plus a smoke fixture spec and manual live-run documentation.
7. Run root validation, fix issues, and update the repository docs to reflect the real Phase 1 state.

## Acceptance Criteria
- `cp run <spec-file>` works end to end for at least one low-risk smoke task.
- A run writes durable artifacts under `runs/` for the normalized spec, plan, run record, runner prompt and logs, runner result, changed files, commands, diff, review packet, and events.
- Structured events are emitted through run creation, planning, execution, diff capture, review packet generation, and run completion/failure.
- Changed files are derived from real repo state, excluding run artifacts from the task-change set.
- Commands executed are captured honestly with provenance and partiality noted when they are self-reported.
- Unit tests cover spec normalization, plan generation, artifact storage, and review packet generation.
- At least one integration-style CLI test covers `cp run` with a deterministic fake runner.
- Root `lint`, `typecheck`, `test`, and `build` pass from the workspace root.
- `README.md` and `documentation.md` reflect the implemented Phase 1 behavior and remaining Phase 2 work.

## Risks
- Over-implementing Phase 2 policy or approval behavior instead of keeping the Phase 1 loop small and reliable.
- Depending too heavily on Codex self-reporting for commands or status without marking those fields as partial.
- Breaking workspace builds by spreading orchestration logic across packages without keeping responsibilities explicit.
- Accidentally including generated run artifacts in diff evidence or test fixtures.

## Verification Plan
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm --filter @gdh/cli test`
- manual `cp run <smoke-spec>` with `--runner codex-cli` when Codex CLI auth is available

## Rollback / Fallback
- Keep the implementation additive and package-local so any unstable live Codex integration can fall back to the deterministic fake runner without rewriting the CLI flow.
- Prefer raw runner logs plus conservative parsing over brittle assumptions about Codex event formats.
- Document any unavoidable live-run limitations in `documentation.md` and `README.md` instead of overstating automation fidelity.

## Notes
- The Phase 1 store should stay file-backed even though SQLite scaffolding exists, because the handoff defers SQLite durability to a later phase.
- If a tooling choice is under-specified by the handoff, prefer the smallest working option and record it in `documentation.md` or `docs/decisions/` when the tradeoff matters.
