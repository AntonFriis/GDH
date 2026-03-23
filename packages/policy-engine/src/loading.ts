import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ActionKind, PolicyDecision, PolicyPack, Spec } from '@gdh/domain';
import { PolicyPackSchema } from '@gdh/domain';
import YAML from 'yaml';
import { unique } from './shared.js';

export interface LoadedPolicyPack {
  pack: PolicyPack;
  path: string;
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
