import type {
  ActionKind,
  ApprovalMode,
  ImpactPreview,
  PolicyDecision,
  PolicyDecisionReason,
  PolicyEvaluation,
  PolicyMatchDimension,
  PolicyPack,
  PolicyRule,
  ProposedCommand,
  ProposedFileChange,
  Spec,
} from '@gdh/domain';
import { PolicyEvaluationSchema } from '@gdh/domain';
import picomatch from 'picomatch';
import { classifyCommandActions, classifyPathActions, normalizePath } from './shared.js';

export interface EvaluatePolicyInput {
  approvalMode: ApprovalMode;
  createdAt?: string;
  impactPreview: ImpactPreview;
  policyPack: PolicyPack;
  policyPackPath: string;
  spec: Spec;
}

interface RuleMatchResult {
  decision: PolicyDecision;
  matchedOn: PolicyMatchDimension[];
  rule: PolicyRule;
  specificity: number;
  summary: string;
  surface: 'path' | 'command' | 'context';
}

interface PathCandidateContext {
  actionKinds: ActionKind[];
  primaryActionKind: ActionKind;
  fileChange: ProposedFileChange;
}

interface CommandCandidateContext {
  actionKinds: ActionKind[];
  primaryActionKind: ActionKind;
  command: ProposedCommand;
}

interface CandidateDecisionResult {
  commandSource?: ProposedCommand['source'];
  decision: PolicyDecision;
  explicitAllowMatch: boolean;
  isFallback: boolean;
  matches: RuleMatchResult[];
  reason: PolicyDecisionReason;
  surface: 'path' | 'command';
  target: string;
}

function staticGlobPrefix(pattern: string): string {
  const normalized = normalizePath(pattern);
  const wildcardIndex = normalized.search(/[*?[\]{}()]/);

  if (wildcardIndex === -1) {
    return normalized;
  }

  return normalized.slice(0, wildcardIndex).replace(/\/+$/, '');
}

export function matchesPathGlob(path: string, pattern: string): boolean {
  return picomatch.isMatch(normalizePath(path), normalizePath(pattern), { dot: true });
}

function globsOverlap(left: string, right: string): boolean {
  const leftPrefix = staticGlobPrefix(left);
  const rightPrefix = staticGlobPrefix(right);

  if (!leftPrefix || !rightPrefix) {
    return true;
  }

  return leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix);
}

function pathHintMatchesRule(pathHint: ProposedFileChange, pattern: string): boolean {
  return pathHint.pathKind === 'file'
    ? matchesPathGlob(pathHint.path, pattern)
    : globsOverlap(pathHint.path, pattern);
}

export function matchesCommandPrefix(command: string, prefix: string): boolean {
  return command.trim().toLowerCase().startsWith(prefix.trim().toLowerCase());
}

function toCommandPattern(pattern: string): RegExp {
  const trimmed = pattern.trim();

  if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
    const lastSlashIndex = trimmed.lastIndexOf('/');
    const source = trimmed.slice(1, lastSlashIndex);
    const flags = trimmed.slice(lastSlashIndex + 1) || 'i';
    return new RegExp(source, flags);
  }

  return new RegExp(trimmed, 'i');
}

export function matchesCommandPattern(command: string, pattern: string): boolean {
  return toCommandPattern(pattern).test(command);
}

function riskHintsMatch(ruleHints: string[] | undefined, specHints: string[]): boolean {
  if (!ruleHints || ruleHints.length === 0) {
    return true;
  }

  const normalizedSpecHints = specHints.map((hint) => hint.toLowerCase());

  return ruleHints.some((ruleHint) =>
    normalizedSpecHints.some(
      (specHint) =>
        specHint.includes(ruleHint.toLowerCase()) || ruleHint.toLowerCase().includes(specHint),
    ),
  );
}

function actionKindsMatchRule(
  primaryActionKind: ActionKind,
  ruleActionKinds: ActionKind[] | undefined,
): boolean {
  if (!ruleActionKinds || ruleActionKinds.length === 0) {
    return true;
  }

  if (ruleActionKinds.includes(primaryActionKind)) {
    return true;
  }

  return (
    (primaryActionKind === 'config_change' || primaryActionKind === 'secrets_touch') &&
    ruleActionKinds.includes('write')
  );
}

function decisionRank(decision: PolicyDecision): number {
  switch (decision) {
    case 'forbid':
      return 3;
    case 'prompt':
      return 2;
    case 'allow':
      return 1;
  }
}

function specificityScore(matchedOn: PolicyMatchDimension[]): number {
  return matchedOn.reduce((total, dimension) => {
    switch (dimension) {
      case 'path':
      case 'command':
        return total + 100;
      case 'action':
        return total + 40;
      case 'task_class':
        return total + 20;
      case 'risk_hint':
        return total + 10;
      case 'fallback':
        return total;
    }

    return total;
  }, matchedOn.length);
}

function hasSurfaceOverride(matchedOn: PolicyMatchDimension[]): number {
  return matchedOn.some((dimension) => ['path', 'command', 'action'].includes(dimension)) ? 1 : 0;
}

function surfacePriority(surface: RuleMatchResult['surface']): number {
  switch (surface) {
    case 'path':
      return 3;
    case 'command':
      return 2;
    case 'context':
      return 1;
  }
}

function compareMatchResults(left: RuleMatchResult, right: RuleMatchResult): number {
  return (
    decisionRank(right.decision) - decisionRank(left.decision) ||
    surfacePriority(right.surface) - surfacePriority(left.surface) ||
    hasSurfaceOverride(right.matchedOn) - hasSurfaceOverride(left.matchedOn) ||
    right.specificity - left.specificity ||
    left.rule.id.localeCompare(right.rule.id)
  );
}

function ruleSummary(rule: PolicyRule, target: string): string {
  return rule.reason?.trim() || `Rule "${rule.id}" matched "${target}".`;
}

function matchesCommonRuleDimensions(rule: PolicyRule, spec: Spec): PolicyMatchDimension[] | null {
  const matchedOn: PolicyMatchDimension[] = [];

  if (rule.match.taskClasses) {
    if (!rule.match.taskClasses.includes(spec.taskClass)) {
      return null;
    }

    matchedOn.push('task_class');
  }

  if (rule.match.riskHints) {
    if (!riskHintsMatch(rule.match.riskHints, spec.riskHints)) {
      return null;
    }

    matchedOn.push('risk_hint');
  }

  return matchedOn;
}

function matchPathRule(
  rule: PolicyRule,
  candidate: PathCandidateContext,
  spec: Spec,
): RuleMatchResult | null {
  if (rule.match.commandPrefixes || rule.match.commandPatterns) {
    return null;
  }

  const matchedOn = matchesCommonRuleDimensions(rule, spec);

  if (!matchedOn) {
    return null;
  }

  if (rule.match.pathGlobs) {
    if (
      !rule.match.pathGlobs.some((pattern) => pathHintMatchesRule(candidate.fileChange, pattern))
    ) {
      return null;
    }

    matchedOn.push('path');
  }

  if (rule.match.actionKinds) {
    if (!actionKindsMatchRule(candidate.primaryActionKind, rule.match.actionKinds)) {
      return null;
    }

    matchedOn.push('action');
  }

  if (matchedOn.length === 0) {
    return null;
  }

  return {
    decision: rule.decision,
    matchedOn,
    rule,
    specificity: specificityScore(matchedOn),
    summary: ruleSummary(rule, candidate.fileChange.path),
    surface: 'path',
  };
}

function matchCommandRule(
  rule: PolicyRule,
  candidate: CommandCandidateContext,
  spec: Spec,
): RuleMatchResult | null {
  if (rule.match.pathGlobs) {
    return null;
  }

  const matchedOn = matchesCommonRuleDimensions(rule, spec);

  if (!matchedOn) {
    return null;
  }

  if (rule.match.commandPrefixes) {
    if (
      !rule.match.commandPrefixes.some((prefix) =>
        matchesCommandPrefix(candidate.command.command, prefix),
      )
    ) {
      return null;
    }

    matchedOn.push('command');
  }

  if (rule.match.commandPatterns) {
    if (
      !rule.match.commandPatterns.some((pattern) =>
        matchesCommandPattern(candidate.command.command, pattern),
      )
    ) {
      return null;
    }

    if (!matchedOn.includes('command')) {
      matchedOn.push('command');
    }
  }

  if (rule.match.actionKinds) {
    if (!actionKindsMatchRule(candidate.primaryActionKind, rule.match.actionKinds)) {
      return null;
    }

    matchedOn.push('action');
  }

  if (matchedOn.length === 0) {
    return null;
  }

  return {
    decision: rule.decision,
    matchedOn,
    rule,
    specificity: specificityScore(matchedOn),
    summary: ruleSummary(rule, candidate.command.command),
    surface: 'command',
  };
}

function matchContextRuleForActions(
  rule: PolicyRule,
  primaryActionKind: ActionKind,
  spec: Spec,
  target: string,
): RuleMatchResult | null {
  if (rule.match.pathGlobs || rule.match.commandPrefixes || rule.match.commandPatterns) {
    return null;
  }

  const matchedOn = matchesCommonRuleDimensions(rule, spec);

  if (!matchedOn) {
    return null;
  }

  if (rule.match.actionKinds) {
    if (!actionKindsMatchRule(primaryActionKind, rule.match.actionKinds)) {
      return null;
    }

    matchedOn.push('action');
  }

  if (matchedOn.length === 0) {
    return null;
  }

  return {
    decision: rule.decision,
    matchedOn,
    rule,
    specificity: specificityScore(matchedOn),
    summary: ruleSummary(rule, target),
    surface: 'context',
  };
}

function dedupeMatchResults(matches: RuleMatchResult[]): RuleMatchResult[] {
  const deduped = new Map<string, RuleMatchResult>();

  for (const match of [...matches].sort(compareMatchResults)) {
    const existing = deduped.get(match.rule.id);

    if (!existing || compareMatchResults(existing, match) > 0) {
      deduped.set(match.rule.id, match);
    }
  }

  return [...deduped.values()].sort(compareMatchResults);
}

function buildReasons(
  outcomes: CandidateDecisionResult[],
  fallbackDecision: PolicyDecision,
): PolicyDecisionReason[] {
  if (outcomes.length === 0) {
    return [
      {
        decision: fallbackDecision,
        matchedOn: ['fallback'],
        ruleId: null,
        specificity: 0,
        summary: `No explicit policy rule matched the preview, so the documented fallback decision "${fallbackDecision}" was used.`,
      },
    ];
  }

  return outcomes.map((outcome) => outcome.reason);
}

function isWriteCapablePath(candidate: PathCandidateContext): boolean {
  return (
    candidate.fileChange.actionKind === 'write' ||
    candidate.fileChange.actionKind === 'config_change' ||
    candidate.fileChange.actionKind === 'secrets_touch'
  );
}

function buildFallbackReason(
  surface: CandidateDecisionResult['surface'],
  target: string,
  fallbackDecision: PolicyDecision,
): PolicyDecisionReason {
  return {
    decision: fallbackDecision,
    matchedOn: ['fallback'],
    ruleId: null,
    specificity: 0,
    summary:
      surface === 'path'
        ? `No explicit policy rule matched predicted path "${target}", so the documented fallback decision "${fallbackDecision}" governs that write surface.`
        : `No explicit policy rule matched predicted command "${target}", so the documented fallback decision "${fallbackDecision}" governs that command surface.`,
  };
}

function buildPathCandidateDecision(
  candidate: PathCandidateContext,
  rules: PolicyRule[],
  spec: Spec,
  fallbackDecision: PolicyDecision,
): CandidateDecisionResult {
  const matches = dedupeMatchResults(
    rules
      .flatMap((rule) => [
        matchPathRule(rule, candidate, spec),
        matchContextRuleForActions(
          rule,
          candidate.primaryActionKind,
          spec,
          candidate.fileChange.path,
        ),
      ])
      .filter((match): match is RuleMatchResult => match !== null),
  );
  const winner = matches[0];
  const explicitAllowMatch = matches.some((match) => match.decision === 'allow');
  const fallbackReason = buildFallbackReason('path', candidate.fileChange.path, fallbackDecision);
  const initialDecision = winner?.decision ?? fallbackDecision;

  if (isWriteCapablePath(candidate) && initialDecision === 'allow' && !explicitAllowMatch) {
    return {
      commandSource: undefined,
      decision: 'prompt',
      explicitAllowMatch,
      isFallback: true,
      matches,
      reason: {
        decision: 'prompt',
        matchedOn: ['fallback'],
        ruleId: null,
        specificity: 0,
        summary: `Predicted write path "${candidate.fileChange.path}" is not explicitly allowed by policy, so approval is required before auto-allowing that write surface.`,
      },
      surface: 'path',
      target: candidate.fileChange.path,
    };
  }

  return {
    commandSource: undefined,
    decision: initialDecision,
    explicitAllowMatch,
    isFallback: winner === undefined,
    matches,
    reason: winner
      ? {
          decision: winner.decision,
          matchedOn: winner.matchedOn,
          ruleId: winner.rule.id,
          specificity: winner.specificity,
          summary: winner.summary,
        }
      : fallbackReason,
    surface: 'path',
    target: candidate.fileChange.path,
  };
}

function buildCommandCandidateDecision(
  candidate: CommandCandidateContext,
  rules: PolicyRule[],
  spec: Spec,
  fallbackDecision: PolicyDecision,
): CandidateDecisionResult {
  const matches = dedupeMatchResults(
    rules
      .flatMap((rule) => [
        matchCommandRule(rule, candidate, spec),
        matchContextRuleForActions(
          rule,
          candidate.primaryActionKind,
          spec,
          candidate.command.command,
        ),
      ])
      .filter((match): match is RuleMatchResult => match !== null),
  );
  const winner = matches[0];
  const decision = winner?.decision ?? fallbackDecision;

  return {
    commandSource: candidate.command.source,
    decision,
    explicitAllowMatch: matches.some((match) => match.decision === 'allow'),
    isFallback: winner === undefined,
    matches,
    reason: winner
      ? {
          decision: winner.decision,
          matchedOn: winner.matchedOn,
          ruleId: winner.rule.id,
          specificity: winner.specificity,
          summary: winner.summary,
        }
      : buildFallbackReason('command', candidate.command.command, fallbackDecision),
    surface: 'command',
    target: candidate.command.command,
  };
}

function compareCandidateDecisionResults(
  left: CandidateDecisionResult,
  right: CandidateDecisionResult,
): number {
  const leftSpecificity = left.reason.specificity;
  const rightSpecificity = right.reason.specificity;

  return (
    decisionRank(right.decision) - decisionRank(left.decision) ||
    (right.surface === 'path' ? 1 : 0) - (left.surface === 'path' ? 1 : 0) ||
    rightSpecificity - leftSpecificity ||
    left.target.localeCompare(right.target)
  );
}

export function evaluatePolicy(input: EvaluatePolicyInput): PolicyEvaluation {
  const pathCandidates: PathCandidateContext[] = input.impactPreview.proposedFileChanges.map(
    (fileChange) => ({
      actionKinds: classifyPathActions(fileChange.path),
      primaryActionKind: fileChange.actionKind,
      fileChange,
    }),
  );
  const commandCandidates: CommandCandidateContext[] = input.impactPreview.proposedCommands.map(
    (command) => ({
      actionKinds: classifyCommandActions(command.command),
      primaryActionKind: command.actionKind,
      command,
    }),
  );
  const candidateResults = [
    ...pathCandidates.map((candidate) =>
      buildPathCandidateDecision(
        candidate,
        input.policyPack.rules,
        input.spec,
        input.policyPack.defaults.fallbackDecision,
      ),
    ),
    ...commandCandidates.map((candidate) =>
      buildCommandCandidateDecision(
        candidate,
        input.policyPack.rules,
        input.spec,
        input.policyPack.defaults.fallbackDecision,
      ),
    ),
  ].sort(compareCandidateDecisionResults);
  const pathResults = candidateResults.filter(
    (result): result is CandidateDecisionResult & { surface: 'path' } => result.surface === 'path',
  );
  const allPredictedWritePathsExplicitlyAllowed =
    pathResults.length > 0 &&
    pathResults.every((result) => result.decision === 'allow' && !result.isFallback);
  const decisionRelevantResults = candidateResults
    .filter((result) => {
      if (
        result.surface === 'command' &&
        result.decision === 'prompt' &&
        result.isFallback &&
        result.commandSource === 'heuristic' &&
        allPredictedWritePathsExplicitlyAllowed
      ) {
        return false;
      }

      return true;
    })
    .sort(compareCandidateDecisionResults);
  const matches = dedupeMatchResults(candidateResults.flatMap((result) => result.matches));
  const winner = decisionRelevantResults[0];
  const decision = winner?.decision ?? input.policyPack.defaults.fallbackDecision;
  const reasons = buildReasons(decisionRelevantResults, input.policyPack.defaults.fallbackDecision);
  const notes = [...input.impactPreview.uncertaintyNotes];

  if (matches.length === 0) {
    notes.push(
      `Policy evaluation fell back to "${input.policyPack.defaults.fallbackDecision}" because no explicit rule matched the preview.`,
    );
  }

  if (
    pathCandidates.some((candidate) => isWriteCapablePath(candidate)) &&
    candidateResults.some(
      (result) =>
        result.surface === 'path' && result.decision === 'prompt' && result.reason.ruleId === null,
    )
  ) {
    notes.push(
      'At least one predicted write path lacked explicit allow coverage, so policy evaluation required approval instead of auto-allowing the run.',
    );
  }

  if (input.impactPreview.requestedNetworkAccess && !input.policyPack.defaults.networkAccess) {
    notes.push(
      'The preview hints at network use, but the policy pack keeps network disabled by default.',
    );
  }

  return PolicyEvaluationSchema.parse({
    actionKinds: input.impactPreview.actionKinds,
    affectedPaths: input.impactPreview.proposedFileChanges.map((fileChange) => fileChange.path),
    approvalPolicy: input.policyPack.defaults.approvalPolicy,
    createdAt: input.createdAt ?? new Date().toISOString(),
    decision,
    matchedCommands: input.impactPreview.proposedCommands.map((command) => command.command),
    matchedRules: matches.map((match) => ({
      decision: match.decision,
      matchedOn: match.matchedOn,
      reason: match.rule.reason,
      ruleId: match.rule.id,
      specificity: match.specificity,
    })),
    networkAccess: input.policyPack.defaults.networkAccess,
    notes,
    policyPackName: input.policyPack.name,
    policyPackPath: input.policyPackPath,
    policyPackVersion: input.policyPack.version,
    reasons,
    requiredApprovalMode: decision === 'prompt' ? input.approvalMode : null,
    sandboxMode: input.policyPack.defaults.sandboxMode,
    uncertaintyNotes: input.impactPreview.uncertaintyNotes,
  });
}
