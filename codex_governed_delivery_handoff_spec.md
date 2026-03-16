# Handoff Document and Initial Specification
## Codex-First Governed Agentic Delivery Control Plane

**Status:** Initial implementation handoff  
**Primary execution backend:** OpenAI Codex CLI / SDK  
**Document owner:** Anton Friis (project sponsor)  
**Audience:** Future self, Codex sessions, external collaborators, prospective maintainers

---

## 1. Purpose of this document

This document is a repo-ready handoff and initial specification for building a **governed execution layer for agentic software delivery**.

The product is **not** another general-purpose coding agent. It is a **control plane above a coding agent** that can:

- accept a spec, issue, task, or release note as input,
- turn that input into a bounded execution plan,
- run the task through Codex under explicit policies,
- require approvals for sensitive actions,
- persist plans, artifacts, traces, and verification evidence,
- produce a trustworthy review packet and draft PR,
- score runs with benchmarked evals,
- eventually compare strategies and learn what work should or should not be delegated.

The initial implementation should be **Codex-first**, because Codex already provides the execution substrate for reading, editing, and running code locally and through the SDK. The product’s differentiator is **governance, continuity, verification, and delivery analytics** rather than raw autonomy.

---

## 2. Product thesis

### 2.1 One-sentence thesis

Build a **Codex-native control plane for governed software-delivery runs**: plan, execute, checkpoint, verify, review, and score.

### 2.2 What the product is

A developer-facing and manager-legible system that sits above Codex and answers:

- What work should be delegated?
- Under which permissions and policies?
- What did the agent actually do?
- What evidence supports the result?
- Where did humans intervene?
- Was the run worth the cost, latency, and review burden?

### 2.3 What the product is not

It is **not** primarily:

- a Codex clone,
- a Claude Code clone,
- a general-purpose multi-agent framework,
- a loose prompt pack,
- a job auto-apply bot,
- a GitHub Actions automation library,
- or a generic eval dashboard with no operational layer.

### 2.4 Why now

Current research and product direction converge on the same implementation pattern:

- start with a **single capable agent** and well-defined tools,
- treat **context engineering** as a systems problem,
- use durable **artifacts** to bridge long-running work,
- make **policies and approvals** first-class,
- run **evals** as part of product development,
- add multi-agent and multi-runner complexity only after benchmarks justify it.

---

## 3. Research-derived design principles

This section translates recent research and official platform guidance into requirements.

### 3.1 Principle A — Single-runner first

Start with a single Codex-backed runner before adding multiple agent roles or multiple model backends.

**Why:** OpenAI’s current guidance recommends maximizing a single agent’s capabilities first and introducing multi-agent splits only when tool overload or instruction complexity clearly justify it. Anthropic makes a similar point: successful systems often use simple, composable patterns instead of prematurely complex frameworks.

**Specification consequence:**

- v0 and v1 use one primary `CodexRunner` abstraction.
- Any planner / reviewer / verifier separation should initially be conceptual modules, not separate independent agent processes.
- Multi-agent orchestration is deferred to a later phase and must earn its way in through evals.

### 3.2 Principle B — Artifact-centric context engineering

The system should preserve **artifacts**, not rely on raw chat history.

**Why:** Anthropic’s recent context-engineering guidance emphasizes that tools should be clear, token-efficient, and minimally overlapping, and that bloated toolsets and bloated context are common failure modes.

**Specification consequence:**

Treat these as first-class persisted objects:

- `Spec`
- `Plan`
- `TaskGraph`
- `Run`
- `ApprovalPacket`
- `VerificationResult`
- `ReviewPacket`
- `EvalRun`
- `ProgressLog`

The system should pass compact summaries and links to artifacts into the agent context rather than replaying full transcripts.

### 3.3 Principle C — Long-running work needs continuity scaffolding

Codex and similar agents can now handle long-horizon work, but the project must explicitly scaffold continuity.

**Why:** OpenAI’s long-horizon Codex guidance highlights spec files, `PLANS.md`, a runbook, continuous verification, and a live documentation / audit log. Anthropic’s long-running harness guidance emphasizes an initializer step and artifact-based session continuity.

**Specification consequence:**

Every repository created for this project should contain and maintain:

- `AGENTS.md`
- `PLANS.md`
- `implement.md`
- `documentation.md`
- `.codex/config.toml`
- a persistent run store

### 3.4 Principle D — Governance is core infrastructure

Policies and approvals must exist from the first milestone.

**Why:** OpenAI’s governance guidance recommends policies as code, automatic guardrails, and defense evaluation from day one. GitHub Agentic Workflows similarly default to read-only permissions, explicit write approvals, safe outputs, and sandboxed execution.

**Specification consequence:**

- path-based, action-based, and task-class-based policy enforcement are mandatory in v1,
- high-risk zones require approval before Codex may proceed,
- all policy decisions are logged as structured events.

### 3.5 Principle E — Evals are part of the product

The product should not rely on anecdotal success.

**Why:** OpenAI Agent Evals recommends reproducible evaluations, datasets, and trace grading; Anthropic’s eval guidance defines agent evals in terms of tasks, trials, and graders.

**Specification consequence:**

- v1 must ship with a benchmark directory and graders,
- regressions must be testable in CI,
- changes to prompts, tools, policies, or routing logic should be measurable.

### 3.6 Principle F — Early task classes should be low-risk

The alpha should focus on the task types agents handle best.

**Why:** A 2026 study of 33k agent-authored PRs found that documentation, CI, and build-update tasks merge best, while performance and bug-fix tasks perform worst. Larger diffs, more files touched, and CI failures correlate with lower merge success.

**Specification consequence:**

v0/v1 target classes:

- docs improvements,
- test coverage additions,
- CI and workflow maintenance,
- small structured refactors,
- release-note generation,
- review packet generation,
- issue triage support.

Deferred classes:

- auth-sensitive changes,
- billing,
- migrations,
- performance tuning,
- complex bug-fix work,
- production deploy logic.

### 3.7 Principle G — PR messaging must be verified

The review packet should not trust the model’s natural-language summary.

**Why:** Research on PR message-code inconsistency found that PR descriptions claiming unimplemented changes were common among high-inconsistency cases, and high inconsistency correlated with substantially lower acceptance rates and slower merges.

**Specification consequence:**

The system must implement a **PR summary verifier** that compares claims in the review packet with:

- the actual diff,
- test evidence,
- changed files,
- task completion checklist,
- approval decisions.

### 3.8 Principle H — Recursive decomposition is a targeted feature

Use recursive decomposition only for oversize tasks or large-context repos.

**Why:** Recursive Language Models propose examining long input as an external environment and recursively decomposing relevant slices. This is useful for large repos and long PRDs, but should be applied deliberately, not as the baseline path.

**Specification consequence:**

- standard tasks use a normal plan-first loop,
- recursive repo/spec decomposition is a feature flag added later,
- it is only enabled when evals show better outcomes on large-context tasks.

### 3.9 Principle I — AutoResearch applies as bounded internal self-improvement

Karpathy’s `autoresearch` pattern is relevant, but it should optimize the product internally rather than define the entire product.

**Why:** The important transferable pattern is bounded autonomous iteration against a hard eval.

**Specification consequence:**

Later phases may include an `autotune` mode that can modify only safe surfaces such as:

- planner prompt pack,
- reviewer prompt pack,
- policy thresholds,
- report templates,
- eval grader weights,

and keep or discard those changes based on benchmark results.

---

## 4. Product scope

## 4.1 v0 scope

Goal: create a local, Codex-first, repo-bound controlled runner that can:

1. read an input spec or issue,
2. create a structured plan,
3. execute bounded low-risk work through Codex,
4. pause for protected paths or actions,
5. run local verification,
6. produce a markdown review packet,
7. log the full run.

## 4.2 v1 scope

Goal: make v0 stable and release-ready for local and GitHub draft PR workflows.

Adds:

- durable run store,
- stronger policy DSL,
- review packet verifier,
- benchmark suite and CI regression checks,
- GitHub issue ingestion and draft PR creation,
- resume / replay support,
- basic web dashboard.

## 4.3 Explicit non-goals for v1

- autonomous merges,
- autonomous production deploys,
- open internet by default,
- vendor-agnostic multi-runner routing,
- broad multi-agent orchestration,
- performance optimization tasks,
- arbitrary self-modifying system behavior,
- organization-wide SaaS deployment.

---

## 5. Core workflows

## 5.1 Workflow A — Spec-to-run

1. User provides a spec file, issue URL, or markdown task.
2. System normalizes it into a `Spec` object.
3. System produces a `Plan` with milestones and task units.
4. Policy engine classifies the task class and risk.
5. Codex executes allowed steps.
6. Protected actions produce approval packets.
7. Verification runs.
8. Review packet is generated.
9. Eval score is computed.
10. Run is marked complete, blocked, or failed.

## 5.2 Workflow B — Resume long-running task

1. User resumes a prior run.
2. System loads the run summary, latest artifacts, pending approvals, and verification status.
3. Codex receives only the compact working state plus relevant artifact references.
4. Run continues from the next unresolved milestone.

## 5.3 Workflow C — GitHub issue to draft PR

1. User points the system at a GitHub issue.
2. System fetches issue context and linked files / labels.
3. A governed run executes locally on a branch.
4. Review packet and diff evidence are generated.
5. Draft PR is created only after verification passes and policy checks are satisfied.

## 5.4 Workflow D — Benchmark / regression run

1. User or CI selects a benchmark suite.
2. The runner executes tasks under a pinned configuration.
3. Graders score outcomes.
4. Results are written to the benchmark ledger.
5. Regressions fail CI.

---

## 6. Opinionated technology choices

This stack is intentionally pragmatic. It is chosen to maximize implementation speed inside Codex while keeping the system observable and maintainable.

## 6.1 Mandatory core stack

### Runtime and language

- **Node.js 20 LTS or newer**
- **TypeScript** for the main codebase

**Reasoning:** The Codex SDK TypeScript library is a natural fit for a Codex-first internal tool. A single TypeScript monorepo reduces interface friction across CLI, API, runner, policy engine, and dashboard.

### Monorepo

- **pnpm workspaces**
- **Turborepo**

**Reasoning:** Fast setup, simple workspace boundaries, deterministic installs, and convenient task graph orchestration.

### Execution backend

- **Codex CLI** for the bootstrap phase
- **Codex SDK** as the preferred programmatic interface

**Reasoning:** Start with what already works locally. The CLI gives a usable bootstrap path; the SDK becomes the clean long-term interface.

### API server

- **Fastify**

**Reasoning:** Small, fast, easy to type, and plugin-friendly. Good fit for a local-first internal service.

### Web dashboard

- **React + Vite**

**Reasoning:** Fast iteration, low ceremony, easy internal dashboard. Avoid a heavier full-stack web framework until necessary.

### Data layer

- **SQLite** for local alpha and v0/v1 dogfooding
- **Drizzle ORM**
- **PostgreSQL** as a planned scale-up path after v1

**Reasoning:** SQLite keeps setup simple. Drizzle provides type-safe schema and migration support. Postgres can be added later without redesigning the domain model.

### Validation and typing

- **Zod** for runtime schemas at API boundaries

### Tooling

- **Biome** for formatting and linting
- **Vitest** for unit and integration tests
- **Playwright** for dashboard end-to-end tests
- **GitHub Actions** for CI
- **Octokit** for GitHub integration

## 6.2 Optional later technologies

These are useful later, but should not be in the first implementation unless a specific need appears.

- **OpenAI Agents SDK** for more complex orchestration or trace plumbing
- **Temporal** for more durable distributed job orchestration if you outgrow local run state
- **OpenTelemetry** once traces and dashboards need standardized export
- **Redis / BullMQ** if background execution needs a dedicated queue before a fuller workflow engine
- **MCP servers** for repo-specific or external tool augmentation beyond plain file / git / GitHub access

## 6.3 Technologies intentionally deferred

- LangGraph / CrewAI / broad external orchestration frameworks
- complex event buses
- Kubernetes
- cloud-first multi-tenant infrastructure
- browser automation as a core dependency
- any general-purpose “agent marketplace” layer

---

## 7. Target repository layout

```text
.
├── AGENTS.md
├── PLANS.md
├── implement.md
├── documentation.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── biome.json
├── .editorconfig
├── .gitignore
├── .env.example
├── .codex/
│   └── config.toml
├── apps/
│   ├── cli/
│   │   ├── src/
│   │   ├── tests/
│   │   └── package.json
│   ├── api/
│   │   ├── src/
│   │   ├── tests/
│   │   └── package.json
│   └── web/
│       ├── src/
│       ├── public/
│       ├── tests/
│       └── package.json
├── packages/
│   ├── domain/
│   ├── shared/
│   ├── runner-codex/
│   ├── policy-engine/
│   ├── artifact-store/
│   ├── verification/
│   ├── review-packets/
│   ├── github-adapter/
│   ├── evals/
│   ├── prompts/
│   └── benchmark-cases/
├── benchmarks/
│   ├── smoke/
│   ├── fresh/
│   └── longhorizon/
├── policies/
│   ├── default.yaml
│   ├── conservative.yaml
│   └── examples/
├── prompts/
│   ├── planner.md
│   ├── executor.md
│   ├── verifier.md
│   ├── reviewer.md
│   └── summarizer.md
├── runs/
│   ├── local/
│   └── fixtures/
├── reports/
├── scripts/
│   ├── bootstrap.ts
│   ├── seed-benchmarks.ts
│   └── migrate.ts
├── docs/
│   ├── architecture/
│   ├── decisions/
│   ├── references/
│   └── demos/
└── .github/
    ├── workflows/
    └── ISSUE_TEMPLATE/
```

---

## 8. Package responsibilities

## 8.1 `apps/cli`

Primary local entry point.

Responsibilities:

- `run` command
- `resume` command
- `approve` command
- `verify` command
- `report` command
- `benchmark` command
- `github issue-run` command

## 8.2 `apps/api`

Thin local API used by the dashboard and any future automation.

Responsibilities:

- expose runs, artifacts, approvals, reports, benchmark summaries
- no embedded business logic
- business logic remains in packages

## 8.3 `apps/web`

Internal dashboard.

Views:

- runs list
- run details
- approvals queue
- benchmark leaderboard
- review packet preview
- risk / failure taxonomy summary

## 8.4 `packages/domain`

Canonical TypeScript types and domain functions.

Contains:

- entities
- enums
- event names
- state machine definitions
- shared DTOs

## 8.5 `packages/runner-codex`

Adapter layer for Codex execution.

Contains:

- `CodexRunner` interface
- CLI-backed implementation
- SDK-backed implementation
- model / sandbox / approval profile selection
- context compaction helper

## 8.6 `packages/policy-engine`

Evaluates actions before execution.

Contains:

- policy DSL parsing
- path matching
- action classification
- policy decisions
- approval packet generation

## 8.7 `packages/artifact-store`

Persists and retrieves all durable objects.

Contains:

- SQLite schema
- migrations
- repositories
- export / import helpers

## 8.8 `packages/verification`

Runs post-execution checks.

Contains:

- git diff analysis
- test command execution
- PR summary verifier
- artifact completeness checks

## 8.9 `packages/review-packets`

Generates human-facing output.

Contains:

- markdown packet generator
- JSON packet generator
- evidence bundler
- PR description generator

## 8.10 `packages/github-adapter`

GitHub API wrapper.

Contains:

- issue fetch
- branch / PR operations
- labels / comments helpers
- safe draft PR creation

## 8.11 `packages/evals`

Benchmark and grader logic.

Contains:

- benchmark case loader
- grader interface
- local benchmark executor
- result aggregation
- regression comparison

## 8.12 `packages/prompts`

Prompt templates and prompt variables.

Contains:

- planner prompt
- execution prompt
- reviewer prompt
- packet generator prompt
- shared template variables

---

## 9. Domain model

## 9.1 Core entities

### `Spec`

Represents the normalized work request.

```ts
export interface Spec {
  id: string;
  source: 'markdown' | 'github_issue' | 'release_note' | 'manual';
  title: string;
  body: string;
  repoRoot: string;
  taskClass: TaskClass;
  riskHints: string[];
  acceptanceCriteria: string[];
  constraints: string[];
  createdAt: string;
}
```

### `Plan`

Represents the generated plan and milestones.

```ts
export interface Plan {
  id: string;
  specId: string;
  summary: string;
  milestones: PlanMilestone[];
  assumptions: string[];
  openQuestions: string[];
  verificationSteps: string[];
  generatedAt: string;
}
```

### `TaskUnit`

Represents the smallest routed unit of execution.

```ts
export interface TaskUnit {
  id: string;
  planId: string;
  title: string;
  description: string;
  dependsOn: string[];
  riskLevel: 'low' | 'medium' | 'high';
  suggestedMode: 'read_only' | 'workspace_write';
  status: 'pending' | 'running' | 'blocked' | 'done' | 'failed';
}
```

### `Run`

Represents one governed execution session.

```ts
export interface Run {
  id: string;
  specId: string;
  planId: string;
  status: 'created' | 'planning' | 'running' | 'awaiting_approval' | 'verifying' | 'completed' | 'failed' | 'cancelled';
  runner: 'codex-cli' | 'codex-sdk';
  model: string;
  sandboxMode: 'read-only' | 'workspace-write';
  approvalPolicy: 'untrusted' | 'on-request' | 'never';
  branchName: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### `RunEvent`

```ts
export interface RunEvent {
  id: string;
  runId: string;
  type:
    | 'run.created'
    | 'plan.generated'
    | 'task.started'
    | 'task.completed'
    | 'policy.blocked'
    | 'approval.requested'
    | 'approval.granted'
    | 'approval.denied'
    | 'verification.started'
    | 'verification.completed'
    | 'review_packet.generated'
    | 'eval.completed'
    | 'run.failed';
  payload: Record<string, unknown>;
  createdAt: string;
}
```

### `ApprovalPacket`

```ts
export interface ApprovalPacket {
  id: string;
  runId: string;
  reason: string;
  affectedPaths: string[];
  requestedAction: string;
  riskSummary: string;
  proposedMitigations: string[];
  diffSummary: string[];
  createdAt: string;
  resolvedAt?: string;
  resolution?: 'approved' | 'rejected';
}
```

### `VerificationResult`

```ts
export interface VerificationResult {
  id: string;
  runId: string;
  testsPassed: boolean;
  checks: VerificationCheck[];
  summary: string;
  createdAt: string;
}
```

### `ReviewPacket`

```ts
export interface ReviewPacket {
  id: string;
  runId: string;
  title: string;
  summary: string;
  filesChanged: string[];
  testsRun: string[];
  risks: string[];
  openQuestions: string[];
  claimVerification: ClaimVerification[];
  createdAt: string;
}
```

### `EvalRun`

```ts
export interface EvalRun {
  id: string;
  benchmarkSuite: 'smoke' | 'fresh' | 'longhorizon';
  configHash: string;
  resultSummary: {
    successRate: number;
    policyViolationRate: number;
    avgLatencyMs: number;
    avgCostUsd?: number;
  };
  createdAt: string;
}
```

## 9.2 State machine expectations

A `Run` must move through a strict state machine:

```text
created
  -> planning
  -> running
     -> awaiting_approval (0..n times)
     -> verifying
     -> completed
or -> failed
or -> cancelled
```

Rules:

- `completed` requires a `VerificationResult`.
- draft PR creation requires `completed` plus passing verification and no unresolved required approvals.
- any denied approval moves the run to `failed` or `cancelled`, depending on configuration.

---

## 10. Policy model

## 10.1 Policy goals

The policy engine exists to answer whether a proposed action is:

- allowed automatically,
- allowed only after approval,
- or blocked entirely.

## 10.2 Policy dimensions

The initial DSL should evaluate at least these dimensions:

- file path
- action type
- task class
- tool category
- network need
- repo environment

## 10.3 Initial DSL example

```yaml
version: 1
name: default

defaults:
  sandbox_mode: workspace-write
  network_access: false
  approval_policy: on-request

rules:
  - id: docs-safe
    match:
      task_classes: [docs, release_notes]
      paths: ["docs/**", "README.md", "CHANGELOG.md"]
      actions: [read, write]
    decision: allow

  - id: tests-safe
    match:
      task_classes: [tests, ci]
      paths: ["tests/**", ".github/workflows/**", "package.json", "pnpm-lock.yaml"]
      actions: [read, write, run_tests]
    decision: allow

  - id: auth-protected
    match:
      paths: ["src/auth/**", "src/permissions/**"]
      actions: [write]
    decision: require_approval
    reason: "Auth and permission boundaries are high risk"

  - id: migrations-protected
    match:
      paths: ["db/migrations/**", "prisma/migrations/**"]
      actions: [write]
    decision: require_approval
    reason: "Schema changes must be reviewed"

  - id: secrets-blocked
    match:
      paths: [".env", ".env.*", "secrets/**"]
      actions: [read, write]
    decision: block
    reason: "Secrets are out of scope for autonomous edits"

  - id: network-blocked
    match:
      actions: [network]
    decision: require_approval
    reason: "Internet access is disabled by default"
```

## 10.4 Approval packet requirements

Every `require_approval` decision must produce:

- what changed,
- why the engine flagged it,
- what files / commands are implicated,
- what downstream risks exist,
- what the fallback path is if denied.

## 10.5 Policy invariants

- Policy files are version-controlled.
- Policy evaluation is deterministic for a given rule set.
- Policy decisions are emitted as structured events.
- No hidden implicit allow rules.

---

## 11. Codex integration specification

## 11.1 Integration strategy

Use a two-adapter design:

### Adapter A — `CodexCliRunner`

Bootstrap path.

Use when:

- standing up the first working run loop,
- operating entirely locally,
- prototyping execution quickly.

### Adapter B — `CodexSdkRunner`

Target primary adapter.

Use when:

- the run loop is stable,
- richer structured control is needed,
- you want tighter programmatic orchestration.

## 11.2 Runner interface

```ts
export interface RunnerContext {
  repoRoot: string;
  planSummary: string;
  task: TaskUnit;
  policyDecision: ResolvedPolicy;
  priorArtifacts: ArtifactReference[];
  verificationRequirements: string[];
}

export interface RunnerResult {
  status: 'completed' | 'blocked' | 'failed';
  summary: string;
  changedFiles: string[];
  commandsExecuted: string[];
  artifactsProduced: ArtifactReference[];
  approvalNeeded?: ApprovalPacket;
}

export interface Runner {
  plan(spec: Spec): Promise<Plan>;
  execute(context: RunnerContext): Promise<RunnerResult>;
  resume(runId: string): Promise<RunnerResult>;
}
```

## 11.3 Codex operating defaults

Initial defaults should be conservative.

- model: project default, overridable by config
- sandbox: `workspace-write`
- network: off
- approval policy: `on-request`
- internet: off unless explicitly approved

## 11.4 Example `.codex/config.toml`

This should be committed to the repo as a shared baseline.

```toml
model = "gpt-5.4"
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
network_access = false

[agents.planner]
description = "Create implementation plans and milestone breakdowns."

[agents.verifier]
description = "Run verification, summarize evidence, and avoid unsupported claims."
```

## 11.5 Required repo conventions for Codex

### `AGENTS.md`

Must define:

- repository purpose,
- package responsibilities,
- coding standards,
- allowed commands,
- disallowed operations,
- definition of done,
- testing expectations,
- approval boundaries.

### `PLANS.md`

Used for multi-hour or multi-session tasks.

Must include:

- objective,
- milestones,
- acceptance criteria,
- open risks,
- verification plan,
- rollback / fallback plan.

### `implement.md`

Runbook for how Codex should implement work.

Must include:

- plan before acting for non-trivial tasks,
- change only what is necessary,
- verify before claiming completion,
- write summary notes to `documentation.md`,
- ask for approval at protected boundaries.

### `documentation.md`

Live run audit log and progress journal.

Must include:

- current task,
- decisions taken,
- blockers,
- verification outcomes,
- unresolved questions.

---

## 12. Initial bootstrap files

## 12.1 `AGENTS.md` template

```md
# AGENTS.md

## Project mission
Build a governed execution layer for agentic software delivery.

## Core rules
- Plan before non-trivial implementation work.
- Verify before claiming completion.
- Prefer minimal diffs.
- Do not edit secrets or deployment credentials.
- Do not bypass policy checks.
- Update documentation.md after each milestone.

## Package boundaries
- apps/cli: local commands only
- apps/api: HTTP surface only
- apps/web: dashboard only
- packages/domain: shared types and state machines
- packages/runner-codex: Codex execution adapters
- packages/policy-engine: rule evaluation and approval packets
- packages/verification: tests, diff checks, packet claim verification
- packages/evals: benchmark loading and grading

## Definition of done
- relevant tests pass
- no unsupported claims in review packet
- policy decisions logged
- documentation.md updated
```

## 12.2 `PLANS.md` template

```md
# PLANS.md

## Objective

## Constraints

## Milestones
1.
2.
3.

## Acceptance criteria
- 
- 
- 

## Risks
- 
- 

## Verification plan
- lint
- typecheck
- unit tests
- integration tests

## Rollback / fallback
- 
```

## 12.3 `implement.md` template

```md
# implement.md

1. Restate the task as a concrete engineering goal.
2. Build or refresh PLANS.md for non-trivial tasks.
3. Inspect repository context before editing.
4. Keep diffs minimal and localized.
5. Trigger approval for protected paths or actions.
6. Run verification before marking work complete.
7. Update documentation.md with what changed and what remains.
8. Generate a review packet only from verified evidence.
```

## 12.4 `documentation.md` template

```md
# documentation.md

## Active run
- Run ID:
- Objective:
- Status:

## Progress log
- YYYY-MM-DD HH:MM — Initialized run.
- YYYY-MM-DD HH:MM — Planned milestones.
- YYYY-MM-DD HH:MM — Completed task X.

## Decisions
- 

## Verification
- 

## Open issues
- 
```

---

## 13. Recommended bootstrap commands

Assuming a clean machine with Node installed.

```bash
mkdir governed-delivery-control-plane
cd governed-delivery-control-plane
pnpm init
pnpm add -w -D typescript @types/node turbo biome vitest playwright tsx
pnpm add -w fastify zod drizzle-orm better-sqlite3 pino commander @octokit/rest
pnpm add -w @openai/codex-sdk
mkdir -p apps/cli apps/api apps/web packages/domain packages/shared packages/runner-codex packages/policy-engine packages/artifact-store packages/verification packages/review-packets packages/github-adapter packages/evals packages/prompts benchmarks/smoke benchmarks/fresh benchmarks/longhorizon policies docs/architecture docs/decisions docs/references reports runs scripts .codex .github/workflows
```

If using Vite for the dashboard:

```bash
pnpm create vite apps/web --template react-ts
```

Then add workspace configuration.

### `pnpm-workspace.yaml`

```yaml
packages:
  - apps/*
  - packages/*
```

### `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "outputs": []
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "typecheck": {
      "outputs": []
    }
  }
}
```

---

## 14. CLI contract

The CLI should be the first complete interface.

## 14.1 Proposed commands

```text
gdh run <spec-file>
gdh run --issue <github-issue-url>
gdh resume <run-id>
gdh approve <approval-id> --yes
gdh approve <approval-id> --no
gdh verify <run-id>
gdh report <run-id>
gdh benchmark smoke
gdh benchmark fresh
gdh benchmark longhorizon
gdh github draft-pr <run-id>
```

## 14.2 Command expectations

### `gdh run`

- normalizes input into `Spec`
- creates `Plan`
- creates `Run`
- selects runner and policy
- executes until blocked, failed, or complete

### `gdh resume`

- restores compact run state
- refuses to resume if unresolved required approvals remain unless explicitly overridden by a human

### `gdh verify`

- runs configured tests / checks
- produces `VerificationResult`

### `gdh report`

- emits the review packet in markdown and JSON

### `gdh benchmark`

- runs configured benchmark tasks against a pinned configuration
- writes result ledger entry

---

## 15. API contract

The API should remain thin and internal.

### Endpoints

- `GET /health`
- `GET /runs`
- `GET /runs/:id`
- `GET /runs/:id/events`
- `GET /runs/:id/review-packet`
- `GET /approvals`
- `POST /approvals/:id/approve`
- `POST /approvals/:id/reject`
- `POST /benchmarks/run`
- `GET /benchmarks/results`

### Constraints

- no hidden async side effects from simple read endpoints
- API is just a transport layer for the CLI and web app
- job creation should reuse the same service functions as the CLI

---

## 16. Verification specification

Verification must be a distinct subsystem, not an afterthought.

## 16.1 Required checks for any completed run

1. **Git diff present and parsable**
2. **Relevant tests or checks executed**
3. **Claim verification** against generated summary
4. **Policy compliance** confirmed
5. **Artifact completeness** confirmed

## 16.2 Claim verification rules

The review packet generator may claim only facts supported by evidence.

Examples of allowed claims:

- file `X` was modified
- tests `A`, `B`, `C` passed
- auth path edits were approved under approval packet `Y`
- no network access was used during the run

Examples of disallowed claims:

- “fully resolves all edge cases” unless explicit evidence exists
- “safe” without a named basis
- “production-ready” without release criteria being met

## 16.3 Verification commands

The system should support repository-configured commands, for example:

```yaml
verification:
  preflight:
    - pnpm lint
    - pnpm typecheck
  postrun:
    - pnpm test
  optional:
    - pnpm test:e2e
```

## 16.4 Verification failure behavior

- any mandatory verification failure blocks PR creation
- review packet is still generated, but explicitly marked `verification_failed`
- run status becomes `failed` or `completed_with_findings` depending on policy

---

## 17. Benchmark and eval design

## 17.1 Benchmark tiers

### `smoke`

Low-risk, quick, repeatable tasks.

Examples:

- improve README section clarity
- add missing tests around existing helper
- update CI config to current standards
- generate release note draft from commits

### `fresh`

Newly collected tasks from real work so the benchmark suite does not become stale.

Examples:

- recent backlog items turned into internal benchmark cases
- repo-specific tasks not present in public benchmarks

### `longhorizon`

Complex multi-file tasks with milestone-based execution.

Examples:

- implement a release-note pipeline end to end
- add review packet verifier across multiple modules
- build a new policy class and backfill tests

## 17.2 Graders

Every benchmark case should use one or more graders.

Required initial graders:

- `task_completion`
- `tests_passing`
- `policy_violations`
- `review_packet_fidelity`
- `artifact_completeness`
- `latency`
- `human_intervention_count`

## 17.3 Eval schema

```ts
export interface BenchmarkCase {
  id: string;
  suite: 'smoke' | 'fresh' | 'longhorizon';
  title: string;
  inputSpecPath: string;
  repoFixturePath?: string;
  successCriteria: string[];
  allowedPolicies: string[];
}
```

## 17.4 Benchmark ledger

Store benchmark output in a simple append-only table or TSV / JSONL ledger with:

- case id
- config hash
- model
- prompt pack version
- policy pack version
- success / failure
- score breakdown
- cost / latency
- notes

This ledger is the basis for later AutoResearch-style autotuning.

---

## 18. GitHub integration

## 18.1 Initial GitHub features

Only implement the low-risk path first:

- fetch issue data
- create a branch
- open a draft PR
- post a summary comment if needed

## 18.2 Draft PR gate

A draft PR may only be created if:

- the run completed,
- verification succeeded,
- no unresolved required approvals remain,
- claim verification passed,
- repo policy allows PR creation for the task class.

## 18.3 No direct merge automation in v1

Even if the run appears good, the system must not merge automatically in v1.

## 18.4 Review packet sections

Every PR packet should include:

- objective
- plan summary
- files changed
- tests run and outcomes
- policy decisions
- approvals required and granted
- risks and open questions
- claim verification summary
- rollback / revert hint

---

## 19. UI / dashboard specification

## 19.1 Primary pages

### Runs list

Show:

- run id
- status
- task class
- repo
- created time
- current milestone
- approvals pending

### Run detail

Show:

- plan summary
- task timeline
- event log
- changed files
- verification results
- review packet preview

### Approvals queue

Show:

- approval id
- reason
- affected paths
- risk summary
- buttons to approve / reject

### Benchmarks

Show:

- suite
- latest score
- trend vs prior config
- regressions

### Failure taxonomy

Show:

- run failures grouped by class
- policy blocks
- verification failures
- review packet inconsistencies

## 19.2 UI priorities

The dashboard is not the product center for v0. It is a visibility layer.

Priority order:

1. CLI works
2. Run store works
3. review packet works
4. approvals UI works
5. dashboard is added

---

## 20. Security model

## 20.1 Defaults

- workspace write only
- network off
- no secrets access
- no direct production credentials
- no auto-merge
- no deploy actions

## 20.2 Protected zones

Protect these from autonomous modification in v1 unless explicitly approved:

- auth / permissions
- billing / subscriptions
- secrets and env files
- migrations and schema
- release and deploy workflows
- infrastructure-as-code directories

## 20.3 Logging

Structured logs must include:

- run id
- task id
- model
- sandbox mode
- approval policy
- event type
- timestamps

Do **not** log secret values or full credentials.

## 20.4 Human override policy

Human overrides are allowed, but they should themselves be logged.

---

## 21. CI and release discipline

## 21.1 Required CI jobs

- install
- lint
- typecheck
- unit tests
- integration tests
- benchmark smoke subset
- docs link / schema validation

## 21.2 Release criteria for v1

The system is considered release-ready when:

- local setup is deterministic,
- CLI commands work end to end,
- protected actions trigger approval packets correctly,
- verification blocks unsupported PR creation,
- benchmark smoke suite passes at an acceptable rate,
- review packets are consistent with diffs,
- resume logic works across interrupted sessions,
- README and demo material exist.

---

## 22. Phase plan

## Phase 0 — Repository bootstrap and Codex operating surface

### Goal
Make the repository itself easy for Codex and humans to work in.

### Deliverables

- monorepo initialized
- `AGENTS.md`, `PLANS.md`, `implement.md`, `documentation.md`
- `.codex/config.toml`
- `apps/cli`, `apps/api`, `packages/domain`, `packages/runner-codex`
- basic lint / test / typecheck scripts

### Exit criteria

- Codex can open the repo and immediately understand structure and rules
- the repo has one-command bootstrap
- local lint and test pass on a clean machine

## Phase 1 — Local end-to-end run loop

### Goal
Get one local `gdh run <spec>` flow working.

### Deliverables

- `Spec` normalization
- planning path
- `Run` creation
- `CodexCliRunner`
- basic artifact storage
- markdown review packet

### Exit criteria

- low-risk smoke task can complete end to end
- all events are logged
- changed files and executed commands are captured

## Phase 2 — Policy and approvals

### Goal
Add a real guardrail layer.

### Deliverables

- policy DSL
- policy evaluator
- protected paths
- approval packet generation
- CLI approval flow

### Exit criteria

- protected writes are blocked or paused correctly
- approval packet contains enough context for a human to decide

## Phase 3 — Verification and packet fidelity

### Goal
Prevent the system from overstating what it did.

### Deliverables

- test / lint / typecheck integration
- claim verifier
- packet completeness checker
- run completion gate

### Exit criteria

- PR packet claims are checked against evidence
- failing verification prevents PR creation

## Phase 4 — Durable state and resume

### Goal
Make multi-session work reliable.

### Deliverables

- SQLite-backed artifact and event store
- resume support
- compact run-state summaries
- progress journaling discipline

### Exit criteria

- interrupted work can be resumed without reconstructing the whole context manually

## Phase 5 — GitHub draft PR flow

### Goal
Make successful runs legible in normal engineering workflow.

### Deliverables

- issue ingestion
- branch naming
- draft PR creation
- review packet injection into PR body

### Exit criteria

- successful low-risk run can produce a draft PR
- PR body is evidence-backed

## Phase 6 — Benchmarking and regression gating

### Goal
Make changes measurable.

### Deliverables

- smoke / fresh / longhorizon suite layout
- initial graders
- benchmark command
- CI regression check

### Exit criteria

- prompt or policy regressions are detectable
- benchmark result history is persisted

## Phase 7 — Dashboard and analytics

### Goal
Make the system legible to non-authors.

### Deliverables

- runs page
- approvals page
- benchmark page
- failure taxonomy page

### Exit criteria

- a collaborator can understand a run without reading raw logs

## Phase 8 — Release hardening

### Goal
Turn the project into a credible external artifact.

### Deliverables

- install docs
- demo repo
- architecture diagrams
- benchmark report
- security notes
- polished README

### Exit criteria

- a new developer can clone, install, run, and verify the project without tribal knowledge

---

## 23. AutoResearch-inspired future extension

Do **not** implement this first. Implement after the benchmark framework is stable.

## 23.1 Goal

Use bounded autonomous iteration to improve safe surfaces of the system.

## 23.2 Editable surfaces

Initially allow autotuning of only:

- prompt templates in `packages/prompts`
- grader thresholds in `packages/evals`
- report wording templates in `packages/review-packets`
- policy thresholds in `policies/` where explicitly marked tunable

## 23.3 Keep / discard logic

A change may be kept only if:

- success rate improves on the benchmark set,
- no safety regression occurs,
- packet fidelity does not decrease,
- cost / latency stay within configured bounds.

## 23.4 Explicit non-goal

Do not allow autotuning to modify:

- production integration code,
- GitHub side-effect logic,
- secrets handling,
- deployment behavior,
- migration or auth behavior,
- the benchmark truth labels themselves.

---

## 24. Implementation order inside Codex

This is the recommended work order for Codex sessions.

1. Initialize the monorepo and workspace config.
2. Create the bootstrap docs (`AGENTS.md`, `PLANS.md`, `implement.md`, `documentation.md`).
3. Implement `packages/domain` types.
4. Implement `apps/cli` with a placeholder `run` command.
5. Implement `CodexCliRunner`.
6. Implement simple file-backed run logging.
7. Implement the first policy evaluator.
8. Add verification hooks.
9. Replace file-backed logs with SQLite.
10. Add GitHub adapter and draft PR flow.
11. Add benchmark suite and CI.
12. Add dashboard.
13. Add `CodexSdkRunner` and migrate default execution to it when stable.

---

## 25. Risks and mitigation

## 25.1 Risk: building too much orchestration too early

**Mitigation:** single-runner first; no multi-agent until evals justify it.

## 25.2 Risk: confusing logs with useful artifacts

**Mitigation:** treat artifacts as first-class; transcripts are secondary.

## 25.3 Risk: false confidence from successful merges

**Mitigation:** require local verification and benchmark tracking, not merge rate alone.

## 25.4 Risk: PR summaries becoming untrustworthy

**Mitigation:** implement claim verification before PR automation.

## 25.5 Risk: too many tools in context

**Mitigation:** keep the tool surface minimal and clearly namespaced.

## 25.6 Risk: overfitting to public benchmarks

**Mitigation:** maintain a `fresh` suite sourced from recent real tasks.

---

## 26. Open questions to resolve during implementation

1. Should the first persisted store be plain SQLite with raw SQL, or Drizzle immediately?
2. Should the CLI shell out to `codex exec` first, or go straight to the SDK?
3. Should review packet fidelity be rule-based first, LLM-assisted second, or hybrid from the start?
4. When should GitHub API side effects be introduced relative to resume support?
5. What minimal smoke benchmark size is sufficient to detect regressions without slowing daily iteration?
6. Should benchmark fixtures live inside this repo or in a separate companion repo?

Recommended answers for v0:

- Drizzle immediately.
- CLI shell-out first, SDK second.
- Rule-based claim verification first, hybrid later.
- GitHub after verification and policy engine exist.
- 10–20 smoke cases is enough to begin.
- Keep fixtures in-repo initially.

---

## 27. Research translation matrix

| Source / theme | Key finding | Immediate spec implication |
|---|---|---|
| OpenAI agent-building guidance | Maximize a single agent first; multi-agent only when complexity demands it | Single `CodexRunner` for v0/v1 |
| OpenAI Codex long-horizon guidance | Long runs work best with a spec, plans, runbook, continuous verification, and live status docs | Commit `AGENTS.md`, `PLANS.md`, `implement.md`, `documentation.md` from day one |
| OpenAI governance guidance | Policies as code, automatic guardrails, and evaluation-backed defenses should be built in from the start | Policy engine and approval packets are mandatory in v1 |
| OpenAI Agent Evals | Use datasets, trace grading, and reproducible evals | Add benchmark suites and graders before scaling the system |
| Anthropic context engineering | Tool sets should be minimal, clearly scoped, and token-efficient | Keep tool surface narrow and namespaced |
| Anthropic long-running harnesses | Agents need durable artifacts and an initializer / continuity pattern | Add resume support and progress artifacts |
| Anthropic tool-writing guidance | Tools and evals should be improved together; agents can help optimize tools | Later add bounded autotune mode |
| GitHub Agentic Workflows | Guardrailed repository automation already exists, with safe outputs and read-only defaults | Differentiate on policy / eval / analytics layer, not basic automation |
| Empirical PR failure study | Docs / CI / build tasks merge best; larger and riskier changes fail more | Focus alpha on low-risk task classes |
| PR inconsistency study | Unreliable PR descriptions damage trust and acceptance rates | Implement review packet claim verification |
| Recursive Language Models | Recursive decomposition can help with arbitrarily long inputs and repo contexts | Add recursive decomposition only as a later feature flag |
| SWE-EVO | Long-horizon software evolution remains hard even for strong agents | Keep long-horizon benchmark suite and do not overclaim capability |
| Karpathy AutoResearch | Bounded iteration against hard evals is a practical self-improvement loop | Use it later to optimize prompts / policies, not arbitrary product code |

---

## 28. Release-ready definition

This project is ready for a public release when all of the following are true:

- a clean machine can install and run the project,
- `gdh run <spec>` works on low-risk tasks end to end,
- approvals are enforced for protected paths,
- verification gates prevent unsupported draft PRs,
- review packets are evidence-based,
- benchmark regressions can be detected in CI,
- the dashboard can explain a run without reading raw logs,
- the repo contains architecture documentation, benchmark report, and a realistic demo flow.

---

## 29. Recommended references

### 29.1 OpenAI / Codex / agent system design

1. OpenAI Codex SDK  
   https://developers.openai.com/codex/sdk
2. OpenAI Codex CLI  
   https://developers.openai.com/codex/cli
3. OpenAI Codex config basics  
   https://developers.openai.com/codex/config-basic
4. OpenAI agent approvals and security  
   https://developers.openai.com/codex/agent-approvals-security
5. OpenAI run long horizon tasks with Codex  
   https://developers.openai.com/blog/run-long-horizon-tasks-with-codex
6. OpenAI using `PLANS.md` for multi-hour problem solving  
   https://developers.openai.com/cookbook/articles/codex_exec_plans
7. OpenAI building consistent workflows with Codex CLI and Agents SDK  
   https://developers.openai.com/cookbook/examples/codex/codex_mcp_agents_sdk/building_consistent_workflows_codex_cli_agents_sdk
8. OpenAI Agent Evals guide  
   https://developers.openai.com/api/docs/guides/agent-evals
9. OpenAI practical guide to building agents  
   https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
10. OpenAI governed AI agents cookbook  
    https://developers.openai.com/cookbook/examples/partners/agentic_governance_guide/agentic_governance_cookbook
11. OpenAI self-evolving agents cookbook  
    https://developers.openai.com/cookbook/examples/partners/self_evolving_agents/autonomous_agent_retraining
12. OpenAI Agents SDK guide  
    https://developers.openai.com/api/docs/guides/agents-sdk
13. OpenAI model context protocol for Codex  
    https://developers.openai.com/codex/mcp

### 29.2 Anthropic engineering guidance

14. Anthropic — Effective context engineering for AI agents  
    https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
15. Anthropic — Effective harnesses for long-running agents  
    https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
16. Anthropic — Writing effective tools for agents  
    https://www.anthropic.com/engineering/writing-tools-for-agents
17. Anthropic — How we built our multi-agent research system  
    https://www.anthropic.com/engineering/multi-agent-research-system
18. Anthropic — Demystifying evals for AI agents  
    https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
19. Anthropic — Building effective agents  
    https://www.anthropic.com/engineering/building-effective-agents
20. Anthropic — Code execution with MCP  
    https://www.anthropic.com/engineering/code-execution-with-mcp

### 29.3 GitHub ecosystem and adjacent products

21. GitHub Agentic Workflows  
    https://github.github.com/gh-aw/
22. GitHub Agentic Workflows overview  
    https://github.github.com/gh-aw/introduction/overview/
23. GitHub Copilot coding agent overview  
    https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
24. GitHub Models overview  
    https://docs.github.com/en/github-models
25. GitHub Models evaluation docs  
    https://docs.github.com/en/github-models/use-github-models/evaluating-ai-models
26. GitHub blog — Agentic Workflows technical preview  
    https://github.blog/changelog/2026-02-13-github-agentic-workflows-are-now-in-technical-preview/

### 29.4 Research papers and benchmarks

27. Recursive Language Models  
    https://arxiv.org/abs/2512.24601
28. SWE-EVO: Benchmarking Coding Agents in Long-Horizon Software Evolution Scenarios  
    https://arxiv.org/abs/2512.18470
29. SWE-rebench: automated task collection and decontaminated evaluation of software engineering agents  
    https://arxiv.org/abs/2505.20411
30. Where Do AI Coding Agents Fail? An Empirical Study of Failed Agentic Pull Requests in GitHub  
    https://arxiv.org/abs/2601.15195
31. Analyzing Message-Code Inconsistency in AI Coding Agent-Authored Pull Requests  
    https://arxiv.org/abs/2601.04886
32. Agentic Software Engineering: Foundational Pillars and a Research Roadmap  
    https://arxiv.org/abs/2509.06216
33. The Rise of AI Teammates in Software Engineering (SE 3.0)  
    https://arxiv.org/abs/2507.15003
34. Karpathy AutoResearch repository  
    https://github.com/karpathy/autoresearch

### 29.5 Implementation stack references

35. pnpm workspaces  
    https://pnpm.io/workspaces
36. Turborepo docs  
    https://turborepo.dev/docs
37. Fastify docs  
    https://fastify.dev/docs/latest/
38. Drizzle ORM docs  
    https://orm.drizzle.team/docs/get-started
39. Vite docs  
    https://vite.dev/guide/
40. Vitest docs  
    https://vitest.dev/guide/
41. Playwright docs  
    https://playwright.dev/docs/intro
42. Biome docs  
    https://biomejs.dev/guides/getting-started/
43. MCP specification  
    https://modelcontextprotocol.io/specification/latest

---

## 30. Immediate next actions

1. Create the monorepo with the structure defined above.
2. Commit bootstrap documents and `.codex/config.toml`.
3. Implement `packages/domain` and `apps/cli` first.
4. Build the first `CodexCliRunner` end-to-end on a docs-only smoke task.
5. Add policy checks before any GitHub side effects.
6. Add verification and packet claim checking before draft PR automation.
7. Build benchmarks before experimenting with multi-agent or self-improving loops.
