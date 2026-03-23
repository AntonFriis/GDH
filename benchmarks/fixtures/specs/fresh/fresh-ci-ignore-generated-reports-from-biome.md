---
title: Fresh CI Ignore Generated Reports From Biome
task_type: ci
constraints:
  - Keep the change deterministic and local to the fixture repository.
acceptance_criteria:
  - Update `biome.json`.
  - Update `README.md`.
---

# Fresh CI Ignore Generated Reports From Biome

## Objective
Update `biome.json` and `README.md` with a benchmark-only note that generated report artifacts stay out of lint validation.
