# PLANS.md

## Objective
Package the current Phase 8 release candidate for external technical review and portfolio presentation without changing core behavior. Make the repo faster to understand by surfacing a concise architecture story, a clearer quickstart and demo path, a benchmark summary, explicit scope and non-goals, known limitations, and a short evaluator path through the strongest local evidence.

## Constraints

- Read and follow `codex_governed_delivery_handoff_spec.md`, `AGENTS.md`, `implement.md`, `documentation.md`, and `README.md` before editing.
- Stay inside Phase 8 release-hardening scope and preserve the existing feature set rather than adding new product capabilities.
- Prefer clarity, honesty, and reviewer legibility over breadth or marketing language.
- Use current repo-local evidence wherever possible instead of inventing new claims.
- Keep the default evaluation and demo path local-first, deterministic, and optional-network.
- Update `documentation.md` as the packaging pass progresses and verify the changed docs locally before finishing.

## Milestones

1. In progress: inspect the existing public docs and evidence artifacts, identify what an external reviewer still would not understand quickly, and refresh the session plan for a packaging pass.
2. Pending: create or refine the main reviewer-facing docs so the README, architecture overview, demo walkthrough, and benchmark summary tell one coherent story.
3. Pending: add a concise evaluation path that shows how to assess setup, core governed flows, approvals and verification, benchmark evidence, dashboard inspection, and optional GitHub draft-PR behavior.
4. Pending: document scope, strengths, non-goals, and known limitations more explicitly so the repo is persuasive without overstating maturity.
5. Pending: run bounded verification for the documentation changes, update `documentation.md`, and leave behind a trustworthy external-review package.

## Acceptance Criteria

- An external reviewer can understand what GDH is, why it exists, and what makes it distinct within a few minutes from the README and linked docs.
- A concise architecture overview exists and points clearly to the main packages and artifact-backed lifecycle.
- A benchmark summary exists or is updated with current suite counts, the latest relevant evidence, and honest interpretation limits.
- A demo walkthrough exists that covers a safe `gdh run`, approval and verification surfaces, the benchmark surface, the dashboard surface, and the optional GitHub draft-PR path.
- The repo states current scope, non-goals, and known limitations explicitly.
- A short “how to evaluate this project” path is present for employers or technical reviewers.
- The changed docs pass bounded local verification.

## Risks

- The repo already has many phase notes, reports, and demo artifacts; a packaging pass can easily add one more layer of indirection instead of simplifying the reviewer path.
- Older validation and benchmark evidence can be mistaken for fresh evidence unless the docs anchor dates and artifact ids clearly.
- It is easy to sound more mature than the current product surface just by aggregating the existing materials, so the docs must keep limitations and non-goals prominent.
- Optional live GitHub and live Codex flows may still be unavailable in the local environment, so the docs must distinguish supported surface area from locally revalidated surface area.

## Verification Plan

- Documentation consistency and formatting:
  - `pnpm exec biome check README.md PLANS.md documentation.md docs/architecture-overview.md docs/demo-walkthrough.md docs/architecture/release-candidate-overview.md docs/demos/README.md reports/benchmark-summary.md`
- Link and claim sanity by direct inspection of the referenced local artifacts:
  - `reports/release/demo-prep.latest.json`
  - `reports/release-candidate-report.md`
  - benchmark artifacts under `runs/benchmarks/`
- Use existing fresh release-candidate evidence rather than rerunning behavior unless a doc claim depends on a new command outcome.

## Notes

- This session is a packaging pass, not a feature-expansion pass.
- The new top-level docs should help a reviewer decide quickly whether the project is thoughtful, trustworthy, and technically credible.
- If two docs say similar things, the README should stay concise and link outward rather than duplicating every detail.
