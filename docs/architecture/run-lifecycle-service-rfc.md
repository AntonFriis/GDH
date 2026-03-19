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

- Fresh execution, inspection, and resume each reconstruct or advance lifecycle state separately.
- The durable artifact bundle for a stage, including `run.json`, `session.manifest.json`, `progress.latest.json`, checkpoints, events, and stage artifacts such as `spec.normalized.json`, `plan.json`, `policy.decision.json`, `approval-packet.json`, and `verification.result.json`, is coordinated imperatively inside the CLI.
- Resume eligibility and workspace continuity are derived in a different path from the path that advances the run, which increases seam risk between inspection and mutation.
- Verification gating is a lifecycle invariant, but completion logic is still orchestrated from the CLI rather than from a dedicated lifecycle boundary.
- Benchmark and GitHub flows currently reuse the governed lifecycle through CLI-oriented helpers instead of a deeper service boundary.
- The current shape forces broad CLI integration coverage to prove lifecycle choreography and artifact ordering that should instead be owned and tested by one deep module.

## Current Lifecycle Ownership Map

Today the lifecycle is split across several CLI-facing seams:

| Current seam | Main responsibility today | Why it is a refactor target |
| --- | --- | --- |
| `runSpecFile` | Starts new runs, persists the initial run/session/manifest state, then drives planning, policy, approval, runner execution, verification, and packet generation. | One command path owns most forward transitions, so durable lifecycle rules are coupled to CLI argument handling and summary formatting. |
| `prepareRunInspection` and `statusRunId` | Loads persisted state, derives continuity and resume eligibility, persists interruption or resumable state, and formats inspection output. | Inspection mutates lifecycle artifacts and recomputes resume state outside the forward-transition path. |
| `resumeRunId` | Re-enters from stored checkpoints, resolves approval, restarts runner or verification stages, and persists resumed session state. | Resume duplicates stage logic that should share one transition engine with fresh execution. |
| `verifyRunId` | Re-enters deterministic verification and writes terminal verification status for an existing run. | Verification-gated completion is a lifecycle rule, but one command still applies it through its own CLI path. |
| Persistence and loading helpers such as `persistRunSession`, `persistSessionManifest`, `persistRunCheckpoint`, `persistProgressSnapshot`, `loadRunContext`, and `loadDurableRunState` | Coordinate run/session/manifest/checkpoint/progress artifacts and hydrate lifecycle state from disk. | The helpers are reusable, but the rule for which bundle must be written together still lives in command-oriented code. |

The important problem is not that these helpers exist. The problem is that lifecycle ownership is distributed across them instead of concentrated behind one deep module that plans and commits coherent state transitions.

## Transition Bundles That Should Become Atomic

The first service extraction should treat the following durable writes as one lifecycle concern even if they remain file-backed and individually persisted on disk:

| Transition boundary | Durable bundle that should be committed coherently | Current seam risk |
| --- | --- | --- |
| run creation -> `spec_normalized` | `run.json`, initial session record, `session.manifest.json`, initial workspace snapshot, normalized spec artifact, checkpoint, and progress snapshot | Fresh-run setup is easy to drift because early artifact writes are orchestrated inline before the main lifecycle loop settles. |
| `spec_normalized` -> `plan_created` | `plan.json`, updated run and manifest state, checkpoint, progress snapshot, and related event records | Plan-stage persistence is coupled to the run command instead of a reusable stage-transition rule. |
| `plan_created` -> `policy_evaluated` or `awaiting_approval` | `policy.decision.json`, optional `approval-packet.json`, updated approval state, checkpoint, progress snapshot, and event records | Approval and non-approval branches are implemented imperatively, which makes run and resume harder to keep symmetric. |
| `awaiting_approval` -> `approval_resolved` -> `runner_started` | `approval-resolution.json`, updated run/session/manifest approval state, checkpoint, progress snapshot, and restart metadata | Approval re-entry is currently one of the highest seam-risk boundaries because interruption behavior depends on artifact ordering. |
| `runner_started` -> `runner_completed` -> `verification_started` | `runner.result.json`, `commands-executed.json`, `changed-files.json`, `diff.patch`, `policy-audit.json`, checkpoint, progress snapshot, and updated run/session/manifest state | Runner output, audit output, and verification handoff are tightly related but still coordinated across a wide CLI block. |
| `verification_started` -> `verification_completed` -> terminal state | `verification.result.json`, final run/session/manifest state, checkpoint, progress snapshot, `review-packet.json`, and terminal event records | The verification gate is the strongest lifecycle invariant, but terminal completion is still assembled from CLI-managed writes. |

The private transition engine or ledger should make these bundles explicit. A caller should ask to advance a run to the next safe stage and receive a typed result, not manually orchestrate which durable files must be updated first.

## Decision

Introduce a `RunLifecycleService` as the main deep module for governed run orchestration while keeping the CLI as a thin command shell.

The first extraction should stay inside `apps/cli` to avoid widening the public package surface during a refactor. A reasonable initial home is `apps/cli/src/services/run-lifecycle-service.ts`. If another package later needs the same boundary, the service can be extracted after the API stabilizes.

The public service should stay narrow and match the current operator-facing lifecycle needs: `run`, `status`, and `resume`. Internally, a private transition engine or ledger should plan and commit coherent durable state bundles so callers do not need to know artifact-write ordering or stage-advancement ceremony. The existing `gdh verify` command should reuse that same private machinery during migration rather than forcing the first public service boundary to grow prematurely.

## Proposed Responsibilities

`RunLifecycleService` should own:

- the governed run state machine, including stage selection, transition planning, and transition commit
- creating and loading the durable lifecycle context for a run
- persisting the run record, session record, manifest, checkpoints, progress snapshots, and resume-plan artifacts as one lifecycle concern
- handling approval pauses and approved re-entry without duplicating stage logic across `run` and `resume`
- coordinating runner execution, changed-file capture, diff capture, and policy-audit persistence
- deriving workspace continuity, resume eligibility, and inspection summaries from the same lifecycle state used for mutation
- enforcing the completion rule that a run cannot finish without a persisted passing verification result
- producing the command summaries needed by `gdh run`, `gdh resume`, `gdh status`, and any verification wrapper that still exists at the CLI layer

It should not own:

- spec normalization or plan generation rules from `packages/domain`
- policy evaluation or approval-packet rendering from `packages/policy-engine`
- verification logic from `packages/verification`
- review-packet rendering from `packages/review-packets`
- file-backed artifact primitives from `packages/artifact-store`
- GitHub delivery details from `packages/github-adapter`

## Dependency Strategy

- Category: local-substitutable.
- Inject local ports for artifact persistence, workspace snapshotting, runner execution, deterministic verification, policy loading, and spec loading.
- Keep production wiring on the existing file-backed artifact store plus the current runner, policy, verification, and review-packet implementations.
- Keep adapters thin. The lifecycle service owns orchestration; the injected collaborators own their narrow domain logic.
- Tests should use temp repos, fake runners, deterministic verification doubles, and fixture-backed policy or spec inputs rather than live services.

## Proposed Interface

The CLI should eventually delegate to a service boundary close to:

```ts
type RunSource =
  | { kind: 'spec_file'; path: string }
  | { kind: 'github_issue'; ref: string };

interface RunLifecycleService {
  run(input: StartRunInput): Promise<RunCommandSummary>;
  status(runId: string, options?: RunStatusOptions): Promise<RunInspectionResult>;
  resume(runId: string, options?: RunResumeOptions): Promise<RunCommandSummary>;
}

interface StartRunInput {
  cwd: string;
  source: RunSource;
  runner?: RunnerKind;
  approvalMode?: ApprovalMode;
  policyPath?: string;
  githubAdapter?: GithubAdapter;
  githubConfig?: GithubConfig;
  approvalResolver?: ApprovalResolver;
}

interface RunStatusOptions {
  cwd: string;
}

interface RunResumeOptions {
  cwd: string;
  approvalResolver?: ApprovalResolver;
}

interface RunInspectionResult {
  run: Run;
  manifest: SessionManifest;
  continuity: ContinuityAssessment;
  eligibility: ResumeEligibility;
  resumePlan?: ResumePlan;
  latestCheckpoint?: RunCheckpoint;
  latestProgress?: RunProgressSnapshot;
  nextStage?: RunStage;
}
```

If manual verification remains a separate CLI command, it should call the same internal transition engine and inspection types rather than widening the first public interface before the lifecycle boundary settles.

## Factory Wiring Sketch

The first extraction should make the service construction explicit so the CLI can stay thin while local collaborators remain swappable in tests:

```ts
const lifecycle = createRunLifecycleService({
  artifactStoreFactory,
  runnerFactory,
  verification,
  workspace,
  policyLoader,
  specLoader,
});

await lifecycle.run({
  cwd,
  source: { kind: 'spec_file', path: specPath },
  runner: 'codex-cli',
  approvalMode: 'interactive',
  approvalResolver,
});

const inspection = await lifecycle.status(runId, { cwd });

if (inspection.eligibility.eligible) {
  await lifecycle.resume(runId, { cwd, approvalResolver });
}
```

This is intentionally boring wiring. The value is not a clever factory. The value is that one module now owns lifecycle orchestration while the CLI, benchmark adapter, and GitHub delivery paths receive a stable local seam.

## Command Migration Map

The first migration should make each current command or downstream caller depend on the same lifecycle boundary:

| Current caller | Target lifecycle boundary | Notes |
| --- | --- | --- |
| `gdh run` / `runSpecFile` | `RunLifecycleService.run` | CLI remains responsible for argument parsing, repo-root resolution, and terminal formatting only. |
| `gdh status` / `statusRunId` | `RunLifecycleService.status` | Inspection, continuity assessment, and resume planning should come from the same state used for mutation. |
| `gdh resume` / `resumeRunId` | `RunLifecycleService.resume` | Approval resolution and checkpoint restart should reuse the same transition engine as fresh execution. |
| `gdh verify` / `verifyRunId` | private transition entry reused by the service | Keep the public service narrow at first; manual verify should call the same internal verification-completion machinery. |
| benchmark execution helpers | `RunLifecycleService.run` plus `RunLifecycleService.status` | Benchmarks should stop proving CLI choreography and instead exercise the lifecycle seam directly where possible. |
| GitHub publication and iteration helpers | `RunLifecycleService.status` inspection result | Downstream delivery should consume typed lifecycle inspection output instead of reconstructing durable state ad hoc. |

## Internal Shape

Internally, the service should hide:

- stage selection and transition sequencing
- coherent persistence of run, session, manifest, checkpoint, progress, and event artifacts
- workspace continuity checks and resume eligibility evaluation
- restart behavior from stored checkpoints
- the verification-gated completion rule
- command-specific branching needed to preserve the current CLI contract during migration

Private helpers such as `advanceToPlan`, `advanceToPolicyDecision`, `resolveApproval`, `executeRunnerStage`, and `completeVerification` should remain private until the lifecycle API settles.

## Migration Guardrails

The refactor should preserve the current release-candidate guarantees while moving ownership:

- Keep the persisted artifact names and locations stable during the first extraction.
- Keep `run`, `status`, `resume`, and manual `verify` behavior compatible at the CLI boundary while the service settles.
- Keep inspection and mutation derived from the same stored lifecycle state so continuity warnings and resume eligibility cannot drift from the transition engine.
- Keep the approval pause, approval denial, interruption, and verification-failed paths explicit and artifact-backed rather than hiding them behind optimistic retries.
- Keep benchmark, review-packet, and GitHub publication flows dependent on lifecycle inspection results or typed service APIs rather than reconstructing state from ad hoc file reads.
- Keep command-capture reporting honest: the service can centralize lifecycle ownership, but it must not overstate self-reported runner commands as directly observed facts.

## Test Migration Split

The testing goal is not merely to move files around. It is to move lifecycle proof to the right boundary:

| Keep at the CLI boundary | Move behind `RunLifecycleService` |
| --- | --- |
| argument parsing and validation | fresh run lifecycle sequencing |
| command summary formatting | approval pause and approval-resolution re-entry |
| JSON vs terminal output shape | interruption handling and continuity checks |
| user-facing command option plumbing | verification-gated completion |
| thin wiring to injected adapters | durable artifact bundle coherence per stage |

This split matters because the current broad CLI suites are proving state-machine behavior indirectly. After the refactor, the service should carry the heavy lifecycle coverage, while the CLI tests become small and stable.

## Extraction Plan

1. Wrap the existing artifact-loading and persistence helpers in a lifecycle context object so the service owns state hydration and artifact paths.
2. Move shared stage-transition writes into service methods that update the run record, manifest, session, checkpoint, and progress snapshot together.
3. Repoint `runSpecFile`, `resumeRunId`, `statusRunId`, and the existing verification path to the service or its private transition engine so the CLI becomes argument parsing plus presentation only.
4. Have benchmark and GitHub packaging flows depend on lifecycle inspection results or service APIs rather than reconstructing durable state ad hoc through CLI helpers.
5. Replace orchestration-heavy CLI tests with service-boundary tests for lifecycle sequencing and artifact coherence, then keep only thin CLI coverage for argument parsing and summary formatting.
6. Keep the persisted artifact schema stable during the refactor. If the schema must change later, handle that as a separate decision record.

## Testing Strategy

- New boundary tests should cover: starting a docs-only run from a local spec, starting from a GitHub issue source, pausing on a policy prompt, resuming after interruption, refusing resume on incompatible continuity, enforcing the verification gate before completion, asserting durable artifact coherence after stage transitions, and inspecting a run from persisted artifacts only.
- Old broad CLI tests that exist only to prove lifecycle sequencing and artifact ordering should move behind the service boundary, especially the orchestration-heavy slices in `apps/cli/tests/program.test.ts` and `apps/cli/tests/github-flow.test.ts`.
- The test environment should stay local and deterministic: temp git repos, the file-backed artifact store, fake runners, fake verification adapters, and fixture-backed policy or spec inputs.

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
