---
title: Phase 2 Policy Smoke Run
summary: Exercise the local Phase 2 `cp run` flow with a docs-only change that should pass policy automatically.
task_type: docs
constraints:
  - Stay in Phase 2.
  - Only edit docs/demos/phase2-policy-smoke-output.md unless a tiny supporting doc change is required.
  - Do not touch protected paths, secrets, or GitHub side effects.
acceptance_criteria:
  - docs/demos/phase2-policy-smoke-output.md exists after the run.
  - The file says it came from a Phase 2 policy smoke run.
  - The file mentions impact preview, policy gating, and post-run policy audit.
risk_hints:
  - Keep the task docs-only and reversible.
---

# Phase 2 Policy Smoke Run

## Objective
Create or update `docs/demos/phase2-policy-smoke-output.md` with a short note that proves the local Phase 2 governed run can preview impact, evaluate policy, and complete a low-risk docs task end to end.

## Constraints
- Stay in Phase 2.
- Keep the output brief and deterministic.
- Do not introduce network calls, protected-path edits, or claims that Phase 3 verification already exists.

## Acceptance Criteria
- `docs/demos/phase2-policy-smoke-output.md` exists.
- The content says this file is the result of a Phase 2 policy smoke run.
- The content notes that impact preview, policy gating, and post-run policy audit now exist.
