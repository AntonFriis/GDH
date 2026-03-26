# v1 Release Report

Date: 2026-03-26
Version: `1.0.0`
Checklist: [../docs/operations/release-candidate-checklist.md](../docs/operations/release-candidate-checklist.md)

## Overall Assessment

GDH is ready to present as a public, local-first showcase release. The governed run surface, deterministic verification, benchmark smoke gate, and local dashboard were already stable; the remaining work for v1 was packaging that evidence in a portable, reviewer-friendly way.

The v1 pass keeps the product scope intentionally narrow:

- local-first artifacts remain the source of truth
- GitHub delivery stays draft-only and optional
- the benchmark harness remains deterministic and fixture-backed
- live `codex-cli` and live GitHub flows remain documented as optional, not assumed

## What Changed For v1

- added MIT licensing and contributor guidance
- added `pnpm lint:links` to catch broken or machine-specific Markdown links
- added `pnpm review:quick` to run the local validation lane and generate a filled review checklist
- refreshed public docs and runtime wording from release-candidate positioning to `1.0.0`
- added a small reviewer-lane asset to the README so the repo has immediate visual context on GitHub

## Executed v1 Evidence

- `pnpm release:validate` passed on 2026-03-26, including the smoke regression gate with benchmark run `benchmark-smoke-20260326T165749z-1255b4`.
- `pnpm review:quick` passed on 2026-03-26 and generated:
  - demo run `v1-showcase-demo-run-20260326T165804z-06b706`
  - smoke benchmark `benchmark-smoke-20260326T165807z-afc733`
  - reviewer artifacts `reports/review-checklist.md` and `reports/review-checklist.latest.json`
- `pnpm dashboard:dev` was started locally after the reviewer lane. `http://127.0.0.1:3000/health` returned `{"status":"ok","phase":"v1"}`, and the generated run plus benchmark records resolved through `/api/runs/v1-showcase-demo-run-20260326T165804z-06b706` and `/api/benchmarks/benchmark-smoke-20260326T165807z-afc733`.

## Confidence And Remaining Limits

What the repo now supports confidently:

- a clean local validation path through `pnpm release:validate`
- a repeatable reviewer lane through `pnpm review:quick`
- durable artifact inspection through the dashboard and tracked evidence docs
- deterministic benchmark regression gating through the smoke suite

What remains intentionally conservative:

- GitHub publish-path evidence is still weaker than the offline path when `GITHUB_TOKEN` is absent
- live `codex-cli` command capture still depends partly on runner-reported output
- the repo is a local workflow artifact, not a hosted service or autonomous delivery bot

## Reviewer Entry Points

- [../README.md](../README.md)
- [benchmark-summary.md](benchmark-summary.md)
- [benchmark-corpus-summary.md](benchmark-corpus-summary.md)
- [../docs/architecture-overview.md](../docs/architecture-overview.md)
- [../docs/demo-walkthrough.md](../docs/demo-walkthrough.md)
