# Release Candidate Checklist

This checklist is the Phase 8 operator-facing validation script for the current local release candidate. Run the flows in order, record the observed result, and link the final evidence in `reports/release-candidate-report.md`.

## Execution Rules

- Run from a clean checkout unless a specific flow intentionally creates workspace changes.
- Prefer local, deterministic fixtures first.
- Record the exact command or entrypoint used.
- Record prerequisites, expected behavior, actual behavior, pass/fail, blocker severity if failed, and the fix applied if any.
- Mark optional networked flows as `not run` when credentials or environment prerequisites are absent.

## Checklist

- [x] Clean install/bootstrap
  - Command: `pnpm bootstrap`
  - Prerequisites: Node.js 20+, pnpm 10+, lockfile present
  - Expected: dependencies install with frozen lockfile and tracked runtime directories are prepared
  - Status: Passed on 2026-03-24
  - Actual: frozen-lockfile install was already up to date and bootstrap prepared the tracked `runs/`, `reports/`, and `docs/` directories
- [x] CLI entrypoint sanity
  - Command: `pnpm gdh --help`
  - Prerequisites: built CLI available in the current checkout
  - Expected: the governed CLI command surface prints without throwing
  - Status: Passed on 2026-03-24
  - Actual: the CLI printed the full governed command surface from `apps/cli/dist/program.js`
- [x] Safe `gdh run` path
  - Command: `pnpm gdh run runs/fixtures/release-candidate-demo-spec.md --runner fake --approval-mode fail --json`
  - Prerequisites: built workspace, writable repo checkout
  - Expected: docs-only run completes, persists artifacts, and passes verification
  - Status: Passed on 2026-03-24
  - Actual: run `release-candidate-demo-run-20260324T123104z-553f69` completed with verification status `passed`
- [x] Approval-required path
  - Command: use a protected-path fixture through `pnpm gdh run ... --runner fake --approval-mode fail --json`
  - Prerequisites: fixture that targets a prompt-gated path
  - Expected: run pauses or blocks at the approval boundary and persists approval artifacts
  - Status: Passed on 2026-03-24
  - Actual: `pnpm gdh run benchmarks/fixtures/specs/smoke/smoke-policy-prompt.md --runner fake --approval-mode fail --json` paused at `awaiting_approval` and wrote `approval-packet.md` for run `smoke-policy-prompt-20260324T123128z-cb264a`
- [x] Forbidden-path blocking behavior
  - Command: use a forbidden fixture through `pnpm gdh run ... --runner fake --approval-mode fail --json`
  - Prerequisites: fixture that targets a forbidden path such as `.env`
  - Expected: run is blocked before write-capable execution and persists policy evidence
  - Status: Passed on 2026-03-24
  - Actual: `pnpm gdh run benchmarks/fixtures/specs/smoke/smoke-policy-forbid.md --runner fake --approval-mode fail --json` failed before write-capable execution with policy decision `forbid`
- [x] Verification path
  - Command: `pnpm gdh verify <successful-run-id> --json`
  - Prerequisites: completed governed run with verification artifacts
  - Expected: deterministic verification succeeds and produces a persisted verification result
  - Status: Passed on 2026-03-24
  - Actual: `pnpm gdh verify release-candidate-demo-run-20260324T123104z-553f69 --json` returned `verificationStatus: "passed"` and reused the persisted run artifacts cleanly
- [x] `gdh status`
  - Command: `pnpm gdh status <run-id> --json`
  - Prerequisites: existing successful or paused run id
  - Expected: durable run state, resumability, and artifact summary are inspectable
  - Status: Passed on 2026-03-24
  - Actual: both the completed demo run and the approval-paused protected-path run returned durable inspection summaries with the expected resumability state
- [x] `gdh resume`
  - Command: `pnpm gdh resume <approval-paused-run-id> --json`
  - Prerequisites: resumable paused run with approval state
  - Expected: resume behavior stays conservative and does not bypass approval/continuity gates
  - Status: Passed on 2026-03-24
  - Actual: `pnpm gdh resume smoke-policy-prompt-20260324T123128z-cb264a --json` stayed at `awaiting_approval` and did not bypass the unresolved approval gate
- [x] Benchmark smoke flow
  - Command: `pnpm benchmark:smoke`
  - Prerequisites: built workspace and deterministic benchmark fixtures
  - Expected: smoke suite completes with inspectable benchmark artifacts and regression status
  - Status: Passed on 2026-03-24
  - Actual: smoke benchmark run `benchmark-smoke-20260324T123150z-c45ee6` passed `10/10` cases with score `1.00`; the final post-fix `pnpm release:validate` benchmark run `benchmark-smoke-20260324T123701z-8391dd` also passed
- [x] Dashboard startup
  - Entrypoint: `pnpm dashboard:dev`
  - Prerequisites: built API/web workspaces and free local ports
  - Expected: local API and web dashboard start and expose the persisted artifact views
  - Status: Passed on 2026-03-24
  - Actual: `pnpm dashboard:dev` started both services; `curl -sf http://127.0.0.1:3000/health` returned `{"status":"ok","phase":"8"}` and `curl -I -sf http://127.0.0.1:5173` returned `HTTP/1.1 200 OK`
- [x] Demo preparation script
  - Command: `pnpm demo:prepare`
  - Prerequisites: build succeeds and the CLI helper wiring is correct
  - Expected: a deterministic demo run plus smoke benchmark are generated and summarized under `reports/release/`
  - Status: Passed after fix on 2026-03-24
  - Actual: initial run failed because `scripts/demo-prep.ts` invoked `apps/cli/dist/index.js`, which does not execute the CLI; after repointing it to `apps/cli/dist/program.js`, `pnpm demo:prepare` succeeded and wrote `reports/release/demo-prep.latest.json`
- [x] Release packaging script
  - Command: `pnpm release:package`
  - Prerequisites: build succeeds
  - Expected: versioned source bundle and release manifest are written under `reports/release/`
  - Status: Passed on 2026-03-24
  - Actual: created `/workspace/GDH/reports/release/gdh-0.8.0-rc.1.tgz` and `/workspace/GDH/reports/release/release-manifest.json`
- [ ] GitHub draft PR flow
  - Command: safe `pnpm gdh pr create <run-id> --json` path after a verified eligible run
  - Prerequisites: `GITHUB_TOKEN`, reachable GitHub API, safe repo target, eligible verified run
  - Expected: draft PR only, review packet publication, and persisted GitHub metadata
  - Status: Not fully validated on 2026-03-24
  - Actual: the environment lacked `GITHUB_TOKEN`, and a local probe with `pnpm gdh pr create release-candidate-demo-run-20260324T123531z-f44266 --json` was conservatively blocked by unrelated working-tree changes before any GitHub side effect
- [x] Final repo verification
  - Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`
  - Prerequisites: all blocker fixes applied
  - Expected: repo validation passes after the release-candidate hardening changes
  - Status: Passed on 2026-03-24
  - Actual: `pnpm release:validate` passed post-fix, covering `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm benchmark:smoke`

## Reporting

- Write the executed results to `reports/release-candidate-report.md`.
- Update `documentation.md` with the key milestones, blockers, fixes, and verification commands from the session.
- The current executed report lives at `/workspace/GDH/reports/release-candidate-report.md`.
