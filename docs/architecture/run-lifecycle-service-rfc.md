# RFC: RunLifecycleService

## Status

Proposed

## Scope

This is a docs-only refactor note for the post-release-candidate implementation backlog. It does not change the current Phase 8 behavior, artifact format, or command surface.

## Context

The governed run lifecycle is coherent, durable, and well covered by artifacts, but the orchestration is now concentrated in one large CLI module instead of one deep lifecycle module.

Today the main lifecycle behavior is split across:

- `apps/cli/src/index.ts#runSpecFile` for initial run creation, planning, policy, approval, runner execution, audit, verification, and review-packet generation
- `apps/cli/src/index.ts#resumeRunId` for resumable re-entry through many of the same stages
- `apps/cli/src/index.ts#statusRunId` and `apps/cli/src/index.ts#prepareRunInspection` for inspection, continuity assessment, and resume eligibility
- helper clusters in the same file such as `persistRunSession`, `persistSessionManifest`, `persistRunCheckpoint`, `persistProgressSnapshot`, `loadRunContext`, and `loadDurableRunState`

That shape was acceptable for Phases 4-8 because it kept the release candidate local, explicit, and inspectable. It now makes further lifecycle changes harder to reason about because state transitions, persistence, and command-specific concerns are interleaved.

## Problem

- `runSpecFile` and `resumeRunId` both encode the same stage machine with similar artifact writes and status transitions.
- Session, manifest, checkpoint, and progress persistence are repeated beside command logic instead of being advanced through one lifecycle abstraction.
- `statusRunId` depends on `prepareRunInspection`, which both inspects and mutates durable lifecycle state, so the read path and repair path are coupled.
- Benchmark and GitHub flows reuse the governed lifecycle through CLI-oriented entrypoints instead of a deeper service boundary.
- Future changes to approval, interruption recovery, or verification handoff will keep widening `apps/cli/src/index.ts` unless the lifecycle is pulled behind a dedicated module.

## Decision

Introduce a `RunLifecycleService` as the main deep module for governed run orchestration while keeping the CLI as a thin command shell.

The first extraction should stay inside `apps/cli` to avoid widening the public package surface during a refactor. A reasonable initial home is `apps/cli/src/services/run-lifecycle-service.ts`. If another package later needs the same boundary, the service can be extracted after the API stabilizes.

## Proposed Responsibilities

`RunLifecycleService` should own:

- creating and loading the durable lifecycle context for a run
- advancing the run through stage transitions from spec normalization through verification completion
- persisting the run record, session record, manifest, checkpoints, progress snapshots, and resume-plan artifacts as one lifecycle concern
- handling approval pauses and approved re-entry without duplicating stage logic across `run` and `resume`
- coordinating runner execution, changed-file capture, diff capture, and policy-audit persistence
- producing the command summaries needed by `gdh run`, `gdh resume`, `gdh status`, and `gdh verify`

It should not own:

- spec normalization or plan generation rules from `packages/domain`
- policy evaluation or approval-packet rendering from `packages/policy-engine`
- verification logic from `packages/verification`
- review-packet rendering from `packages/review-packets`
- file-backed artifact primitives from `packages/artifact-store`
- GitHub delivery details from `packages/github-adapter`

## Proposed Interface

The CLI should eventually delegate to a service boundary close to:

```ts
type RunLifecycleService = {
  startRun(input: StartRunInput): Promise<RunCommandSummary>;
  resumeRun(input: ResumeRunInput): Promise<RunCommandSummary>;
  inspectRun(input: InspectRunInput): Promise<RunInspectionResult>;
  verifyRun(input: VerifyRunInput): Promise<RunCommandSummary>;
};
```

Internally the service should also own smaller step methods such as `advanceToPlan`, `advanceToPolicyDecision`, `resolveApproval`, `executeRunnerStage`, and `completeVerification`, but those helpers should stay private until the lifecycle API settles.

## Extraction Plan

1. Wrap the existing artifact-loading and persistence helpers in a lifecycle context object so the service owns state hydration and artifact paths.
2. Move shared stage-transition writes into service methods that update the run record, manifest, session, checkpoint, and progress snapshot together.
3. Repoint `runSpecFile`, `resumeRunId`, `statusRunId`, and `verifyRunId` to the service so the CLI becomes argument parsing plus presentation only.
4. Have benchmark and GitHub packaging flows call the service APIs rather than coupling themselves to CLI-oriented helpers.
5. Keep the persisted artifact schema stable during the refactor; if the schema must change later, handle that as a separate decision record.

## Expected Outcomes

- the governed lifecycle becomes easier to test as one state machine instead of several command-specific paths
- approval, interruption, and verification behavior become easier to change without widening the CLI entrypoint
- future dashboard, benchmark, or GitHub work can depend on one lifecycle seam without turning those surfaces into alternate control planes
- the repo preserves its current artifact-backed guarantees while reducing orchestration sprawl

## Non-Goals

- changing the current Phase 8 release-candidate behavior
- moving the artifact store away from local file-backed persistence
- introducing multi-agent orchestration, background workers, or hosted services
- weakening policy, approval, verification, or continuity guarantees during the refactor
