import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { z } from 'zod';

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
  'awaiting_approval',
  'verifying',
  'completed',
  'failed',
  'cancelled',
] as const;
export const runnerValues = ['codex-cli', 'codex-sdk', 'fake'] as const;
export const sandboxModeValues = ['read-only', 'workspace-write'] as const;
export const approvalPolicyValues = ['untrusted', 'on-request', 'never'] as const;
export const specSourceValues = ['markdown', 'github_issue', 'release_note', 'manual'] as const;
export const runEventTypeValues = [
  'run.created',
  'spec.normalized',
  'plan.created',
  'runner.started',
  'runner.completed',
  'runner.failed',
  'diff.captured',
  'review_packet.generated',
  'run.completed',
  'run.failed',
] as const;
export const commandProvenanceValues = ['observed', 'parsed', 'self_reported'] as const;
export const captureCompletenessValues = ['complete', 'partial', 'unknown'] as const;
export const changedFileStatusValues = ['added', 'modified', 'deleted'] as const;
export const verificationStatusValues = ['not_run', 'partial', 'passed', 'failed'] as const;
export const verificationCheckStatusValues = ['passed', 'failed', 'not_run'] as const;

export const TaskClassSchema = z.enum(taskClassValues);
export const RiskLevelSchema = z.enum(riskLevelValues);
export const TaskModeSchema = z.enum(taskModeValues);
export const TaskStatusSchema = z.enum(taskStatusValues);
export const RunStatusSchema = z.enum(runStatusValues);
export const RunnerSchema = z.enum(runnerValues);
export const SandboxModeSchema = z.enum(sandboxModeValues);
export const ApprovalPolicySchema = z.enum(approvalPolicyValues);
export const SpecSourceSchema = z.enum(specSourceValues);
export const RunEventTypeSchema = z.enum(runEventTypeValues);
export const CommandProvenanceSchema = z.enum(commandProvenanceValues);
export const CaptureCompletenessSchema = z.enum(captureCompletenessValues);
export const ChangedFileStatusSchema = z.enum(changedFileStatusValues);
export const VerificationStatusSchema = z.enum(verificationStatusValues);
export const VerificationCheckStatusSchema = z.enum(verificationCheckStatusValues);

export const ArtifactReferenceSchema = z.object({
  id: z.string(),
  runId: z.string(),
  kind: z.string(),
  path: z.string(),
  format: z.enum(['json', 'jsonl', 'markdown', 'text', 'patch']),
  createdAt: z.string(),
  summary: z.string().optional(),
});

export const SpecSchema = z.object({
  id: z.string(),
  source: SpecSourceSchema,
  sourcePath: z.string(),
  repoRoot: z.string(),
  title: z.string(),
  summary: z.string(),
  objective: z.string(),
  taskClass: TaskClassSchema,
  constraints: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  riskHints: z.array(z.string()),
  body: z.string(),
  normalizationNotes: z.array(z.string()),
  inferredFields: z.array(z.string()),
  createdAt: z.string(),
});

export const TaskUnitSchema = z.object({
  id: z.string(),
  planId: z.string(),
  order: z.number().int().nonnegative(),
  title: z.string(),
  description: z.string(),
  dependsOn: z.array(z.string()),
  riskLevel: RiskLevelSchema,
  suggestedMode: TaskModeSchema,
  status: TaskStatusSchema,
});

export const PlanSchema = z.object({
  id: z.string(),
  specId: z.string(),
  summary: z.string(),
  taskUnits: z.array(TaskUnitSchema),
  doneConditions: z.array(z.string()),
  assumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  generatedAt: z.string(),
});

export const RunSchema = z.object({
  id: z.string(),
  specId: z.string(),
  planId: z.string(),
  status: RunStatusSchema,
  runner: RunnerSchema,
  model: z.string(),
  sandboxMode: SandboxModeSchema,
  approvalPolicy: ApprovalPolicySchema,
  repoRoot: z.string(),
  runDirectory: z.string(),
  sourceSpecPath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  summary: z.string().optional(),
});

export const RunEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  timestamp: z.string(),
  type: RunEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
});

export const ExecutedCommandSchema = z.object({
  command: z.string(),
  provenance: CommandProvenanceSchema,
  isPartial: z.boolean(),
  notes: z.string().optional(),
});

export const CommandCaptureSchema = z.object({
  source: z.string(),
  completeness: CaptureCompletenessSchema,
  notes: z.array(z.string()),
  commands: z.array(ExecutedCommandSchema),
});

export const ChangedFileRecordSchema = z.object({
  path: z.string(),
  status: ChangedFileStatusSchema,
  beforeHash: z.string().nullable(),
  afterHash: z.string().nullable(),
});

export const ChangedFileCaptureSchema = z.object({
  source: z.enum(['workspace_snapshot', 'git_diff']),
  notes: z.array(z.string()),
  files: z.array(ChangedFileRecordSchema),
});

export const VerificationCheckSchema = z.object({
  name: z.string(),
  status: VerificationCheckStatusSchema,
  details: z.string().optional(),
});

export const VerificationResultSchema = z.object({
  id: z.string(),
  runId: z.string(),
  status: VerificationStatusSchema,
  summary: z.string(),
  commands: z.array(z.string()),
  checks: z.array(VerificationCheckSchema),
  createdAt: z.string(),
});

export const RunnerContextSchema = z.object({
  repoRoot: z.string(),
  runDirectory: z.string(),
  spec: SpecSchema,
  plan: PlanSchema,
  run: RunSchema,
  verificationRequirements: z.array(z.string()),
  priorArtifacts: z.array(ArtifactReferenceSchema),
  policy: z.object({
    ruleId: z.string(),
    decision: z.enum(['allow', 'require_approval', 'block']),
    reason: z.string(),
    sandboxMode: SandboxModeSchema,
    approvalPolicy: ApprovalPolicySchema,
    networkAccess: z.boolean(),
  }),
});

export const RunnerResultSchema = z.object({
  status: z.enum(['completed', 'blocked', 'failed']),
  summary: z.string(),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  prompt: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  commandCapture: CommandCaptureSchema,
  reportedChangedFiles: z.array(z.string()),
  reportedChangedFilesCompleteness: CaptureCompletenessSchema,
  reportedChangedFilesNotes: z.array(z.string()),
  limitations: z.array(z.string()),
  artifactsProduced: z.array(ArtifactReferenceSchema),
  metadata: z.record(z.string(), z.unknown()),
});

export const ReviewPacketSchema = z.object({
  id: z.string(),
  runId: z.string(),
  title: z.string(),
  specTitle: z.string(),
  status: z.enum(['completed', 'blocked', 'failed']),
  planSummary: z.string(),
  runnerSummary: z.string(),
  changedFiles: z.array(z.string()),
  commandsExecuted: z.array(ExecutedCommandSchema),
  artifactPaths: z.array(z.string()),
  diffSummary: z.array(z.string()),
  limitations: z.array(z.string()),
  openQuestions: z.array(z.string()),
  verificationStatus: VerificationStatusSchema,
  createdAt: z.string(),
});

export type TaskClass = z.infer<typeof TaskClassSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type TaskMode = z.infer<typeof TaskModeSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunnerKind = z.infer<typeof RunnerSchema>;
export type SandboxMode = z.infer<typeof SandboxModeSchema>;
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;
export type SpecSource = z.infer<typeof SpecSourceSchema>;
export type RunEventType = z.infer<typeof RunEventTypeSchema>;
export type CommandProvenance = z.infer<typeof CommandProvenanceSchema>;
export type CaptureCompleteness = z.infer<typeof CaptureCompletenessSchema>;
export type ChangedFileStatus = z.infer<typeof ChangedFileStatusSchema>;
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;
export type VerificationCheckStatus = z.infer<typeof VerificationCheckStatusSchema>;
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;
export type Spec = z.infer<typeof SpecSchema>;
export type TaskUnit = z.infer<typeof TaskUnitSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Run = z.infer<typeof RunSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
export type ExecutedCommand = z.infer<typeof ExecutedCommandSchema>;
export type CommandCapture = z.infer<typeof CommandCaptureSchema>;
export type ChangedFileRecord = z.infer<typeof ChangedFileRecordSchema>;
export type ChangedFileCapture = z.infer<typeof ChangedFileCaptureSchema>;
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type RunnerContext = z.infer<typeof RunnerContextSchema>;
export type RunnerResult = z.infer<typeof RunnerResultSchema>;
export type ReviewPacket = z.infer<typeof ReviewPacketSchema>;

export interface NormalizeMarkdownSpecInput {
  content: string;
  repoRoot: string;
  sourcePath: string;
  createdAt?: string;
}

export interface CreateRunInput {
  runId?: string;
  spec: Spec;
  plan: Plan;
  runner: RunnerKind;
  model: string;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  repoRoot: string;
  runDirectory: string;
  createdAt?: string;
}

interface ParsedFrontmatter {
  body: string;
  data: Record<string, string | string[]>;
}

function createContentHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function createRunScopedId(prefix: string, seed: string): string {
  return `${prefix}-${createContentHash(seed).slice(0, 12)}`;
}

function createSectionMap(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = markdown.split(/\r?\n/);
  let currentHeading = '';
  let currentLines: string[] = [];

  const flush = (): void => {
    if (!currentHeading) {
      return;
    }

    sections.set(currentHeading, currentLines.join('\n').trim());
  };

  for (const line of lines) {
    const headingMatch = /^##\s+(.+)$/.exec(line.trim());

    if (headingMatch) {
      const heading = headingMatch[1];

      if (!heading) {
        continue;
      }

      flush();
      currentHeading = normalizeKey(heading);
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  flush();
  return sections;
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseInlineArray(value: string): string[] {
  return value
    .slice(1, -1)
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function parseFrontmatter(markdown: string): ParsedFrontmatter {
  if (!markdown.startsWith('---\n')) {
    return { body: markdown, data: {} };
  }

  const lines = markdown.split(/\r?\n/);
  let closingIndex = -1;

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex === -1) {
    return { body: markdown, data: {} };
  }

  const data: Record<string, string | string[]> = {};
  const frontmatterLines = lines.slice(1, closingIndex);

  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const line = frontmatterLines[index]?.trim();

    if (!line) {
      continue;
    }

    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);

    if (!match) {
      continue;
    }

    const rawKey = match[1];
    const rawValue = match[2];

    if (!rawKey || rawValue === undefined) {
      continue;
    }

    const key = normalizeKey(rawKey);
    const value = rawValue.trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = parseInlineArray(value);
      continue;
    }

    if (value) {
      data[key] = value.replace(/^['"]|['"]$/g, '');
      continue;
    }

    const items: string[] = [];
    let nextIndex = index + 1;

    while (nextIndex < frontmatterLines.length) {
      const candidate = frontmatterLines[nextIndex];

      if (!candidate?.trim()) {
        nextIndex += 1;
        continue;
      }

      if (/^[A-Za-z0-9_-]+:\s*/.test(candidate)) {
        break;
      }

      const itemMatch = /^\s*-\s+(.*)$/.exec(candidate);

      if (!itemMatch) {
        break;
      }

      const itemValue = itemMatch[1];

      if (!itemValue) {
        break;
      }

      items.push(itemValue.trim());
      nextIndex += 1;
    }

    if (items.length > 0) {
      data[key] = items;
      index = nextIndex - 1;
    }
  }

  return {
    body: lines
      .slice(closingIndex + 1)
      .join('\n')
      .trim(),
    data,
  };
}

function firstHeading(markdown: string): string | undefined {
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^#\s+(.+)$/.exec(line.trim());

    if (match) {
      const heading = match[1];

      if (heading) {
        return heading.trim();
      }
    }
  }

  return undefined;
}

function firstParagraph(markdown: string): string | undefined {
  const paragraphs = markdown
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !paragraph.startsWith('#') && !paragraph.startsWith('- '));

  return paragraphs[0];
}

function toStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^[-*]\s+/, ''))
      .filter(Boolean);
  }

  return [];
}

function extractList(section: string | undefined): string[] {
  if (!section) {
    return [];
  }

  const bulletItems = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);

  if (bulletItems.length > 0) {
    return bulletItems;
  }

  return section
    .split(/\n{2,}/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function inferTaskClass(text: string): TaskClass {
  const normalized = text.toLowerCase();

  if (/\b(doc|docs|documentation|readme|guide|markdown)\b/.test(normalized)) {
    return 'docs';
  }

  if (/\b(test|tests|vitest|playwright|coverage)\b/.test(normalized)) {
    return 'tests';
  }

  if (/\b(ci|workflow|github actions|pipeline)\b/.test(normalized)) {
    return 'ci';
  }

  if (/\b(refactor|rename|cleanup|restructure)\b/.test(normalized)) {
    return 'refactor';
  }

  if (/\b(release|changelog|release notes)\b/.test(normalized)) {
    return 'release_notes';
  }

  if (/\b(triage|label|issue hygiene)\b/.test(normalized)) {
    return 'triage';
  }

  return 'other';
}

function inferRiskHints(text: string): string[] {
  const hints = new Set<string>();
  const normalized = text.toLowerCase();

  if (/\bauth|permission|billing|migration|secret|credential\b/.test(normalized)) {
    hints.add('Touches a protected area and should stay out of scope for Phase 1.');
  }

  if (/\bnetwork|internet|fetch|external\b/.test(normalized)) {
    hints.add('May imply network access, which is disabled by default.');
  }

  return [...hints];
}

function inferRiskLevel(taskClass: TaskClass, riskHints: string[]): RiskLevel {
  if (riskHints.length > 0 || taskClass === 'other') {
    return 'medium';
  }

  return 'low';
}

function pickFirstString(
  notes: string[],
  inferredFields: string[],
  field: string,
  candidates: Array<string | undefined>,
): string {
  for (const candidate of candidates) {
    if (candidate?.trim()) {
      return candidate.trim();
    }
  }

  inferredFields.push(field);
  notes.push(`${field} was inferred from the available markdown content.`);
  return '';
}

export function normalizeMarkdownSpec(input: NormalizeMarkdownSpecInput): Spec {
  const timestamp = input.createdAt ?? new Date().toISOString();
  const { body, data } = parseFrontmatter(input.content);
  const sections = createSectionMap(body);
  const notes: string[] = [];
  const inferredFields: string[] = [];
  const fileStem = basename(input.sourcePath).replace(/\.[^.]+$/, '');

  const title =
    pickFirstString(notes, inferredFields, 'title', [
      typeof data.title === 'string' ? data.title : undefined,
      firstHeading(body),
      fileStem,
    ]) || fileStem;
  const objective =
    pickFirstString(notes, inferredFields, 'objective', [
      typeof data.objective === 'string' ? data.objective : undefined,
      sections.get('objective'),
      typeof data.summary === 'string' ? data.summary : undefined,
      firstParagraph(body),
      title,
    ]) || title;
  const summary =
    pickFirstString(notes, inferredFields, 'summary', [
      typeof data.summary === 'string' ? data.summary : undefined,
      sections.get('summary'),
      firstParagraph(body),
      objective,
    ]) || objective;
  const constraints =
    toStringArray(data.constraints)
      .concat(extractList(sections.get('constraints')))
      .filter(Boolean) || [];
  const acceptanceCriteria =
    toStringArray(data.acceptance_criteria ?? data.acceptancecriteria)
      .concat(extractList(sections.get('acceptance_criteria')))
      .concat(extractList(sections.get('acceptance_criteria_and_done_conditions')))
      .filter(Boolean) || [];
  const riskHints =
    toStringArray(data.risk_hints ?? data.riskhints)
      .concat(extractList(sections.get('risk_hints')))
      .filter(Boolean) || [];
  const taskClassInput =
    (typeof data.task_type === 'string' ? data.task_type : undefined) ??
    (typeof data.taskclass === 'string' ? data.taskclass : undefined) ??
    sections.get('task_type') ??
    sections.get('task_class');
  const taskClass = TaskClassSchema.safeParse(normalizeKey(taskClassInput ?? '')).success
    ? (normalizeKey(taskClassInput ?? '') as TaskClass)
    : inferTaskClass([title, summary, objective, body].join('\n'));

  if (!taskClassInput) {
    inferredFields.push('taskClass');
    notes.push('taskClass was inferred from the markdown content.');
  }

  const combinedRiskHints = [...new Set([...riskHints, ...inferRiskHints(body)])];

  if (constraints.length === 0) {
    notes.push('constraints were not specified explicitly.');
  }

  if (acceptanceCriteria.length === 0) {
    notes.push('acceptanceCriteria were not specified explicitly.');
  }

  const spec: Spec = {
    id:
      typeof data.id === 'string' && data.id.trim()
        ? data.id.trim()
        : createRunScopedId('spec', `${input.sourcePath}:${input.content}`),
    source: 'markdown',
    sourcePath: input.sourcePath,
    repoRoot: input.repoRoot,
    title,
    summary,
    objective,
    taskClass,
    constraints,
    acceptanceCriteria,
    riskHints: combinedRiskHints,
    body,
    normalizationNotes: notes,
    inferredFields,
    createdAt: timestamp,
  };

  return SpecSchema.parse(spec);
}

export function createPlanFromSpec(spec: Spec, generatedAt = new Date().toISOString()): Plan {
  const planId = createRunScopedId('plan', spec.id);
  const riskLevel = inferRiskLevel(spec.taskClass, spec.riskHints);
  const assumptions = [
    'The task stays within Phase 1 boundaries and avoids protected zones.',
    'The runner should prefer minimal diffs and artifact-backed evidence over broad claims.',
    'Network access remains disabled unless a future phase explicitly enables it.',
  ];
  const openQuestions =
    spec.acceptanceCriteria.length > 0
      ? []
      : [
          'Acceptance criteria were not explicit in the source spec and may need human clarification.',
        ];
  const doneConditions =
    spec.acceptanceCriteria.length > 0
      ? spec.acceptanceCriteria
      : [`Address the objective: ${spec.objective}`];
  const taskUnits: TaskUnit[] = [
    {
      id: `${planId}-task-1`,
      planId,
      order: 1,
      title: 'Inspect local repo context',
      description:
        'Read the relevant repository instructions, current files, and constraints needed to complete the task without leaving Phase 1 scope.',
      dependsOn: [],
      riskLevel: 'low',
      suggestedMode: 'read_only',
      status: 'pending',
    },
    {
      id: `${planId}-task-2`,
      planId,
      order: 2,
      title: 'Apply the requested low-risk change',
      description: spec.objective,
      dependsOn: [`${planId}-task-1`],
      riskLevel,
      suggestedMode: 'workspace_write',
      status: 'pending',
    },
    {
      id: `${planId}-task-3`,
      planId,
      order: 3,
      title: 'Capture run evidence and summarize outcomes',
      description:
        'Leave a conservative summary of what changed, what commands ran, and what remains unresolved.',
      dependsOn: [`${planId}-task-2`],
      riskLevel: 'low',
      suggestedMode: 'read_only',
      status: 'pending',
    },
  ];

  return PlanSchema.parse({
    id: planId,
    specId: spec.id,
    summary: `Execute the "${spec.title}" request as a bounded ${spec.taskClass} run, then capture evidence and a review packet.`,
    taskUnits,
    doneConditions,
    assumptions,
    openQuestions,
    generatedAt,
  });
}

export function createRunRecord(input: CreateRunInput): Run {
  const timestamp = input.createdAt ?? new Date().toISOString();

  return RunSchema.parse({
    id:
      input.runId ??
      createRunScopedId(
        'run',
        `${input.spec.id}:${input.runner}:${timestamp}:${input.spec.sourcePath}`,
      ),
    specId: input.spec.id,
    planId: input.plan.id,
    status: 'created',
    runner: input.runner,
    model: input.model,
    sandboxMode: input.sandboxMode,
    approvalPolicy: input.approvalPolicy,
    repoRoot: input.repoRoot,
    runDirectory: input.runDirectory,
    sourceSpecPath: input.spec.sourcePath,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function updateRunStatus(
  run: Run,
  status: RunStatus,
  summary?: string,
  updatedAt = new Date().toISOString(),
): Run {
  return RunSchema.parse({
    ...run,
    status,
    summary: summary ?? run.summary,
    updatedAt,
  });
}

export function createRunEvent(
  runId: string,
  type: RunEventType,
  payload: Record<string, unknown>,
  timestamp = new Date().toISOString(),
): RunEvent {
  return RunEventSchema.parse({
    id: createRunScopedId('evt', `${runId}:${type}:${timestamp}:${JSON.stringify(payload)}`),
    runId,
    timestamp,
    type,
    payload,
  });
}

export function createArtifactReference(
  runId: string,
  kind: string,
  path: string,
  format: ArtifactReference['format'],
  createdAt = new Date().toISOString(),
  summary?: string,
): ArtifactReference {
  return ArtifactReferenceSchema.parse({
    id: createRunScopedId('artifact', `${runId}:${kind}:${path}`),
    runId,
    kind,
    path,
    format,
    createdAt,
    summary,
  });
}
