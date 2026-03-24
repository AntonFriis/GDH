---
title: README Benchmark Tier Note
summary: Correct the stale README limitation note so it matches the current benchmark tiers without changing product scope.
task_type: docs
constraints:
  - Only edit README.md.
  - Keep the change factual and concise.
  - Do not change commands, scripts, or version numbers.
acceptance_criteria:
  - README no longer says the smoke suite is the only seeded benchmark suite.
  - README still makes it clear that smoke is the default CI-safe gate.
  - No files besides README.md are edited.
risk_hints:
  - Keep this docs-only and reversible.
---

# README Benchmark Tier Note

## Objective
Update the benchmark-related limitation note in `README.md` so it accurately reflects the current benchmark surface.

## Constraints
- Only edit `README.md`.
- Keep the change small, factual, and consistent with the implemented benchmark docs.
- Do not widen scope into new benchmark behavior or code changes.

## Acceptance Criteria
- The README no longer says that only the smoke suite exists.
- The README still explains that `smoke` is the default CI-safe gate and that broader suites are intentional rather than default.
- The result remains conservative and honest about current limits.
