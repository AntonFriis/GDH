# PLANS.md

## Objective
Validate the current Phase 8 release candidate end to end, record a concrete release-candidate checklist with observed outcomes, fix genuine release blockers discovered during that validation, tighten install/setup and operator docs, and leave behind a trustworthy release-candidate report artifact.

## Constraints

- Read and follow `codex_governed_delivery_handoff_spec.md`, `AGENTS.md`, `implement.md`, `documentation.md`, and `README.md` before editing.
- Stay inside Phase 8 release-hardening scope and preserve the existing feature set rather than adding new major capabilities.
- Prioritize trust, installability, consistency, and evidence-backed reporting over polish.
- Use deterministic/local paths where possible and keep network-dependent GitHub validation optional.
- Treat the checklist and report as factual validation artifacts: record the command used, prerequisites, expected behavior, actual behavior, pass/fail, blocker severity, and any fix that was applied.

## Milestones

1. In progress: read the authoritative docs, inspect the current release scripts and fixtures, and refresh the session plan for a release-candidate validation pass.
2. Pending: add a concrete release-candidate checklist artifact that covers bootstrap, happy path, approval, forbid, verification, status, resume, benchmark smoke, dashboard startup, and optional GitHub draft-PR validation.
3. Pending: execute the checklist against the current repo, capture pass/fail evidence for each major flow, and identify any release blockers.
4. Pending: fix high-priority blockers discovered during validation, with emphasis on install/setup, happy path, approvals, verification, status/resume, benchmark smoke, dashboard startup, and misleading docs.
5. Pending: rerun the necessary validation commands, update `documentation.md`, and publish `reports/release-candidate-report.md` with the final release-candidate assessment.

## Acceptance Criteria

- The repo contains a concrete release-candidate checklist that an operator can execute.
- The main flows are validated and recorded with evidence-backed pass/fail outcomes.
- High-priority blockers discovered during the sweep are fixed or clearly documented.
- Install/setup and release-candidate docs are tightened where they were misleading or incomplete.
- A release-candidate report exists under `reports/` and summarizes the repo’s current strength and remaining gaps.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass after the hardening fixes.

## Risks

- Release helper scripts can drift from the actual executable CLI entrypoint and create false confidence unless they are exercised directly.
- Dashboard startup validation can become flaky if it depends on manual observation instead of a bounded startup probe.
- Live GitHub or live Codex validation may be unavailable in the local environment, so the report must distinguish unvalidated optional paths from passing local flows.
- The repo contains many historical artifacts; the report must clearly separate this session’s fresh validation from older evidence.

## Verification Plan

- Checklist-driven flow validation:
  - `pnpm bootstrap`
  - `pnpm gdh --help`
  - `pnpm gdh run runs/fixtures/release-candidate-demo-spec.md --runner fake --approval-mode fail --json`
  - approval-required path via a protected-path fixture
  - forbidden-path/blocking path via a forbidden fixture
  - `pnpm gdh status <run-id> --json`
  - `pnpm gdh resume <run-id> --json`
  - `pnpm gdh verify <run-id> --json`
  - `pnpm benchmark:smoke`
  - bounded dashboard startup probe
  - safe GitHub draft-PR validation if credentials and environment permit
- Release scripts:
  - `pnpm demo:prepare`
  - `pnpm release:package`
- Final repo verification:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`

## Notes

- The release-candidate report should be explicit about prerequisites and environment limitations so operators do not mistake “not attempted” for “passed”.
- Any blocker fix in this session should come from a failed or misleading validation path rather than speculative cleanup.
