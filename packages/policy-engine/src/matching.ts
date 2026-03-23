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
}

interface PathCandidateContext {
  actionKinds: ActionKind[];
  fileChange: ProposedFileChange;
}

interface CommandCandidateContext {
  actionKinds: ActionKind[];
  command: ProposedCommand;
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

function compareMatchResults(left: RuleMatchResult, right: RuleMatchResult): number {
  return (
    decisionRank(right.decision) - decisionRank(left.decision) ||
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
    if (!candidate.actionKinds.some((action) => rule.match.actionKinds?.includes(action))) {
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
    if (!candidate.actionKinds.some((action) => rule.match.actionKinds?.includes(action))) {
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
  };
}

function matchContextRule(
  rule: PolicyRule,
  preview: ImpactPreview,
  spec: Spec,
): RuleMatchResult | null {
  if (rule.match.pathGlobs || rule.match.commandPrefixes || rule.match.commandPatterns) {
    return null;
  }

  const matchedOn = matchesCommonRuleDimensions(rule, spec);

  if (!matchedOn) {
    return null;
  }

  if (rule.match.actionKinds) {
    if (!preview.actionKinds.some((action) => rule.match.actionKinds?.includes(action))) {
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
    summary: ruleSummary(rule, preview.summary),
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
  matches: RuleMatchResult[],
  fallbackDecision: PolicyDecision,
): PolicyDecisionReason[] {
  if (matches.length === 0) {
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

  return matches.map((match) => ({
    decision: match.decision,
    matchedOn: match.matchedOn,
    ruleId: match.rule.id,
    specificity: match.specificity,
    summary: match.summary,
  }));
}

export function evaluatePolicy(input: EvaluatePolicyInput): PolicyEvaluation {
  const pathCandidates: PathCandidateContext[] = input.impactPreview.proposedFileChanges.map(
    (fileChange) => ({
      actionKinds: classifyPathActions(fileChange.path),
      fileChange,
    }),
  );
  const commandCandidates: CommandCandidateContext[] = input.impactPreview.proposedCommands.map(
    (command) => ({
      actionKinds: classifyCommandActions(command.command),
      command,
    }),
  );
  const matches = dedupeMatchResults([
    ...pathCandidates.flatMap((candidate) =>
      input.policyPack.rules
        .map((rule) => matchPathRule(rule, candidate, input.spec))
        .filter((match): match is RuleMatchResult => match !== null),
    ),
    ...commandCandidates.flatMap((candidate) =>
      input.policyPack.rules
        .map((rule) => matchCommandRule(rule, candidate, input.spec))
        .filter((match): match is RuleMatchResult => match !== null),
    ),
    ...input.policyPack.rules
      .map((rule) => matchContextRule(rule, input.impactPreview, input.spec))
      .filter((match): match is RuleMatchResult => match !== null),
  ]);
  const winner = matches[0];
  const decision = winner?.decision ?? input.policyPack.defaults.fallbackDecision;
  const reasons = buildReasons(matches, input.policyPack.defaults.fallbackDecision);
  const notes = [...input.impactPreview.uncertaintyNotes];

  if (matches.length === 0) {
    notes.push(
      `Policy evaluation fell back to "${input.policyPack.defaults.fallbackDecision}" because no explicit rule matched the preview.`,
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
