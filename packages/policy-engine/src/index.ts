import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type ActionKind,
  type ApprovalMode,
  type ApprovalPacket,
  ApprovalPacketSchema,
  type ApprovalResolution,
  type ApprovalResolutionRecord,
  ApprovalResolutionRecordSchema,
  type ChangedFileCapture,
  type CommandCapture,
  type ImpactPreview,
  ImpactPreviewSchema,
  type Plan,
  type PolicyAuditResult,
  PolicyAuditResultSchema,
  type PolicyDecision,
  type PolicyDecisionReason,
  type PolicyEvaluation,
  PolicyEvaluationSchema,
  type PolicyMatchDimension,
  type PolicyPack,
  PolicyPackSchema,
  type PolicyRule,
  type ProposedCommand,
  type ProposedFileChange,
  type Spec,
} from '@gdh/domain';
import picomatch from 'picomatch';
import YAML from 'yaml';

export interface LoadedPolicyPack {
  pack: PolicyPack;
  path: string;
}

export interface ImpactPreviewInput {
  runId: string;
  spec: Spec;
  plan: Plan;
  sandboxMode: PolicyPack['defaults']['sandboxMode'];
  networkAccess: boolean;
  createdAt?: string;
}

export interface EvaluatePolicyInput {
  approvalMode: ApprovalMode;
  createdAt?: string;
  impactPreview: ImpactPreview;
  policyPack: PolicyPack;
  policyPackPath: string;
  spec: Spec;
}

export interface ApprovalPacketInput {
  artifactPaths: string[];
  createdAt?: string;
  impactPreview: ImpactPreview;
  policyDecision: PolicyEvaluation;
  runId: string;
  spec: Spec;
}

export interface CreateApprovalResolutionRecordInput {
  actor?: string;
  approvalPacketId: string;
  createdAt?: string;
  notes?: string[];
  resolution: ApprovalResolution;
  runId: string;
}

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

const defaultPathHintsByTaskClass: Record<Spec['taskClass'], string[]> = {
  ci: ['.github/workflows/**'],
  docs: ['README.md', 'docs/**', 'documentation.md', 'AGENTS.md', 'PLANS.md', 'implement.md'],
  other: ['**/*'],
  refactor: ['src/**'],
  release_notes: ['CHANGELOG.md', 'docs/**'],
  tests: ['tests/**', '**/*.test.ts', '**/*.spec.ts'],
  triage: ['docs/**', 'reports/**'],
};

const defaultCommandsByTaskClass: Record<
  Spec['taskClass'],
  Array<{ command: string; reason: string }>
> = {
  ci: [
    {
      command: 'pnpm lint',
      reason: 'CI-oriented work commonly validates the repo with lint.',
    },
    {
      command: 'pnpm typecheck',
      reason: 'CI-oriented work commonly validates the repo with typecheck.',
    },
  ],
  docs: [],
  other: [],
  refactor: [
    {
      command: 'pnpm typecheck',
      reason: 'Structured refactors commonly validate type safety before finishing.',
    },
  ],
  release_notes: [],
  tests: [
    {
      command: 'pnpm test',
      reason: 'Test-focused work commonly validates the changed suite locally.',
    },
  ],
  triage: [],
};

const commandLikePrefixes = [
  'pnpm ',
  'npm ',
  'yarn ',
  'node ',
  'npx ',
  'git ',
  'gh ',
  'bash ',
  'sh ',
  'curl ',
  'wget ',
  'python ',
  'python3 ',
  'tsx ',
  'vitest ',
];

function createStableId(prefix: string, seed: string): string {
  return `${prefix}-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeDecisionValue(value: unknown): PolicyDecision {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();

  if (normalized === 'allow') {
    return 'allow';
  }

  if (normalized === 'prompt' || normalized === 'require_approval') {
    return 'prompt';
  }

  if (normalized === 'forbid' || normalized === 'block') {
    return 'forbid';
  }

  throw new Error(`Unsupported policy decision "${String(value)}".`);
}

function normalizeActionKindValue(value: unknown): ActionKind {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();

  switch (normalized) {
    case 'read':
    case 'write':
    case 'command':
    case 'network':
    case 'git_remote':
    case 'config_change':
    case 'secrets_touch':
    case 'unknown':
      return normalized;
    case 'run_tests':
      return 'command';
    default:
      throw new Error(`Unsupported policy action "${String(value)}".`);
  }
}

function toOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.map((item) => String(item).trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function toOptionalActionKinds(value: unknown): ActionKind[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = unique(value.map((item) => normalizeActionKindValue(item)));
  return items.length > 0 ? items : undefined;
}

function normalizePolicyPackDocument(document: unknown): PolicyPack {
  const raw = (document ?? {}) as Record<string, unknown>;
  const defaults = (raw.defaults ?? {}) as Record<string, unknown>;
  const rawRules = Array.isArray(raw.rules) ? raw.rules : [];

  return PolicyPackSchema.parse({
    version: raw.version,
    name: raw.name,
    description: raw.description,
    defaults: {
      approvalPolicy: defaults.approval_policy ?? defaults.approvalPolicy ?? 'on-request',
      fallbackDecision: normalizeDecisionValue(
        defaults.fallback_decision ?? defaults.fallbackDecision ?? 'prompt',
      ),
      networkAccess: defaults.network_access ?? defaults.networkAccess ?? false,
      sandboxMode: defaults.sandbox_mode ?? defaults.sandboxMode ?? 'workspace-write',
    },
    rules: rawRules.map((ruleValue) => {
      const rule = (ruleValue ?? {}) as Record<string, unknown>;
      const match = (rule.match ?? {}) as Record<string, unknown>;

      return {
        decision: normalizeDecisionValue(rule.decision),
        description: rule.description,
        id: rule.id,
        match: {
          actionKinds: toOptionalActionKinds(
            match.actions ?? match.action_kinds ?? match.actionKinds,
          ),
          commandPatterns: toOptionalStringArray(match.command_patterns ?? match.commandPatterns),
          commandPrefixes: toOptionalStringArray(match.command_prefixes ?? match.commandPrefixes),
          pathGlobs: toOptionalStringArray(match.paths ?? match.path_globs ?? match.pathGlobs),
          riskHints: toOptionalStringArray(match.risk_hints ?? match.riskHints),
          taskClasses: toOptionalStringArray(match.task_classes ?? match.taskClasses) as
            | Spec['taskClass'][]
            | undefined,
        },
        reason: rule.reason,
      };
    }),
  });
}

export async function loadPolicyPackFromFile(filePath: string): Promise<LoadedPolicyPack> {
  const absolutePath = resolve(filePath);
  const source = await readFile(absolutePath, 'utf8');
  const document = YAML.parse(source);

  return {
    pack: normalizePolicyPackDocument(document),
    path: absolutePath,
  };
}

function extractBacktickedSnippets(text: string): string[] {
  const snippets: string[] = [];
  const pattern = /`([^`\n]+)`/g;

  for (const match of text.matchAll(pattern)) {
    const snippet = match[1]?.trim();

    if (snippet) {
      snippets.push(snippet);
    }
  }

  return unique(snippets);
}

function looksLikeCommandSnippet(snippet: string): boolean {
  const normalized = snippet.trim().toLowerCase();

  return commandLikePrefixes.some((prefix) => normalized.startsWith(prefix));
}

function looksLikePathSnippet(snippet: string): boolean {
  const normalized = snippet.trim();

  if (!normalized || looksLikeCommandSnippet(normalized) || /\s/.test(normalized)) {
    return false;
  }

  return (
    normalized.includes('/') || normalized.startsWith('.') || /\.[A-Za-z0-9_-]+$/.test(normalized)
  );
}

function collectSpecSnippets(spec: Spec, plan: Plan): string[] {
  return unique(
    extractBacktickedSnippets(
      [
        spec.title,
        spec.summary,
        spec.objective,
        spec.body,
        ...spec.constraints,
        ...spec.acceptanceCriteria,
        ...spec.riskHints,
        plan.summary,
      ].join('\n'),
    ),
  );
}

function classifyPathActions(path: string): ActionKind[] {
  const normalized = normalizePath(path).toLowerCase();
  const actions: ActionKind[] = ['read', 'write'];

  if (
    normalized === '.env' ||
    normalized.startsWith('.env.') ||
    normalized.endsWith('/.env') ||
    normalized.includes('/.env.') ||
    normalized.includes('secret') ||
    normalized.includes('credential')
  ) {
    actions.push('secrets_touch');
  }

  if (
    normalized.startsWith('.github/workflows/') ||
    normalized.endsWith('package.json') ||
    normalized.endsWith('pnpm-lock.yaml') ||
    normalized.endsWith('turbo.json') ||
    normalized.endsWith('biome.json') ||
    normalized.endsWith('.toml') ||
    normalized.endsWith('.yaml') ||
    normalized.endsWith('.yml') ||
    normalized.includes('/config/') ||
    normalized.includes('.config.')
  ) {
    actions.push('config_change');
  }

  return unique(actions);
}

function classifyCommandActions(command: string): ActionKind[] {
  const normalized = command.trim().toLowerCase();
  const actions: ActionKind[] = ['command'];

  if (
    normalized.startsWith('git push') ||
    normalized.startsWith('git pull') ||
    normalized.startsWith('git fetch') ||
    normalized.startsWith('git remote') ||
    normalized.startsWith('gh ')
  ) {
    actions.push('git_remote');
  }

  if (
    normalized.startsWith('curl ') ||
    normalized.startsWith('wget ') ||
    normalized.startsWith('git clone ') ||
    normalized.startsWith('npm install ') ||
    normalized.startsWith('pnpm add ') ||
    normalized.startsWith('pnpm dlx ') ||
    normalized.startsWith('npx ') ||
    normalized.startsWith('yarn add ')
  ) {
    actions.push('network');
  }

  return unique(actions);
}

function toPreviewFileChange(
  path: string,
  pathKind: ProposedFileChange['pathKind'],
): ProposedFileChange {
  const actions = classifyPathActions(path);

  return {
    actionKind: actions.includes('secrets_touch')
      ? 'secrets_touch'
      : actions.includes('config_change')
        ? 'config_change'
        : 'write',
    confidence: pathKind === 'file' ? 'high' : 'medium',
    path: normalizePath(path),
    pathKind,
    reason:
      pathKind === 'file'
        ? 'Explicit path extracted from the spec.'
        : 'Task-class heuristic path hint used because the spec did not name files directly.',
  };
}

function toPreviewCommand(
  command: string,
  source: ProposedCommand['source'],
  reason: string,
): ProposedCommand {
  const actions = classifyCommandActions(command);

  return {
    actionKind: actions.includes('git_remote')
      ? 'git_remote'
      : actions.includes('network')
        ? 'network'
        : 'command',
    command: command.trim(),
    confidence: source === 'spec_text' ? 'high' : source === 'observed' ? 'high' : 'medium',
    reason,
    source,
  };
}

export function generateImpactPreview(input: ImpactPreviewInput): ImpactPreview {
  const snippets = collectSpecSnippets(input.spec, input.plan);
  const explicitPaths = snippets
    .filter(looksLikePathSnippet)
    .map((snippet) => toPreviewFileChange(snippet, 'file'));
  const explicitCommands = snippets
    .filter(looksLikeCommandSnippet)
    .map((snippet) =>
      toPreviewCommand(snippet, 'spec_text', 'Explicit command extracted from the spec.'),
    );
  const fallbackPaths =
    explicitPaths.length > 0
      ? []
      : defaultPathHintsByTaskClass[input.spec.taskClass].map((path) =>
          toPreviewFileChange(path, 'glob'),
        );
  const fallbackCommands =
    explicitCommands.length > 0
      ? []
      : defaultCommandsByTaskClass[input.spec.taskClass].map((entry) =>
          toPreviewCommand(entry.command, 'heuristic', entry.reason),
        );
  const proposedFileChanges = unique(
    [...explicitPaths, ...fallbackPaths].map((fileChange) => JSON.stringify(fileChange)),
  ).map((value) => JSON.parse(value) as ProposedFileChange);
  const proposedCommands = unique(
    [...explicitCommands, ...fallbackCommands].map((command) => JSON.stringify(command)),
  ).map((value) => JSON.parse(value) as ProposedCommand);
  const actionKinds = unique([
    'read',
    ...proposedFileChanges.flatMap((fileChange) => classifyPathActions(fileChange.path)),
    ...proposedCommands.flatMap((command) => classifyCommandActions(command.command)),
  ]);
  const uncertaintyNotes: string[] = [];

  if (explicitPaths.length === 0) {
    uncertaintyNotes.push(
      'No explicit file paths were found in the spec, so task-class path heuristics were used.',
    );
  }

  if (explicitCommands.length === 0 && fallbackCommands.length === 0) {
    uncertaintyNotes.push(
      'No explicit commands were found in the spec, and no task-class command heuristic was required.',
    );
  }

  const requestedNetworkAccess =
    input.networkAccess ||
    proposedCommands.some((command) => classifyCommandActions(command.command).includes('network'));

  return ImpactPreviewSchema.parse({
    actionKinds,
    createdAt: input.createdAt ?? new Date().toISOString(),
    id: createStableId('impact', `${input.runId}:${input.spec.id}:${input.plan.id}`),
    planId: input.plan.id,
    proposedCommands,
    proposedFileChanges,
    rationale: [
      'The impact preview is derived from the normalized spec and deterministic task-class heuristics.',
      'This preview is predictive only; post-run policy audit is the evidence-backed check against actual changes.',
    ],
    requestedNetworkAccess,
    requestedSandboxMode: proposedFileChanges.length > 0 ? 'workspace-write' : 'read-only',
    riskHints: input.spec.riskHints,
    runId: input.runId,
    specId: input.spec.id,
    summary: `Impact preview predicts ${proposedFileChanges.length} file target(s) and ${proposedCommands.length} command(s).`,
    taskClass: input.spec.taskClass,
    uncertaintyNotes,
  });
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

export function createApprovalPacket(input: ApprovalPacketInput): ApprovalPacket {
  return ApprovalPacketSchema.parse({
    affectedPaths: input.policyDecision.affectedPaths,
    artifactPaths: input.artifactPaths,
    assumptions: input.impactPreview.uncertaintyNotes,
    createdAt: input.createdAt ?? new Date().toISOString(),
    decisionSummary: `Policy pack "${input.policyDecision.policyPackName}" requires human approval before write-capable execution can continue.`,
    id: createStableId(
      'approval',
      `${input.runId}:${input.spec.id}:${input.policyDecision.policyPackName}:${input.policyDecision.decision}`,
    ),
    matchedRules: input.policyDecision.matchedRules,
    mitigationNotes: [
      'If denied, the run stops before the write-capable runner executes.',
      `If approved, the run continues with sandbox "${input.policyDecision.sandboxMode}" and network ${input.policyDecision.networkAccess ? 'enabled' : 'disabled'}.`,
    ],
    policyDecision: input.policyDecision.decision,
    predictedCommands: input.policyDecision.matchedCommands,
    resolution: undefined,
    riskSummary: unique([
      ...input.spec.riskHints,
      ...input.policyDecision.reasons.map((reason) => reason.summary),
    ]),
    runId: input.runId,
    specTitle: input.spec.title,
    whyApprovalIsRequired: input.policyDecision.reasons.map((reason) => reason.summary),
  });
}

function renderBulletList(items: string[], fallback: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : `- ${fallback}`;
}

export function renderApprovalPacketMarkdown(packet: ApprovalPacket): string {
  return [
    `# Approval Packet: ${packet.specTitle}`,
    '',
    `- Approval ID: ${packet.id}`,
    `- Run ID: ${packet.runId}`,
    `- Policy decision: ${packet.policyDecision}`,
    `- Summary: ${packet.decisionSummary}`,
    '',
    '## Why Approval Is Required',
    renderBulletList(packet.whyApprovalIsRequired, 'No explicit reasons were recorded.'),
    '',
    '## Affected Paths',
    renderBulletList(packet.affectedPaths, 'No affected paths were predicted.'),
    '',
    '## Predicted Commands',
    renderBulletList(packet.predictedCommands, 'No commands were predicted.'),
    '',
    '## Matched Policy Rules',
    renderBulletList(
      packet.matchedRules.map((rule) => {
        const dimensions = rule.matchedOn.join(', ') || 'fallback';
        const reason = rule.reason ? ` — ${rule.reason}` : '';
        return `${rule.ruleId} [${rule.decision}] via ${dimensions}${reason}`;
      }),
      'No explicit policy rules were matched.',
    ),
    '',
    '## Risk Summary',
    renderBulletList(packet.riskSummary, 'No additional risk summary was recorded.'),
    '',
    '## Assumptions / Uncertainty',
    renderBulletList(packet.assumptions, 'No explicit uncertainty notes were recorded.'),
    '',
    '## Recommendation / Mitigations',
    renderBulletList(packet.mitigationNotes, 'No mitigation guidance was recorded.'),
    '',
    '## Artifact References',
    renderBulletList(packet.artifactPaths, 'No artifact references were recorded.'),
  ].join('\n');
}

export function createApprovalResolutionRecord(
  input: CreateApprovalResolutionRecordInput,
): ApprovalResolutionRecord {
  return ApprovalResolutionRecordSchema.parse({
    actor: input.actor ?? 'interactive-cli',
    approvalPacketId: input.approvalPacketId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    id: createStableId(
      'approval-resolution',
      `${input.runId}:${input.approvalPacketId}:${input.resolution}`,
    ),
    notes: input.notes ?? [],
    resolution: input.resolution,
    runId: input.runId,
  });
}

function previewCoversPath(path: string, preview: ImpactPreview): boolean {
  return preview.proposedFileChanges.some((fileChange) =>
    fileChange.pathKind === 'file'
      ? normalizePath(fileChange.path) === normalizePath(path)
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
