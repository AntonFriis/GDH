# PLANS.md

## Objective
Implement only Phase 8 from `codex_governed_delivery_handoff_spec.md`: harden the existing Phase 1-7 governed delivery control plane into a credible local release candidate that a new contributor can install, validate, understand, and demo without tribal knowledge.

## Constraints
- Stay within Phase 8 boundaries.
- Do not add major new product capabilities beyond release hardening, packaging, demo readiness, security/default tightening, and documentation cleanup.
- Preserve the existing artifact-backed guarantees: policy evaluation remains inspectable, approvals are never bypassed, verification still gates completion, resume remains continuity infrastructure, GitHub stays draft-only delivery, benchmarks stay deterministic, and the dashboard stays read-only over persisted artifacts.
- Prefer the smallest clean changes that materially improve installation, release flow, and reviewer legibility.
- Keep network access optional and disabled by default in repo config and docs.
- Do not add hosted infrastructure, background workers, merge/deploy automation, or multi-agent orchestration.
- Treat release packaging as a local operator workflow, not a publish or deployment pipeline.

## Milestones
1. Capture the Phase 8 release-hardening plan and live audit baseline for this implementation session.
2. Harden repo install and packaging ergonomics: coherent root scripts, deterministic bootstrap, CLI release packaging, version metadata, and clear startup commands for CLI, API, and web/dashboard surfaces.
3. Tighten environment/default handling so documented settings match the code paths that actually consume them, and make missing-configuration behavior explicit and conservative.
4. Add or refine release-candidate demo assets: a fixture-backed local demo path, a concise walkthrough, architecture summary material, and benchmark/reporting context that stays grounded in real repo behavior.
5. Perform a Phase 8 security and conservative-ops pass over defaults, docs, and release-facing guidance, then capture trust boundaries and known limitations clearly.
6. Refresh release-facing docs and metadata across `README.md`, `AGENTS.md`, `documentation.md`, and architecture/decision records so the repo reads as a coherent release candidate instead of a phase-internal workspace.
7. Run the full release validation sweep, fix any regressions, and record the verified outcomes plus remaining intentional limitations.

## Acceptance Criteria
- A clean machine can follow the documented install path and reach a working local checkout with `pnpm bootstrap`.
- Root scripts clearly expose bootstrap, build, typecheck, lint, test, benchmark smoke, demo prep, dashboard startup, release validation, and local release packaging flows.
- The CLI remains coherent from a source checkout and can also be packaged locally as a release candidate artifact.
- `.env.example` and the docs describe only supported configuration surfaces, and missing required GitHub credentials fail clearly.
- A reviewer can follow a real demo path that generates governed-run artifacts quickly and then inspect them through the dashboard without live external services.
- The repo includes an up-to-date architecture summary, demo instructions, benchmark/reporting context, security/ops notes, and explicit limitations for the current release candidate.
- Root `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and the benchmark smoke path pass after the changes.

## Risks
- Accidentally widening scope into new product behavior rather than hardening the existing surfaces.
- Publishing misleading configuration guidance by documenting environment variables or flows that the code does not actually honor.
- Adding packaging or demo automation that depends on live GitHub or live Codex access, which would weaken the deterministic local release path.
- Over-cleaning historical phase docs in ways that erase important repo context instead of clarifying the current release state.
- Treating release polish as justification for unsafe defaults such as implicit network access, hidden credential loading, or broader GitHub side effects.

## Verification Plan
- `pnpm bootstrap`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm benchmark:smoke`
- `pnpm release:validate`
- `pnpm demo:prepare`
- `pnpm release:package`
- `pnpm gdh --help`

## Rollback / Fallback
- Keep packaging and demo additions additive and local-first; avoid changing the governed run model or artifact formats unless a release-blocking inconsistency requires it.
- If a release helper script becomes brittle, prefer documenting the manual command sequence and keeping the underlying surfaces stable.
- If a docs or metadata cleanup would hide historical phase context, preserve the old material and layer a clear release-candidate summary on top instead.
- If local packaging cannot be made robust without wider refactors, keep the release workflow at the built-source-checkout level and surface the limitation honestly in the docs.

## Notes
- Phase 8 is the point where the repo should read like a credible external artifact rather than an author-only build log.
- Demo assets must stay honest: no fabricated run outputs, benchmark claims, or hosted-service assumptions.
- Security hardening here means conservative defaults, explicit trust boundaries, and clearer operational guidance, not a claim of formal security review completeness.
