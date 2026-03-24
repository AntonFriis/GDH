export const taskClassValues = [
  'docs',
  'tests',
  'ci',
  'refactor',
  'release_notes',
  'triage',
  'other',
] as const;
export const riskLevelValues = ['low', 'medium', 'high'] as const;
export const taskModeValues = ['read_only', 'workspace_write'] as const;
export const taskStatusValues = ['pending', 'running', 'blocked', 'done', 'failed'] as const;
export const runStatusValues = [
  'created',
  'planning',
  'running',
  'in_progress',
  'awaiting_approval',
  'interrupted',
  'resumable',
  'resuming',
  'verifying',
  'completed',
  'failed',
  'cancelled',
  'abandoned',
] as const;
export const runStageValues = [
  'created',
  'spec_normalized',
  'plan_created',
  'policy_evaluated',
  'awaiting_approval',
  'approval_resolved',
  'runner_started',
  'runner_completed',
  'verification_started',
  'verification_completed',
] as const;
export const checkpointStageValues = [
  'spec_normalized',
  'plan_created',
  'policy_evaluated',
  'approval_resolved',
  'runner_completed',
  'verification_completed',
] as const;
export const runnerValues = ['codex-cli', 'codex-sdk', 'fake'] as const;
export const sandboxModeValues = ['read-only', 'workspace-write'] as const;
export const approvalPolicyValues = ['untrusted', 'on-request', 'never'] as const;
export const approvalModeValues = ['interactive', 'fail'] as const;
export const specSourceValues = ['markdown', 'github_issue', 'release_note', 'manual'] as const;
export const actionKindValues = [
  'read',
  'write',
  'command',
  'network',
  'git_remote',
  'config_change',
  'secrets_touch',
  'unknown',
] as const;
export const policyDecisionValues = ['allow', 'prompt', 'forbid'] as const;
export const approvalResolutionValues = ['approved', 'denied', 'abandoned'] as const;
export const previewConfidenceValues = ['high', 'medium', 'low'] as const;
export const proposedPathKindValues = ['file', 'glob'] as const;
export const proposedCommandSourceValues = [
  'heuristic',
  'runner_preview',
  'spec_text',
  'observed',
] as const;
export const policyMatchDimensionValues = [
  'path',
  'action',
  'command',
  'task_class',
  'risk_hint',
  'fallback',
] as const;
export const runEventTypeValues = [
  'run.created',
  'session.started',
  'spec.normalized',
  'plan.created',
  'checkpoint.created',
  'progress.snapshot.created',
  'impact_preview.created',
  'policy.evaluated',
  'approval.requested',
  'approval.granted',
  'approval.denied',
  'policy.blocked',
  'runner.started',
  'runner.completed',
  'runner.failed',
  'run.interrupted',
  'run.marked_resumable',
  'resume.requested',
  'resume.started',
  'resume.completed',
  'resume.failed',
  'status.requested',
  'verification.started',
  'verification.check.started',
  'verification.check.completed',
  'verification.failed',
  'verification.completed',
  'diff.captured',
  'review_packet.generated',
  'github.issue.ingested',
  'github.branch.prepared',
  'github.pr.draft_requested',
  'github.pr.draft_created',
  'github.pr.comment.published',
  'github.iteration.requested',
  'github.sync.failed',
  'benchmark.run.started',
  'benchmark.case.started',
  'benchmark.case.completed',
  'benchmark.run.completed',
  'benchmark.compare.started',
  'benchmark.compare.completed',
  'benchmark.regression.detected',
  'run.completed',
  'run.failed',
] as const;
export const commandProvenanceValues = ['observed', 'parsed', 'self_reported'] as const;
export const captureCompletenessValues = ['complete', 'partial', 'unknown'] as const;
export const changedFileStatusValues = ['added', 'modified', 'deleted'] as const;
export const verificationStatusValues = ['not_run', 'partial', 'passed', 'failed'] as const;
export const verificationCheckStatusValues = ['passed', 'failed', 'skipped'] as const;
export const verificationCommandPhaseValues = ['preflight', 'postrun', 'optional'] as const;
export const verificationEvidenceKindValues = [
  'artifact',
  'event',
  'command',
  'packet_field',
  'run_field',
  'note',
] as const;
export const claimCheckStatusValues = ['passed', 'failed'] as const;
export const claimCategoryValues = [
  'files_changed',
  'checks_executed',
  'approvals',
  'policy',
  'commands_executed',
  'verification_status',
  'unsupported_claim',
] as const;
export const reviewPacketStatusValues = ['ready', 'verification_failed'] as const;
export const reviewPacketApprovalStatusValues = [
  'not_required',
  'pending',
  ...approvalResolutionValues,
] as const;
export const policyAuditStatusValues = ['clean', 'scope_drift', 'policy_breach'] as const;
export const runSessionTriggerValues = ['run', 'resume'] as const;
export const runSessionStatusValues = ['active', 'completed', 'interrupted', 'failed'] as const;
export const pendingActionKindValues = [
  'approval',
  'resume',
  'verification',
  'rerun_stage',
  'continuity_review',
] as const;
export const pendingActionStatusValues = ['open', 'resolved', 'superseded'] as const;
export const resumeEligibilityStatusValues = ['eligible', 'ineligible'] as const;
export const workspaceCompatibilityValues = ['compatible', 'warning', 'incompatible'] as const;
export const approvalStateValues = [
  'not_required',
  'pending',
  ...approvalResolutionValues,
] as const;
export const verificationContinuationValues = [
  'not_needed',
  'resume_verification',
  'rerun_verification',
] as const;
export const approvalContinuationValues = [
  'not_needed',
  'reuse_existing',
  'resolve_pending',
  're_evaluate',
] as const;
export const benchmarkRunStatusValues = ['created', 'running', 'completed', 'failed'] as const;
export const benchmarkExecutionModeValues = ['ci_safe', 'live'] as const;
export const benchmarkTargetKindValues = ['suite', 'case'] as const;
export const benchmarkSuiteIdValues = ['smoke', 'fresh', 'longhorizon'] as const;
export const benchmarkMetricNameValues = [
  'success',
  'policy_correctness',
  'verification_correctness',
  'packet_completeness',
  'artifact_presence',
  'latency',
] as const;
export const benchmarkGraderNameValues = [
  'task_completion',
  'tests_passing',
  'policy_violations',
  'review_packet_fidelity',
  'artifact_completeness',
  'latency',
  'human_intervention_count',
] as const;
export const benchmarkSourceTypeValues = [
  'documentation_log',
  'git_commit',
  'github_issue',
  'release_artifact',
  'manual_curation',
] as const;
export const benchmarkCandidateStatusValues = ['candidate', 'accepted', 'rejected'] as const;
export const benchmarkCaseResultStatusValues = ['passed', 'failed', 'error'] as const;
export const baselineRefKindValues = ['benchmark_run', 'benchmark_artifact'] as const;
export const benchmarkComparisonStatusValues = [
  'equal',
  'improved',
  'regressed',
  'missing',
] as const;
export const regressionStatusValues = ['passed', 'failed'] as const;
export const timelineSeverityValues = ['info', 'success', 'warning', 'error'] as const;
export const githubSummaryStateValues = [
  'not_requested',
  'issue_ingested',
  'branch_prepared',
  'draft_pr_requested',
  'draft_pr_created',
  'sync_failed',
] as const;
export const artifactLinkFormatValues = [
  'json',
  'jsonl',
  'markdown',
  'text',
  'patch',
  'directory',
  'unknown',
] as const;
export const activityKindValues = ['run', 'benchmark'] as const;
export const failureCategoryValues = [
  'policy-false-positive',
  'policy-miss',
  'approval-ux-friction',
  'verification-false-positive',
  'verification-false-negative',
  'review-packet-claim-mismatch',
  'packet-completeness-issue',
  'resumability-failure',
  'continuity-workspace-mismatch',
  'github-delivery-failure',
  'benchmark-instability',
  'benchmark-contamination',
  'architecture-hotspot',
  'operator-confusion-dx',
  'command-reporting-gap',
  'artifact-persistence-inconsistency',
  'flaky-test-or-benchmark',
  'unknown-needs-triage',
] as const;
export const failureSeverityValues = ['low', 'medium', 'high', 'critical'] as const;
export const failureSourceSurfaceValues = [
  'run',
  'benchmark',
  'dogfooding',
  'approval',
  'verification',
  'resume',
  'github_delivery',
  'review_packet',
  'policy',
  'operator_feedback',
  'release_validation',
  'other',
] as const;
export const failureRecordStatusValues = [
  'open',
  'triaged',
  'investigating',
  'mitigated',
  'resolved',
  'wont_fix',
] as const;
export const failureBucketKindValues = [
  'policy_blocked',
  'approval_pending',
  'approval_denied',
  'verification_failed',
  'review_packet_inconsistent',
  'benchmark_regression',
  'github_sync_failed',
] as const;
