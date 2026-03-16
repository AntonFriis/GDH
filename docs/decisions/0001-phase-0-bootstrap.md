# Decision 0001: Phase 0 Bootstrap Defaults

## Status
Accepted

## Context

The handoff specification defines the Phase 0 repository shape, toolchain, and operating documents but leaves some implementation details open. The repo started empty, so the bootstrap needed a smallest-clean implementation that stays faithful to the spec without leaking into later phases.

## Decision

Use the following Phase 0 defaults:

- pnpm workspaces + Turborepo for workspace orchestration
- TypeScript ESM packages built with `tsc`
- React + Vite for the web app scaffold
- Fastify for the API scaffold
- minimal placeholder packages and commands instead of a real run loop
- root `pnpm bootstrap` as the single bootstrap entry point
- policy packs, prompts, benchmarks, runs, and reports created as tracked scaffolding

## Consequences

- The repo is immediately usable by Codex and human contributors.
- Internal package boundaries exist early, so Phase 1 work can land without structural churn.
- Some packages intentionally export interfaces and placeholders only; real behavior is deferred to later phases.
