import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

interface DashboardFixtureIds {
  benchmarkRunId: string;
  completedRunId: string;
  pendingApprovalRunId: string;
  verificationFailedRunId: string;
}

export interface DashboardFixtureRepo {
  ids: DashboardFixtureIds;
  repoRoot: string;
}

async function ensureParentDirectory(path: string): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureParentDirectory(path);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(path: string, value: string): Promise<void> {
  await ensureParentDirectory(path);
  await writeFile(path, value, 'utf8');
}

function runDirectory(repoRoot: string, runId: string): string {
  return resolve(repoRoot, 'runs', 'local', runId);
}

function benchmarkDirectory(repoRoot: string, benchmarkRunId: string): string {
  return resolve(repoRoot, 'runs', 'benchmarks', benchmarkRunId);
}

export async function createDashboardFixtureRepo(
  parentDirectory?: string,
): Promise<DashboardFixtureRepo> {
  const repoRoot = parentDirectory ?? (await mkdtemp(resolve(tmpdir(), 'gdh-dashboard-fixtures-')));
  const ids: DashboardFixtureIds = {
    completedRunId: 'dashboard-completed-run-20260318T090000z-aaaaaa',
    pendingApprovalRunId: 'dashboard-awaiting-approval-20260318T091500z-bbbbbb',
    verificationFailedRunId: 'dashboard-verification-failed-20260318T093000z-cccccc',
    benchmarkRunId: 'benchmark-dashboard-smoke-20260318T100000z-dddddd',
  };

  await mkdir(resolve(repoRoot, 'runs', 'local'), { recursive: true });
  await mkdir(resolve(repoRoot, 'runs', 'benchmarks'), { recursive: true });

  const completedRunDir = runDirectory(repoRoot, ids.completedRunId);
  const pendingApprovalRunDir = runDirectory(repoRoot, ids.pendingApprovalRunId);
  const verificationFailedRunDir = runDirectory(repoRoot, ids.verificationFailedRunId);
  const benchmarkRunDir = benchmarkDirectory(repoRoot, ids.benchmarkRunId);

  await writeJson(resolve(completedRunDir, 'run.json'), {
    id: ids.completedRunId,
    specId: 'spec-dashboard-completed',
    planId: 'plan-dashboard-completed',
    status: 'completed',
    currentStage: 'verification_completed',
    verificationStatus: 'passed',
    verificationResultPath: resolve(completedRunDir, 'verification.result.json'),
    lastVerifiedAt: '2026-03-18T09:07:00.000Z',
    runner: 'fake',
    model: 'gpt-5.4',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalMode: 'fail',
    networkAccess: false,
    policyPackName: 'default',
    policyPackVersion: 1,
    policyPackPath: resolve(repoRoot, 'policies', 'default.policy.yaml'),
    repoRoot,
    runDirectory: completedRunDir,
    sourceSpecPath: resolve(repoRoot, 'runs', 'fixtures', 'dashboard-completed.md'),
    github: {
      issue: {
        repo: {
          owner: 'acme',
          repo: 'gdh',
          fullName: 'acme/gdh',
          url: 'https://github.com/acme/gdh',
          defaultBranch: 'main',
        },
        issueNumber: 12,
        title: 'Show dashboard analytics',
        body: 'Add Phase 7 visibility.',
        labels: ['phase-7', 'dashboard'],
        url: 'https://github.com/acme/gdh/issues/12',
        state: 'open',
      },
      branch: {
        repo: {
          owner: 'acme',
          repo: 'gdh',
          fullName: 'acme/gdh',
          url: 'https://github.com/acme/gdh',
          defaultBranch: 'main',
        },
        name: 'anf/codex/dashboard-phase7',
        ref: 'refs/heads/anf/codex/dashboard-phase7',
        sha: 'abc123',
        existed: false,
      },
      pullRequest: {
        repo: {
          owner: 'acme',
          repo: 'gdh',
          fullName: 'acme/gdh',
          url: 'https://github.com/acme/gdh',
          defaultBranch: 'main',
        },
        pullRequestNumber: 34,
        title: 'Phase 7 dashboard',
        url: 'https://github.com/acme/gdh/pull/34',
        state: 'open',
        isDraft: true,
        baseBranch: 'main',
        headBranch: 'anf/codex/dashboard-phase7',
      },
      draftPrResultPath: resolve(completedRunDir, 'github', 'draft-pr.result.json'),
      updatedAt: '2026-03-18T09:08:00.000Z',
      iterationRequestPaths: [],
    },
    createdAt: '2026-03-18T09:00:00.000Z',
    updatedAt: '2026-03-18T09:08:00.000Z',
    summary: 'Completed a local dashboard slice and prepared a draft PR.',
  });
  await writeJson(resolve(completedRunDir, 'spec.normalized.json'), {
    id: 'spec-dashboard-completed',
    source: 'markdown',
    sourcePath: resolve(repoRoot, 'runs', 'fixtures', 'dashboard-completed.md'),
    repoRoot,
    title: 'Phase 7 Dashboard Completed',
    summary: 'Make the dashboard explain governed runs at a glance.',
    objective: 'Make the dashboard explain governed runs at a glance.',
    taskClass: 'docs',
    constraints: ['Stay in Phase 7.'],
    acceptanceCriteria: ['Show run and benchmark summaries.'],
    riskHints: ['Keep the dashboard local and artifact-backed.'],
    body: '# Dashboard',
    normalizationNotes: ['Task class inferred from the fixture metadata.'],
    inferredFields: [],
    createdAt: '2026-03-18T09:00:00.000Z',
  });
  await writeJson(resolve(completedRunDir, 'plan.json'), {
    id: 'plan-dashboard-completed',
    specId: 'spec-dashboard-completed',
    summary: 'Build the overview page, run detail, and benchmark summary.',
    taskUnits: [
      {
        id: 'task-1',
        order: 1,
        title: 'Inspect artifact surfaces',
        description: 'Read the current run and benchmark artifacts.',
        riskLevel: 'low',
        suggestedMode: 'read_only',
        status: 'done',
      },
      {
        id: 'task-2',
        order: 2,
        title: 'Implement views',
        description: 'Render the dashboard pages from read models.',
        riskLevel: 'medium',
        suggestedMode: 'workspace_write',
        status: 'done',
      },
    ],
    doneConditions: ['Show run and benchmark summaries.'],
    assumptions: ['The dashboard stays local.'],
    openQuestions: [],
    generatedAt: '2026-03-18T09:01:00.000Z',
  });
  await writeJson(resolve(completedRunDir, 'policy.decision.json'), {
    decision: 'allow',
    affectedPaths: ['apps/web/**', 'apps/api/**'],
    matchedCommands: ['pnpm test'],
    requiredApprovalMode: null,
    notes: ['Local dashboard code is allowed.'],
  });
  await writeJson(resolve(completedRunDir, 'verification.result.json'), {
    id: 'verify-dashboard-completed',
    runId: ids.completedRunId,
    status: 'passed',
    summary: 'Verification passed for the dashboard slice.',
    commands: [
      {
        id: 'command-1',
        command: 'pnpm test',
        phase: 'postrun',
        mandatory: true,
        status: 'passed',
        exitCode: 0,
        durationMs: 1200,
        summary: 'Tests passed.',
        startedAt: '2026-03-18T09:05:00.000Z',
        completedAt: '2026-03-18T09:05:01.200Z',
        evidence: [],
      },
    ],
    checks: [
      {
        id: 'check-1',
        name: 'review_packet',
        mandatory: true,
        status: 'passed',
        summary: 'Review packet is complete.',
        details: [],
        evidence: [],
        startedAt: '2026-03-18T09:06:00.000Z',
        completedAt: '2026-03-18T09:06:00.100Z',
      },
    ],
    claimVerification: {
      status: 'passed',
      summary: 'Claims match the artifacts.',
      totalClaims: 2,
      passedClaims: 2,
      failedClaims: 0,
      results: [],
    },
    packetCompleteness: {
      status: 'passed',
      summary: 'Packet sections are complete.',
      requiredSections: ['overview', 'verification'],
      missingSections: [],
      incompleteSections: [],
    },
    completionDecision: {
      finalStatus: 'completed',
      canComplete: true,
      summary: 'Run can complete.',
      blockingCheckIds: [],
      blockingReasons: [],
    },
    resumable: false,
    createdAt: '2026-03-18T09:07:00.000Z',
  });
  await writeJson(resolve(completedRunDir, 'review-packet.json'), {
    id: 'review-dashboard-completed',
    runId: ids.completedRunId,
    title: 'Review Packet: Dashboard Completed',
    specTitle: 'Phase 7 Dashboard Completed',
    runStatus: 'completed',
    packetStatus: 'ready',
    objective: 'Make the dashboard explain governed runs at a glance.',
    overview: 'Overview, run detail, and benchmark summary pages were completed.',
    planSummary: 'Build the overview page, run detail, and benchmark summary.',
    runnerReportedSummary: 'Completed a local dashboard slice and prepared a draft PR.',
    filesChanged: ['apps/web/src/App.tsx', 'apps/api/src/index.ts'],
    commandsExecuted: [],
    checksRun: [],
    artifactPaths: [resolve(completedRunDir, 'review-packet.md')],
    diffSummary: ['2 files changed.'],
    policy: {
      decision: 'allow',
      summary: 'Allowed by policy.',
      auditStatus: 'clean',
      auditSummary: 'No scope drift.',
      matchedRuleIds: ['docs-safe'],
    },
    approvals: {
      required: false,
      status: 'not_required',
      summary: 'No approval required.',
    },
    risks: ['Local-only dashboard.'],
    limitations: ['Artifact previews stay local.'],
    openQuestions: [],
    verification: {
      status: 'passed',
      summary: 'Verification passed.',
      mandatoryFailures: [],
      lastVerifiedAt: '2026-03-18T09:07:00.000Z',
    },
    claimVerification: {
      status: 'passed',
      summary: 'Claims match the artifacts.',
      totalClaims: 2,
      passedClaims: 2,
      failedClaims: 0,
      results: [],
    },
    rollbackHint: 'Revert the dashboard commit if needed.',
    github: {
      issue: {
        repo: {
          owner: 'acme',
          repo: 'gdh',
          fullName: 'acme/gdh',
        },
        issueNumber: 12,
        title: 'Show dashboard analytics',
        body: 'Add Phase 7 visibility.',
        labels: ['phase-7'],
        url: 'https://github.com/acme/gdh/issues/12',
        state: 'open',
      },
      pullRequest: {
        repo: {
          owner: 'acme',
          repo: 'gdh',
          fullName: 'acme/gdh',
        },
        pullRequestNumber: 34,
        title: 'Phase 7 dashboard',
        url: 'https://github.com/acme/gdh/pull/34',
        state: 'open',
        isDraft: true,
        baseBranch: 'main',
        headBranch: 'anf/codex/dashboard-phase7',
      },
    },
    createdAt: '2026-03-18T09:07:30.000Z',
  });
  await writeText(
    resolve(completedRunDir, 'review-packet.md'),
    '# Review Packet\n\nCompleted dashboard work.\n',
  );
  await writeJson(resolve(completedRunDir, 'session.manifest.json'), {
    runId: ids.completedRunId,
    currentSessionId: 'session-completed',
    sessionIds: ['session-completed'],
    status: 'completed',
    createdAt: '2026-03-18T09:00:00.000Z',
    updatedAt: '2026-03-18T09:08:00.000Z',
    currentStage: 'verification_completed',
    approvalState: {
      required: false,
      status: 'not_required',
      artifactPaths: [],
    },
    verificationState: {
      status: 'passed',
      summary: 'Verification passed.',
      resultPath: resolve(completedRunDir, 'verification.result.json'),
      lastVerifiedAt: '2026-03-18T09:07:00.000Z',
    },
    workspace: {
      repoRoot,
      runDirectory: completedRunDir,
    },
    github: {
      pullRequest: {
        repo: {
          owner: 'acme',
          repo: 'gdh',
          fullName: 'acme/gdh',
        },
        pullRequestNumber: 34,
        title: 'Phase 7 dashboard',
        url: 'https://github.com/acme/gdh/pull/34',
        state: 'open',
        isDraft: true,
        baseBranch: 'main',
        headBranch: 'anf/codex/dashboard-phase7',
      },
      draftPrResultPath: resolve(completedRunDir, 'github', 'draft-pr.result.json'),
      iterationRequestPaths: [],
      updatedAt: '2026-03-18T09:08:00.000Z',
    },
    artifactPaths: {
      reviewPacket: resolve(completedRunDir, 'review-packet.json'),
    },
    resumeEligibility: {
      status: 'ineligible',
      eligible: false,
      evaluatedAt: '2026-03-18T09:08:00.000Z',
      summary: 'Run already completed.',
      reasons: ['Completed run.'],
      requiredArtifactPaths: [],
    },
    pendingActions: [],
    summary: 'Completed run.',
  });
  await writeJson(resolve(completedRunDir, 'github', 'draft-pr.result.json'), {
    runId: ids.completedRunId,
    request: {
      runId: ids.completedRunId,
      repo: {
        owner: 'acme',
        repo: 'gdh',
        fullName: 'acme/gdh',
      },
      baseBranch: 'main',
      headBranch: 'anf/codex/dashboard-phase7',
      title: 'Phase 7 dashboard',
      body: 'Draft PR body.',
      draft: true,
      reviewPacketPath: resolve(completedRunDir, 'review-packet.md'),
      artifactPaths: [resolve(completedRunDir, 'review-packet.md')],
      createdAt: '2026-03-18T09:08:00.000Z',
    },
    pullRequest: {
      repo: {
        owner: 'acme',
        repo: 'gdh',
        fullName: 'acme/gdh',
      },
      pullRequestNumber: 34,
      title: 'Phase 7 dashboard',
      url: 'https://github.com/acme/gdh/pull/34',
      state: 'open',
      isDraft: true,
      baseBranch: 'main',
      headBranch: 'anf/codex/dashboard-phase7',
    },
    createdAt: '2026-03-18T09:08:10.000Z',
  });
  await writeText(
    resolve(completedRunDir, 'events.jsonl'),
    `${[
      {
        id: 'evt-run-created',
        runId: ids.completedRunId,
        timestamp: '2026-03-18T09:00:00.000Z',
        type: 'run.created',
        payload: { summary: 'Run created.' },
      },
      {
        id: 'evt-plan-created',
        runId: ids.completedRunId,
        timestamp: '2026-03-18T09:01:00.000Z',
        type: 'plan.created',
        payload: { artifactPath: resolve(completedRunDir, 'plan.json') },
      },
      {
        id: 'evt-policy',
        runId: ids.completedRunId,
        timestamp: '2026-03-18T09:02:00.000Z',
        type: 'policy.evaluated',
        payload: {
          decision: 'allow',
          artifactPath: resolve(completedRunDir, 'policy.decision.json'),
        },
      },
      {
        id: 'evt-verification',
        runId: ids.completedRunId,
        timestamp: '2026-03-18T09:07:00.000Z',
        type: 'verification.completed',
        payload: {
          summary: 'Verification passed.',
          artifactPath: resolve(completedRunDir, 'verification.result.json'),
        },
      },
      {
        id: 'evt-pr',
        runId: ids.completedRunId,
        timestamp: '2026-03-18T09:08:00.000Z',
        type: 'github.pr.draft_created',
        payload: { artifactPath: resolve(completedRunDir, 'github', 'draft-pr.result.json') },
      },
      {
        id: 'evt-complete',
        runId: ids.completedRunId,
        timestamp: '2026-03-18T09:08:10.000Z',
        type: 'run.completed',
        payload: { summary: 'Completed dashboard work.' },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n')}\n`,
  );

  await writeJson(resolve(pendingApprovalRunDir, 'run.json'), {
    id: ids.pendingApprovalRunId,
    specId: 'spec-dashboard-approval',
    planId: 'plan-dashboard-approval',
    status: 'awaiting_approval',
    currentStage: 'awaiting_approval',
    verificationStatus: 'not_run',
    runner: 'fake',
    model: 'gpt-5.4',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalMode: 'fail',
    networkAccess: false,
    policyPackName: 'default',
    policyPackVersion: 1,
    policyPackPath: resolve(repoRoot, 'policies', 'default.policy.yaml'),
    repoRoot,
    runDirectory: pendingApprovalRunDir,
    sourceSpecPath: resolve(repoRoot, 'runs', 'fixtures', 'dashboard-approval.md'),
    createdAt: '2026-03-18T09:15:00.000Z',
    updatedAt: '2026-03-18T09:16:00.000Z',
    summary: 'Waiting for approval on a protected workflow file change.',
  });
  await writeJson(resolve(pendingApprovalRunDir, 'spec.normalized.json'), {
    source: 'markdown',
    sourcePath: resolve(repoRoot, 'runs', 'fixtures', 'dashboard-approval.md'),
    title: 'Dashboard Approval Run',
    summary: 'Request approval before editing release workflow visibility.',
    objective: 'Request approval before editing release workflow visibility.',
    taskClass: 'ci',
    constraints: ['Do not bypass approval.'],
    acceptanceCriteria: ['Persist the approval packet.'],
    riskHints: ['Touches protected workflow files.'],
    normalizationNotes: [],
  });
  await writeJson(resolve(pendingApprovalRunDir, 'plan.json'), {
    summary: 'Prepare the workflow visibility change and wait for approval.',
    doneConditions: ['Persist the approval packet.'],
    assumptions: [],
    openQuestions: ['Should the workflow be edited at all?'],
    taskUnits: [
      {
        order: 1,
        title: 'Inspect workflow file',
        description: 'Read the workflow before editing it.',
        riskLevel: 'low',
        suggestedMode: 'read_only',
        status: 'done',
      },
    ],
  });
  await writeJson(resolve(pendingApprovalRunDir, 'policy.decision.json'), {
    decision: 'prompt',
    affectedPaths: ['.github/workflows/ci.yml'],
    matchedCommands: ['pnpm test'],
    requiredApprovalMode: 'fail',
    notes: ['Release workflows are protected.'],
  });
  await writeJson(resolve(pendingApprovalRunDir, 'approval-packet.json'), {
    id: 'approval-dashboard-pending',
    runId: ids.pendingApprovalRunId,
    specTitle: 'Dashboard Approval Run',
    decisionSummary: 'Approval is required before editing the workflow file.',
    policyDecision: 'prompt',
    whyApprovalIsRequired: ['Release workflows are protected.'],
    affectedPaths: ['.github/workflows/ci.yml'],
    predictedCommands: ['pnpm test'],
    matchedRules: [],
    riskSummary: ['Protected workflow path.'],
    assumptions: [],
    mitigationNotes: ['Wait for a human decision.'],
    artifactPaths: [resolve(pendingApprovalRunDir, 'approval-packet.md')],
    createdAt: '2026-03-18T09:16:00.000Z',
  });
  await writeText(
    resolve(pendingApprovalRunDir, 'approval-packet.md'),
    '# Approval Packet\n\nWorkflow file change pending.\n',
  );
  await writeJson(resolve(pendingApprovalRunDir, 'review-packet.json'), {
    id: 'review-dashboard-pending',
    runId: ids.pendingApprovalRunId,
    title: 'Review Packet: Dashboard Approval Run',
    specTitle: 'Dashboard Approval Run',
    runStatus: 'awaiting_approval',
    packetStatus: 'verification_failed',
    objective: 'Request approval before editing release workflow visibility.',
    overview: 'The run is paused awaiting approval.',
    planSummary: 'Prepare the workflow visibility change and wait for approval.',
    runnerReportedSummary: 'Waiting for approval on a protected workflow file change.',
    filesChanged: [],
    commandsExecuted: [],
    checksRun: [],
    artifactPaths: [resolve(pendingApprovalRunDir, 'approval-packet.json')],
    diffSummary: ['No workspace changes yet.'],
    policy: {
      decision: 'prompt',
      summary: 'Approval required.',
      auditStatus: 'clean',
      auditSummary: 'No writes executed.',
      matchedRuleIds: ['release-workflows-protected'],
    },
    approvals: {
      required: true,
      status: 'pending',
      summary: 'Approval is pending.',
      approvalPacketId: 'approval-dashboard-pending',
    },
    risks: ['Protected workflow path.'],
    limitations: ['No execution happened yet.'],
    openQuestions: ['Should the workflow be edited at all?'],
    verification: {
      status: 'not_run',
      summary: 'Verification has not started.',
      mandatoryFailures: [],
    },
    claimVerification: {
      status: 'passed',
      summary: 'No claims to verify yet.',
      totalClaims: 0,
      passedClaims: 0,
      failedClaims: 0,
      results: [],
    },
    rollbackHint: 'No rollback required.',
    createdAt: '2026-03-18T09:16:10.000Z',
  });
  await writeJson(resolve(pendingApprovalRunDir, 'session.manifest.json'), {
    runId: ids.pendingApprovalRunId,
    currentSessionId: 'session-pending',
    sessionIds: ['session-pending'],
    status: 'awaiting_approval',
    createdAt: '2026-03-18T09:15:00.000Z',
    updatedAt: '2026-03-18T09:16:00.000Z',
    currentStage: 'awaiting_approval',
    policyDecision: {
      decision: 'prompt',
      summary: 'Approval required.',
      artifactPath: resolve(pendingApprovalRunDir, 'policy.decision.json'),
      requiredApprovalMode: 'fail',
    },
    approvalState: {
      required: true,
      status: 'pending',
      approvalPacketId: 'approval-dashboard-pending',
      artifactPaths: [resolve(pendingApprovalRunDir, 'approval-packet.json')],
    },
    verificationState: {
      status: 'not_run',
      summary: 'Verification has not started.',
    },
    workspace: {
      repoRoot,
      runDirectory: pendingApprovalRunDir,
    },
    artifactPaths: {
      approvalPacket: resolve(pendingApprovalRunDir, 'approval-packet.json'),
    },
    resumeEligibility: {
      status: 'eligible',
      eligible: true,
      evaluatedAt: '2026-03-18T09:16:00.000Z',
      summary: 'Approval resolution can resume the run.',
      reasons: ['Pending approval.'],
      requiredArtifactPaths: [resolve(pendingApprovalRunDir, 'approval-packet.json')],
      nextStage: 'awaiting_approval',
    },
    pendingActions: [
      {
        id: 'pending-approval-action',
        kind: 'approval',
        status: 'open',
        title: 'Resolve approval',
        summary: 'Approve or deny the workflow change.',
        artifactPaths: [resolve(pendingApprovalRunDir, 'approval-packet.json')],
        createdAt: '2026-03-18T09:16:00.000Z',
      },
    ],
    summary: 'Awaiting approval.',
  });
  await writeText(
    resolve(pendingApprovalRunDir, 'events.jsonl'),
    `${[
      {
        id: 'evt-pending-created',
        runId: ids.pendingApprovalRunId,
        timestamp: '2026-03-18T09:15:00.000Z',
        type: 'run.created',
        payload: { summary: 'Run created.' },
      },
      {
        id: 'evt-pending-policy',
        runId: ids.pendingApprovalRunId,
        timestamp: '2026-03-18T09:16:00.000Z',
        type: 'policy.evaluated',
        payload: {
          decision: 'prompt',
          artifactPath: resolve(pendingApprovalRunDir, 'policy.decision.json'),
        },
      },
      {
        id: 'evt-pending-approval',
        runId: ids.pendingApprovalRunId,
        timestamp: '2026-03-18T09:16:05.000Z',
        type: 'approval.requested',
        payload: { summary: 'Approval requested.' },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n')}\n`,
  );

  await writeJson(resolve(verificationFailedRunDir, 'run.json'), {
    id: ids.verificationFailedRunId,
    specId: 'spec-dashboard-failed',
    planId: 'plan-dashboard-failed',
    status: 'failed',
    currentStage: 'verification_completed',
    verificationStatus: 'failed',
    verificationResultPath: resolve(verificationFailedRunDir, 'verification.result.json'),
    lastVerifiedAt: '2026-03-18T09:34:00.000Z',
    runner: 'fake',
    model: 'gpt-5.4',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalMode: 'fail',
    networkAccess: false,
    policyPackName: 'default',
    policyPackVersion: 1,
    policyPackPath: resolve(repoRoot, 'policies', 'default.policy.yaml'),
    repoRoot,
    runDirectory: verificationFailedRunDir,
    sourceSpecPath: resolve(repoRoot, 'runs', 'fixtures', 'dashboard-failed.md'),
    createdAt: '2026-03-18T09:30:00.000Z',
    updatedAt: '2026-03-18T09:34:00.000Z',
    summary: 'Verification failed because the review packet overstated test coverage.',
  });
  await writeJson(resolve(verificationFailedRunDir, 'spec.normalized.json'), {
    source: 'markdown',
    sourcePath: resolve(repoRoot, 'runs', 'fixtures', 'dashboard-failed.md'),
    title: 'Dashboard Verification Failure',
    summary: 'Surface verification failures clearly.',
    objective: 'Surface verification failures clearly.',
    taskClass: 'tests',
    constraints: ['Keep failures evidence-backed.'],
    acceptanceCriteria: ['Record verification failure details.'],
    riskHints: ['Do not overstate checks.'],
    normalizationNotes: [],
  });
  await writeJson(resolve(verificationFailedRunDir, 'plan.json'), {
    summary: 'Demonstrate a failing verification path for the dashboard.',
    doneConditions: ['Record verification failure details.'],
    assumptions: [],
    openQuestions: [],
    taskUnits: [
      {
        order: 1,
        title: 'Run verification',
        description: 'Execute deterministic verification checks.',
        riskLevel: 'low',
        suggestedMode: 'read_only',
        status: 'done',
      },
    ],
  });
  await writeJson(resolve(verificationFailedRunDir, 'policy.decision.json'), {
    decision: 'allow',
    affectedPaths: ['packages/verification/**'],
    matchedCommands: ['pnpm test'],
    requiredApprovalMode: null,
    notes: ['Tests-focused change.'],
  });
  await writeJson(resolve(verificationFailedRunDir, 'verification.result.json'), {
    id: 'verify-dashboard-failed',
    runId: ids.verificationFailedRunId,
    status: 'failed',
    summary: 'Verification failed because one mandatory check failed.',
    commands: [
      {
        id: 'command-failed',
        command: 'pnpm test',
        phase: 'postrun',
        mandatory: true,
        status: 'failed',
        exitCode: 1,
        durationMs: 800,
        summary: 'Test suite failed.',
        startedAt: '2026-03-18T09:33:00.000Z',
        completedAt: '2026-03-18T09:33:00.800Z',
        evidence: [],
      },
    ],
    checks: [
      {
        id: 'check-failed',
        name: 'packet_consistency',
        mandatory: true,
        status: 'failed',
        summary: 'Packet claimed a test that did not pass.',
        details: ['The packet said benchmark smoke passed.'],
        evidence: [],
        startedAt: '2026-03-18T09:34:00.000Z',
        completedAt: '2026-03-18T09:34:00.100Z',
      },
    ],
    claimVerification: {
      status: 'failed',
      summary: 'One review-packet claim was unsupported.',
      totalClaims: 2,
      passedClaims: 1,
      failedClaims: 1,
      results: [],
    },
    packetCompleteness: {
      status: 'passed',
      summary: 'Sections are present.',
      requiredSections: ['overview', 'verification'],
      missingSections: [],
      incompleteSections: [],
    },
    completionDecision: {
      finalStatus: 'failed',
      canComplete: false,
      summary: 'Run cannot complete.',
      blockingCheckIds: ['check-failed'],
      blockingReasons: ['Packet consistency failed.'],
    },
    resumable: false,
    createdAt: '2026-03-18T09:34:00.000Z',
  });
  await writeJson(resolve(verificationFailedRunDir, 'review-packet.json'), {
    id: 'review-dashboard-failed',
    runId: ids.verificationFailedRunId,
    title: 'Review Packet: Dashboard Verification Failure',
    specTitle: 'Dashboard Verification Failure',
    runStatus: 'failed',
    packetStatus: 'verification_failed',
    objective: 'Surface verification failures clearly.',
    overview: 'Verification failed and blocked completion.',
    planSummary: 'Demonstrate a failing verification path for the dashboard.',
    runnerReportedSummary:
      'Verification failed because the review packet overstated test coverage.',
    filesChanged: ['packages/verification/src/index.ts'],
    commandsExecuted: [],
    checksRun: [],
    artifactPaths: [resolve(verificationFailedRunDir, 'verification.result.json')],
    diffSummary: ['1 file changed.'],
    policy: {
      decision: 'allow',
      summary: 'Allowed by policy.',
      auditStatus: 'clean',
      auditSummary: 'No scope drift.',
      matchedRuleIds: ['tests-safe'],
    },
    approvals: {
      required: false,
      status: 'not_required',
      summary: 'No approval required.',
    },
    risks: ['Verification failed.'],
    limitations: ['The run is blocked from completion.'],
    openQuestions: [],
    verification: {
      status: 'failed',
      summary: 'Verification failed because one mandatory check failed.',
      mandatoryFailures: ['Packet consistency failed.'],
      lastVerifiedAt: '2026-03-18T09:34:00.000Z',
    },
    claimVerification: {
      status: 'failed',
      summary: 'One review-packet claim was unsupported.',
      totalClaims: 2,
      passedClaims: 1,
      failedClaims: 1,
      results: [],
    },
    rollbackHint: 'Remove the unsupported review-packet claim.',
    createdAt: '2026-03-18T09:34:10.000Z',
  });
  await writeText(
    resolve(verificationFailedRunDir, 'review-packet.md'),
    '# Review Packet\n\nVerification failed.\n',
  );
  await writeJson(resolve(verificationFailedRunDir, 'session.manifest.json'), {
    runId: ids.verificationFailedRunId,
    currentSessionId: 'session-failed',
    sessionIds: ['session-failed'],
    status: 'failed',
    createdAt: '2026-03-18T09:30:00.000Z',
    updatedAt: '2026-03-18T09:34:00.000Z',
    currentStage: 'verification_completed',
    approvalState: {
      required: false,
      status: 'not_required',
      artifactPaths: [],
    },
    verificationState: {
      status: 'failed',
      summary: 'Verification failed.',
      resultPath: resolve(verificationFailedRunDir, 'verification.result.json'),
      lastVerifiedAt: '2026-03-18T09:34:00.000Z',
    },
    workspace: {
      repoRoot,
      runDirectory: verificationFailedRunDir,
    },
    artifactPaths: {
      verification: resolve(verificationFailedRunDir, 'verification.result.json'),
    },
    resumeEligibility: {
      status: 'ineligible',
      eligible: false,
      evaluatedAt: '2026-03-18T09:34:00.000Z',
      summary: 'Verification failure blocks completion.',
      reasons: ['Mandatory verification failed.'],
      requiredArtifactPaths: [],
    },
    pendingActions: [],
    summary: 'Verification failed.',
  });
  await writeText(
    resolve(verificationFailedRunDir, 'events.jsonl'),
    `${[
      {
        id: 'evt-failed-created',
        runId: ids.verificationFailedRunId,
        timestamp: '2026-03-18T09:30:00.000Z',
        type: 'run.created',
        payload: { summary: 'Run created.' },
      },
      {
        id: 'evt-failed-verification',
        runId: ids.verificationFailedRunId,
        timestamp: '2026-03-18T09:34:00.000Z',
        type: 'verification.failed',
        payload: {
          summary: 'Packet consistency failed.',
          artifactPath: resolve(verificationFailedRunDir, 'verification.result.json'),
        },
      },
      {
        id: 'evt-failed-run',
        runId: ids.verificationFailedRunId,
        timestamp: '2026-03-18T09:34:10.000Z',
        type: 'run.failed',
        payload: {
          summary: 'Verification failed because the review packet overstated test coverage.',
        },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n')}\n`,
  );

  await writeJson(resolve(benchmarkRunDir, 'benchmark.run.json'), {
    id: ids.benchmarkRunId,
    status: 'completed',
    target: {
      kind: 'suite',
      id: 'dashboard-smoke',
    },
    suiteId: 'dashboard-smoke',
    caseIds: ['dashboard-complete', 'dashboard-verify-failure'],
    mode: 'ci_safe',
    repoRoot,
    runDirectory: benchmarkRunDir,
    configuration: {
      ciSafe: true,
      targetId: 'dashboard-smoke',
      targetKind: 'suite',
      suiteId: 'dashboard-smoke',
      thresholdPolicy: {
        maxOverallScoreDrop: 0.1,
        requiredMetrics: ['success', 'verification_correctness'],
        failOnNewlyFailingCases: true,
      },
      baseline: {
        kind: 'benchmark_artifact',
        id: 'dashboard-baseline',
        label: 'Dashboard baseline',
        artifactPath: resolve(repoRoot, 'benchmarks', 'baselines', 'dashboard-baseline.json'),
      },
    },
    score: {
      totalWeight: 1,
      earnedWeight: 0.75,
      normalizedScore: 0.75,
      passedMetrics: 4,
      failedMetrics: 1,
      metrics: [
        {
          name: 'success',
          title: 'Success',
          description: 'Checks overall success.',
          weight: 0.3,
          score: 0.5,
          passed: false,
          summary: 'One case regressed.',
          evidence: [],
        },
      ],
      summary: 'One benchmark case regressed.',
    },
    caseResults: [
      {
        id: `${ids.benchmarkRunId}:dashboard-complete`,
        benchmarkRunId: ids.benchmarkRunId,
        caseId: 'dashboard-complete',
        title: 'Dashboard run completes',
        suiteIds: ['dashboard-smoke'],
        status: 'passed',
        mode: 'ci_safe',
        tags: ['dashboard', 'smoke'],
        governedRunId: ids.completedRunId,
        governedRunPath: completedRunDir,
        startedAt: '2026-03-18T10:00:00.000Z',
        completedAt: '2026-03-18T10:00:30.000Z',
        durationMs: 30000,
        expected: {
          runStatus: 'completed',
          verificationStatus: 'passed',
          requiredArtifacts: ['review-packet.json'],
        },
        actual: {
          runStatus: 'completed',
          verificationStatus: 'passed',
          artifactPaths: [resolve(completedRunDir, 'review-packet.json')],
        },
        score: {
          totalWeight: 1,
          earnedWeight: 1,
          normalizedScore: 1,
          passedMetrics: 5,
          failedMetrics: 0,
          metrics: [],
          summary: 'All metrics passed.',
        },
        failureReasons: [],
        notes: ['Completed as expected.'],
      },
      {
        id: `${ids.benchmarkRunId}:dashboard-verify-failure`,
        benchmarkRunId: ids.benchmarkRunId,
        caseId: 'dashboard-verify-failure',
        title: 'Dashboard run preserves verification failure',
        suiteIds: ['dashboard-smoke'],
        status: 'failed',
        mode: 'ci_safe',
        tags: ['dashboard', 'verification'],
        governedRunId: ids.verificationFailedRunId,
        governedRunPath: verificationFailedRunDir,
        startedAt: '2026-03-18T10:01:00.000Z',
        completedAt: '2026-03-18T10:01:25.000Z',
        durationMs: 25000,
        expected: {
          runStatus: 'failed',
          verificationStatus: 'failed',
          requiredArtifacts: ['verification.result.json'],
        },
        actual: {
          runStatus: 'completed',
          verificationStatus: 'passed',
          artifactPaths: [resolve(verificationFailedRunDir, 'verification.result.json')],
        },
        score: {
          totalWeight: 1,
          earnedWeight: 0.5,
          normalizedScore: 0.5,
          passedMetrics: 2,
          failedMetrics: 3,
          metrics: [],
          summary: 'Verification expectations regressed.',
        },
        failureReasons: ['Verification result did not match the expected failure state.'],
        notes: ['Regression surfaced intentionally.'],
      },
    ],
    comparisonReportPath: resolve(benchmarkRunDir, 'comparison.report.json'),
    regressionResultPath: resolve(benchmarkRunDir, 'regression.result.json'),
    startedAt: '2026-03-18T10:00:00.000Z',
    completedAt: '2026-03-18T10:02:00.000Z',
    summary: 'Dashboard smoke benchmark completed with one regression.',
  });
  await writeJson(resolve(benchmarkRunDir, 'benchmark.suite.json'), {
    version: 1,
    id: 'dashboard-smoke',
    title: 'Dashboard Smoke Suite',
    description: 'Small fixture suite for Phase 7 dashboard coverage.',
    caseIds: ['dashboard-complete', 'dashboard-verify-failure'],
    tags: ['dashboard', 'smoke'],
    mode: 'ci_safe',
    baseline: {
      kind: 'benchmark_artifact',
      id: 'dashboard-baseline',
      label: 'Dashboard baseline',
      artifactPath: resolve(repoRoot, 'benchmarks', 'baselines', 'dashboard-baseline.json'),
    },
    thresholds: {
      maxOverallScoreDrop: 0.1,
      requiredMetrics: ['success', 'verification_correctness'],
      failOnNewlyFailingCases: true,
    },
  });
  await writeJson(resolve(benchmarkRunDir, 'comparison.report.json'), {
    id: 'comparison-dashboard-benchmark',
    comparedAt: '2026-03-18T10:02:00.000Z',
    lhsRunId: ids.benchmarkRunId,
    rhs: {
      kind: 'benchmark_artifact',
      id: 'dashboard-baseline',
      label: 'Dashboard baseline',
      artifactPath: resolve(repoRoot, 'benchmarks', 'baselines', 'dashboard-baseline.json'),
    },
    suiteId: 'dashboard-smoke',
    overall: {
      lhsScore: 0.75,
      rhsScore: 1,
      delta: -0.25,
      lhsPassedCases: 1,
      rhsPassedCases: 2,
      newlyFailingCases: ['dashboard-verify-failure'],
    },
    caseComparisons: [
      {
        caseId: 'dashboard-verify-failure',
        title: 'Dashboard run preserves verification failure',
        lhsStatus: 'failed',
        rhsStatus: 'passed',
        lhsScore: 0.5,
        rhsScore: 1,
        delta: -0.5,
        status: 'regressed',
        metricComparisons: [],
        summary: 'Case regressed.',
      },
    ],
    summary: 'Comparison found one newly failing case.',
  });
  await writeJson(resolve(benchmarkRunDir, 'regression.result.json'), {
    id: 'regression-dashboard-benchmark',
    status: 'failed',
    comparedAt: '2026-03-18T10:02:00.000Z',
    thresholdPolicy: {
      maxOverallScoreDrop: 0.1,
      requiredMetrics: ['success', 'verification_correctness'],
      failOnNewlyFailingCases: true,
    },
    overallScoreDrop: 0.25,
    exceededOverallScoreDrop: true,
    newlyFailingCases: ['dashboard-verify-failure'],
    requiredMetricFailures: [
      {
        caseId: 'dashboard-verify-failure',
        metric: 'verification_correctness',
        summary: 'Verification correctness regressed.',
      },
    ],
    reasons: ['Overall score dropped more than allowed.'],
    summary: 'Regression detected for the dashboard smoke suite.',
  });
  await writeJson(resolve(benchmarkRunDir, 'cases', 'dashboard-complete.result.json'), {
    caseId: 'dashboard-complete',
    governedRunId: ids.completedRunId,
  });
  await writeJson(resolve(benchmarkRunDir, 'cases', 'dashboard-verify-failure.result.json'), {
    caseId: 'dashboard-verify-failure',
    governedRunId: ids.verificationFailedRunId,
  });

  return {
    repoRoot,
    ids,
  };
}
