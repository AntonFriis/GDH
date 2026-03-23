# Smoke Benchmarks

Use this suite for fast, deterministic, low-risk control-plane coverage that stays cheap enough for regular CI.

- Prefer docs, tests, CI, and bounded refactor tasks with clear expected terminal states.
- Keep smoke fixture-backed, local-only, and reproducible.
- Use smoke for allow, prompt, forbid, and verification-failure paths before promoting broader work into `fresh`.
