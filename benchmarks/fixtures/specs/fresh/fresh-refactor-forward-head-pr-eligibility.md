---
title: Fresh Refactor Forward Head PR Eligibility
task_type: refactor
constraints:
  - Keep the change bounded to the fixture continuity and artifact-store seam.
acceptance_criteria:
  - Update `apps/cli/src/index.ts`.
  - Update `packages/artifact-store/tests/file-artifact-store.test.ts`.
---

# Fresh Refactor Forward Head PR Eligibility

## Objective
Update `apps/cli/src/index.ts` and `packages/artifact-store/tests/file-artifact-store.test.ts` with a benchmark-only note about tolerating forward HEAD movement for draft PR eligibility.
