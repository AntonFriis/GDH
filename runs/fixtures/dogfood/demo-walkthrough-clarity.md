---
title: Demo Walkthrough Clarity Pass
summary: Tighten the demo walkthrough so a new operator can understand the local demo flow and the resulting artifact trail without guesswork.
task_type: docs
constraints:
  - Only edit docs/demos/README.md.
  - Keep the walkthrough local-first and conservative.
  - Do not add promises about live GitHub or live Codex behavior.
acceptance_criteria:
  - The walkthrough explains the default demo path and the main artifact outputs more clearly.
  - The walkthrough stays consistent with README.md and the current scripts.
  - No files besides docs/demos/README.md are edited.
risk_hints:
  - Keep this docs-only and operator-focused.
---

# Demo Walkthrough Clarity Pass

## Objective
Improve `docs/demos/README.md` so a careful operator can follow the local demo flow, find the resulting artifacts, and understand what is and is not covered by the default demo path.

## Constraints
- Only edit `docs/demos/README.md`.
- Keep the demo local, deterministic, and honest.
- Prefer clarifying existing steps over adding new workflow claims.

## Acceptance Criteria
- The default demo path is easy to follow from the repo root.
- The key output artifacts are easier to locate after `pnpm demo:prepare`.
- The doc remains explicit that GitHub and live Codex flows are optional and outside the default demo path.
