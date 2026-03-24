# PLANS.md

## Objective
Dogfood GDH as a careful operator on real low-risk work, preserve the artifact trail, and produce an honest report about what currently works, what breaks, and what should be prioritized next.

## Constraints
- Treat this as an operator session, not a feature-development session.
- Read and follow `codex_governed_delivery_handoff_spec.md`, `AGENTS.md`, `implement.md`, `documentation.md`, and `README.md`.
- Prefer the existing `pnpm gdh ...` product surface and only bypass it when a clear blocker defect prevents dogfooding.
- Choose only low-risk tasks: docs improvements, test additions around existing helpers, CI/config cleanup, benchmark/report inspection, and guarded GitHub flow checks when the environment safely supports them.
- Avoid secrets, `.env` reads, billing, auth-sensitive work, migrations, deploy/release automation, and risky performance changes unless a blocked-path test explicitly requires touching the guardrail.
- Apply only minimal unblocker fixes required to complete the dogfooding workflow, then return to operator mode immediately.
- Keep the audit trail honest: record failed attempts, blocked paths, approval pauses, and surprising behavior rather than smoothing them over.

## Milestones
1. Completed: read the authoritative repo docs, inspected the current CLI/operator surfaces, and audited the current workspace state before editing.
2. In progress: repair only the minimum blocker needed to use the primary operator surface if `pnpm gdh` is still nonfunctional, then verify that the wrapper actually runs commands.
3. Execute at least five low-risk dogfooding tasks through real `gdh` workflows, mixing live governed runs in this repo with safe benchmark/sample workflows where helpful.
4. Exercise at least one guarded or blocked path to capture approval, policy, or environment friction instead of testing only happy paths.
5. Update `documentation.md` as a live audit log, then write `reports/dogfooding-report.md` with task-by-task evidence, friction, trust concerns, and next priorities.

## Candidate Tasks
- Live docs run: correct the stale README limitation text about benchmark-suite availability.
- Live docs run: tighten `docs/demos/README.md` or another operator-facing walkthrough where the audit finds unclear instructions.
- Live docs run: refresh a benchmark/reporting doc if the current repo docs contradict the implemented corpus or operator flow.
- Guarded run: attempt a low-risk CI/config task that should pause for approval under the current policy pack.
- Benchmark run: execute one or more low-risk accepted fresh cases through `gdh benchmark run`.
- Optional, only if the environment safely supports it: GitHub issue ingestion and/or draft PR packaging on a safe repo/branch.

## Acceptance Criteria
- At least five low-risk dogfooding tasks are attempted through current `gdh` workflows if the environment supports them.
- Every attempted task has a recorded run identifier and durable artifact trail.
- The session captures run outcomes, policy/approval behavior, verification results, and benchmark relevance where applicable.
- All notable failures, friction points, and trust concerns are documented in `documentation.md` and summarized in `reports/dogfooding-report.md`.
- Any unblocker fix made during the session is minimal, explicitly documented, and locally verified.

## Risks
- The current primary CLI wrapper may be broken, forcing a minimal fix before true operator dogfooding can begin.
- Live `codex-cli` runs may fail because of local auth, sandbox, or prompt/runner behavior outside the deterministic benchmark path.
- GitHub issue and PR flows may be blocked by missing credentials or permissions even if the code path is implemented.
- Verification may be expensive on repeated live runs because the repo config uses repo-wide lint/typecheck/test commands.
- Dogfooding in the repo itself can create real workspace changes, so task scope needs to stay tightly bounded.

## Verification Plan
- If the blocker fix changes repo code or package wiring, run the smallest meaningful verification first:
  - `pnpm gdh --help`
  - targeted tests covering the touched surface when practical
  - `pnpm lint`, `pnpm typecheck`, and `pnpm test` if code changed
- For each dogfooding task, capture:
  - command used
  - run id
  - final status
  - approval state
  - verification outcome
  - important artifact paths
- For benchmark tasks, also capture benchmark run ids, regression/comparison status when relevant, and any linked governed-run evidence exposed by the benchmark artifact.

## Rollback / Fallback
- If the `pnpm gdh` wrapper remains blocked, use the smallest direct CLI fallback only long enough to repair or diagnose the wrapper, then return to the primary surface.
- If live `codex-cli` execution proves unavailable, fall back to deterministic benchmark/sample workflows and clearly record that the live runner path was not validated.
- If GitHub flows require unavailable credentials, stop at the first clear error, keep the artifact evidence, and record the gap instead of adding workaround code.

## Notes
- The main deliverable is operational evidence, not polished new product surface.
- A failed or blocked governed run is still useful dogfooding evidence when the artifacts are preserved and analyzed honestly.
