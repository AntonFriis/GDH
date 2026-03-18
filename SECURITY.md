# Security And Conservative Operations

This project is a local-first release candidate, not a hosted production service.

## Safe Defaults

- `.codex/config.toml` disables network access by default.
- GitHub integration is opt-in and requires an explicit `GITHUB_TOKEN`.
- GitHub delivery is limited to issue reads, branch preparation, draft PR creation, PR body/comment publication, and explicit PR comment reads for local iteration flows.
- The release candidate does not ship merge automation, deploy hooks, background workers, or webhook processors.

## Credentials

- Do not commit `.env`, `.env.local`, or other credential files.
- Use `.env.example` only as a supported-variable reference.
- `GITHUB_TOKEN` is required only when you use GitHub issue or PR commands.
- The repo does not auto-provision credentials or fall back to unsafe defaults when credentials are missing.

## Trust Boundaries

- Treat auth, permissions, billing, migrations, secrets, and infrastructure as protected zones.
- Treat policy evaluation, approval artifacts, verification results, and review packets as evidence, not guarantees of correctness or safety.
- Treat the fake runner as a deterministic demo/testing harness, not proof of live Codex execution.

## Current Limitations

- Command capture from the live Codex runner is still partially self-reported.
- Verification is deterministic and conservative, but it is not a formal proof or a substitute for human review on risky changes.
- Resume works only from explicit safe checkpoints.
- The dashboard is read-only over persisted artifacts and does not manage live workflow state.
- The repo has no hosted multi-user environment and no long-running worker infrastructure.

## Reporting

This release candidate does not yet define a public vulnerability disclosure program. Treat the repo as an early local-use artifact and route security-sensitive findings to the project owner directly rather than opening public exploit details by default.
