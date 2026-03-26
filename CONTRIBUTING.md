# Contributing

Thanks for taking a look at GDH.

This repository is intentionally scoped as a local-first, evidence-backed control plane for governed agentic delivery. Contributions should preserve that tone: conservative defaults, inspectable artifacts, deterministic validation, and clear non-goals.

## What Good Changes Look Like

- Keep the governed run, policy, verification, review-packet, and benchmark surfaces legible.
- Prefer small, explicit seams over speculative abstractions.
- Treat GitHub delivery as a conservative packaging boundary, not an automation escape hatch.
- Preserve the repo's local-first posture. Networked flows should remain optional and clearly documented.

## Before Opening A PR

Run the local validation flow:

```bash
pnpm release:validate
```

If you are changing reviewer-facing docs or scripts, also run:

```bash
pnpm review:quick
```

## Scope Guardrails

- Do not add merge automation, deploy hooks, background workers, or hosted control-plane services.
- Do not weaken the policy or verification boundaries to make demos look smoother.
- Do not expand the benchmark surface with live-auth or flaky network requirements in the default path.

## Working Style

- Keep diffs minimal and focused.
- Add or update deterministic tests when behavior changes.
- Update `documentation.md` with meaningful milestones and verification commands.
- Prefer repo-relative links and portable artifacts so the project stays legible on GitHub.
