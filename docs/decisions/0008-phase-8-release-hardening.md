# 0008 Phase 8 Release Hardening

## Status

Accepted

## Context

Phase 7 completed the local dashboard and analytics layer, but the repo still read like an internal implementation workspace. The handoff specification defines Phase 8 as the point where the project becomes a credible external artifact with install docs, demo flow, benchmark reporting, architecture material, and security notes.

The key constraint is that Phase 8 must harden what already exists rather than open a new feature phase.

## Decision

Implement Phase 8 as a release-candidate hardening pass over the current local-first control plane.

Concretely:

- keep the existing governed run, verification, GitHub, benchmark, and dashboard architecture intact
- add explicit release-candidate scripts for validation, demo preparation, and local source packaging
- keep the default demo path deterministic and local by using the fake runner plus the smoke benchmark suite
- align environment docs with the variables the code actually consumes and keep networked flows opt-in
- document trust boundaries, operational limitations, architecture, benchmark context, and demo steps directly in the repo
- version the repo as a release candidate without introducing publish, merge, or deploy automation

## Consequences

Positive:

- a new contributor can clone, install, validate, and demo the repo without tribal knowledge
- the release path stays honest about local-only boundaries and deterministic fixtures
- the repo has a clear narrative for portfolio review and technical evaluation

Tradeoffs:

- packaging remains a local source-bundle workflow rather than a fully standalone CLI distribution
- the default demo still uses the deterministic fake runner rather than live Codex execution
- security notes document conservative boundaries and limitations, but they do not imply a formal external security audit
