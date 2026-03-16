# Governed Delivery Control Plane

This repository bootstraps a Codex-first governed agentic delivery control plane. The product sits above a coding agent and is meant to plan, execute, verify, document, and eventually package software-delivery work under explicit policies and review evidence.

## What Phase 0 Includes

Phase 0 is intentionally narrow. It establishes:

- a pnpm + Turborepo TypeScript monorepo
- Codex operating docs and local repository rules
- minimal placeholder apps and packages for the target architecture
- baseline policies, prompts, benchmark folders, and docs structure
- root validation commands and a minimal CI workflow

Phase 0 does not implement the real governed run loop yet. There is no production policy enforcement, no durable run execution, no GitHub side-effect workflow, and no multi-agent orchestration in this phase.

## Stack

- Node.js 20+
- TypeScript
- pnpm workspaces + Turborepo
- Fastify
- React + Vite
- SQLite + Drizzle
- Zod
- Biome
- Vitest
- Playwright
- Octokit
- Codex CLI first, Codex SDK as the preferred programmatic interface

## Repository Highlights

- `apps/cli`: placeholder `cp` CLI contract for future governed runs
- `apps/api`: local Fastify API surface with a health endpoint
- `apps/web`: dashboard scaffold for visibility into the control plane
- `packages/`: domain, runner, policy, verification, review packet, GitHub, eval, prompts, and storage packages
- `policies/` and `prompts/`: version-controlled policy packs and prompt templates
- `docs/`: architecture notes, decisions, references, and demos
- `runs/` and `reports/`: local run artifacts and report outputs

## Bootstrap And Validation

1. Ensure Node.js 20+ and pnpm 10+ are available.
2. Run `pnpm bootstrap`.
3. Run `pnpm validate`.

The default validation flow is:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

## Codex Operating Surface

The repository is designed to be resumed cleanly by Codex sessions.

- [`AGENTS.md`](/Users/anf/Repos/GDH/AGENTS.md) defines repo purpose, layout, commands, constraints, and done criteria.
- [`PLANS.md`](/Users/anf/Repos/GDH/PLANS.md) holds the durable execution plan for multi-step work.
- [`implement.md`](/Users/anf/Repos/GDH/implement.md) describes how implementation sessions should proceed.
- [`documentation.md`](/Users/anf/Repos/GDH/documentation.md) acts as the live audit log.
- [`.codex/config.toml`](/Users/anf/Repos/GDH/.codex/config.toml) provides conservative project-local Codex defaults.

## Next Phase

Phase 1 is the local end-to-end run loop:

- normalize a spec into a `Spec`
- create a `Plan`
- create a `Run`
- implement the `CodexCliRunner`
- log events and artifacts locally
- produce a markdown review packet for a low-risk smoke task

The Phase 0 bootstrap is done when the workspace installs cleanly, the validation commands pass, and the repo structure is ready for that Phase 1 implementation work.
