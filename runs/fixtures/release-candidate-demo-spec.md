---
title: v1 Showcase Demo Run
summary: Prepare a low-risk docs artifact that proves the GDH v1 showcase release can generate inspectable governed-run output locally.
task_type: docs
constraints:
  - Stay in Phase 8.
  - Only edit docs/demos/release-candidate-demo-output.md unless a tiny supporting doc change is required.
  - Do not touch secrets, deployment material, or GitHub side effects.
acceptance_criteria:
  - docs/demos/release-candidate-demo-output.md exists after the run.
  - The file says it came from the deterministic fake runner for the v1 Showcase Demo Run.
  - The file keeps the output low-risk, local, and honest about fake-runner limitations.
risk_hints:
  - Keep the task docs-only and reversible.
---

# v1 Showcase Demo Run

## Objective
Create or update `docs/demos/release-candidate-demo-output.md` with a short note that proves the GDH v1 showcase release can prepare a local governed demo artifact set without live GitHub or live Codex access.

## Constraints
- Stay in Phase 8.
- Keep the output deterministic, low-risk, and easy to inspect in the dashboard afterward.
- Do not claim live external side effects or production readiness.

## Acceptance Criteria
- `docs/demos/release-candidate-demo-output.md` exists.
- The content says it came from the deterministic fake runner for the v1 Showcase Demo Run.
- The content notes that the generated file is a local demo artifact rather than proof of external side effects.
