import type {
  ApprovalResolution,
  ChangedFileCapture,
  CommandCapture,
  ImpactPreview,
  PolicyAuditResult,
  PolicyEvaluation,
  PolicyPack,
  Spec,
} from '@gdh/domain';
import { ImpactPreviewSchema, PolicyAuditResultSchema } from '@gdh/domain';
import {
  evaluatePolicy,
  matchesCommandPattern,
  matchesCommandPrefix,
  matchesPathGlob,
} from './matching.js';
import {
  classifyCommandActions,
  classifyPathActions,
  createStableId,
  toPreviewCommand,
  unique,
} from './shared.js';

export interface PolicyAuditInput {
  approvalResolution?: ApprovalResolution;
  changedFiles: ChangedFileCapture;
  commandCapture: CommandCapture;
  createdAt?: string;
  impactPreview: ImpactPreview;
  policyDecision: PolicyEvaluation;
  policyPack: PolicyPack;
  spec: Spec;
}

function previewCoversPath(path: string, preview: ImpactPreview): boolean {
  return preview.proposedFileChanges.some((fileChange) =>
    fileChange.pathKind === 'file'
      ? fileChange.path === path ||
        fileChange.path.replaceAll('\\', '/') === path.replaceAll('\\', '/')
      : matchesPathGlob(path, fileChange.path),
  );
}

function previewCoversCommand(command: string, preview: ImpactPreview): boolean {
  return preview.proposedCommands.some((predictedCommand) => predictedCommand.command === command);
}

function createObservedPreview(
  runId: string,
  changedFiles: ChangedFileCapture,
  commandCapture: CommandCapture,
  preview: ImpactPreview,
): ImpactPreview {
  return ImpactPreviewSchema.parse({
    actionKinds: unique([
      'read',
      ...changedFiles.files.flatMap((file) => classifyPathActions(file.path)),
      ...commandCapture.commands.flatMap((command) => classifyCommandActions(command.command)),
    ]),
    createdAt: new Date().toISOString(),
    id: createStableId(
      'observed-impact',
      `${runId}:${changedFiles.files.length}:${commandCapture.commands.length}`,
    ),
    planId: preview.planId,
    proposedCommands: commandCapture.commands.map((command) =>
      toPreviewCommand(
        command.command,
        'observed',
        'Observed from captured runner command evidence.',
      ),
    ),
    proposedFileChanges: changedFiles.files.map((file) => ({
      actionKind: classifyPathActions(file.path).includes('secrets_touch')
        ? 'secrets_touch'
        : classifyPathActions(file.path).includes('config_change')
          ? 'config_change'
          : 'write',
      confidence: 'high',
      path: file.path,
      pathKind: 'file',
      reason: 'Observed from the post-run workspace diff.',
    })),
    rationale: ['Observed preview derived from actual changed files and captured commands.'],
    requestedNetworkAccess: commandCapture.commands.some((command) =>
      classifyCommandActions(command.command).includes('network'),
    ),
    requestedSandboxMode:
      changedFiles.files.length > 0 || commandCapture.commands.length > 0
        ? 'workspace-write'
        : preview.requestedSandboxMode,
    riskHints: preview.riskHints,
    runId,
    specId: preview.specId,
    summary: 'Observed preview derived from actual run evidence for policy audit.',
    taskClass: preview.taskClass,
    uncertaintyNotes:
      commandCapture.completeness === 'complete'
        ? []
        : [
            'Command capture is partial or unknown, so command-side policy audit may be incomplete.',
          ],
  });
}

export function createPolicyAudit(input: PolicyAuditInput): PolicyAuditResult {
  const observedPreview = createObservedPreview(
    input.impactPreview.runId,
    input.changedFiles,
    input.commandCapture,
    input.impactPreview,
  );
  const observedDecision = evaluatePolicy({
    approvalMode: input.policyDecision.requiredApprovalMode ?? 'fail',
    createdAt: input.createdAt,
    impactPreview: observedPreview,
    policyPack: input.policyPack,
    policyPackPath: input.policyDecision.policyPackPath,
    spec: input.spec,
  });
  const actualChangedPaths = input.changedFiles.files.map((file) => file.path);
  const actualCommands = input.commandCapture.commands.map((command) => command.command);
  const unexpectedPaths = actualChangedPaths.filter(
    (path) => !previewCoversPath(path, input.impactPreview),
  );
  const unexpectedCommands = actualCommands.filter(
    (command) => !previewCoversCommand(command, input.impactPreview),
  );
  const forbiddenPathsTouched = actualChangedPaths.filter((path) =>
    observedDecision.decision === 'forbid'
      ? true
      : input.policyPack.rules.some(
          (rule) =>
            rule.decision === 'forbid' &&
            rule.match.pathGlobs?.some((pattern) => matchesPathGlob(path, pattern)),
        ),
  );
  const promptPathsTouched = actualChangedPaths.filter((path) =>
    input.policyPack.rules.some(
      (rule) =>
        rule.decision === 'prompt' &&
        rule.match.pathGlobs?.some((pattern) => matchesPathGlob(path, pattern)),
    ),
  );
  const forbiddenCommandsTouched = actualCommands.filter((command) =>
    input.policyPack.rules.some(
      (rule) =>
        rule.decision === 'forbid' &&
        ((rule.match.commandPrefixes?.some((prefix) => matchesCommandPrefix(command, prefix)) ??
          false) ||
          (rule.match.commandPatterns?.some((pattern) => matchesCommandPattern(command, pattern)) ??
            false)),
    ),
  );
  const promptCommandsTouched = actualCommands.filter((command) =>
    input.policyPack.rules.some(
      (rule) =>
        rule.decision === 'prompt' &&
        ((rule.match.commandPrefixes?.some((prefix) => matchesCommandPrefix(command, prefix)) ??
          false) ||
          (rule.match.commandPatterns?.some((pattern) => matchesCommandPattern(command, pattern)) ??
            false)),
    ),
  );
  const protectedScopeTouchedWithoutApproval =
    (promptPathsTouched.length > 0 || promptCommandsTouched.length > 0) &&
    input.approvalResolution !== 'approved';
  const approvedScopeDrift =
    input.approvalResolution === 'approved' &&
    (promptPathsTouched.some((path) => !previewCoversPath(path, input.impactPreview)) ||
      promptCommandsTouched.some((command) => !previewCoversCommand(command, input.impactPreview)));
  const status =
    forbiddenPathsTouched.length > 0 ||
    forbiddenCommandsTouched.length > 0 ||
    protectedScopeTouchedWithoutApproval ||
    approvedScopeDrift
      ? 'policy_breach'
      : unexpectedPaths.length > 0 || unexpectedCommands.length > 0
        ? 'scope_drift'
        : 'clean';
  const notes = [...observedPreview.uncertaintyNotes];

  if (unexpectedPaths.length > 0) {
    notes.push(
      'Actual changed files included paths that were not predicted by the impact preview.',
    );
  }

  if (unexpectedCommands.length > 0) {
    notes.push(
      'Actual captured commands included entries that were not predicted by the impact preview.',
    );
  }

  if (forbiddenPathsTouched.length > 0 || forbiddenCommandsTouched.length > 0) {
    notes.push('The run touched surfaces that the policy pack marks as forbidden.');
  }

  if (protectedScopeTouchedWithoutApproval) {
    notes.push('Protected prompt-only surfaces were touched without an approved approval packet.');
  }

  if (approvedScopeDrift) {
    notes.push(
      'Protected prompt-only surfaces were touched outside the originally previewed approval scope.',
    );
  }

  const summary =
    status === 'clean'
      ? 'Policy audit found no obvious drift between the previewed scope and the actual run evidence.'
      : status === 'scope_drift'
        ? 'Policy audit found scope drift beyond the previewed paths or commands, but no direct forbidden surface was proven.'
        : 'Policy audit found an obvious policy breach in the observed run evidence.';

  return PolicyAuditResultSchema.parse({
    actualChangedPaths,
    actualCommands,
    createdAt: input.createdAt ?? new Date().toISOString(),
    forbiddenCommandsTouched,
    forbiddenPathsTouched,
    id: createStableId('policy-audit', `${input.impactPreview.runId}:${status}:${summary}`),
    notes,
    previewedCommands: input.impactPreview.proposedCommands.map((command) => command.command),
    previewedPaths: input.impactPreview.proposedFileChanges.map((fileChange) => fileChange.path),
    promptCommandsTouched,
    promptPathsTouched,
    runId: input.impactPreview.runId,
    status,
    summary,
    unexpectedCommands,
    unexpectedPaths,
  });
}
