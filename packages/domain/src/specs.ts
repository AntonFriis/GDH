import { basename } from 'node:path';
import {
  type GithubIssueRef,
  type Plan,
  PlanSchema,
  type RiskLevel,
  type Spec,
  SpecSchema,
  type TaskClass,
  TaskClassSchema,
  type TaskUnit,
} from './contracts.js';
import { createRunScopedId } from './ids.js';

export interface NormalizeMarkdownSpecInput {
  content: string;
  repoRoot: string;
  sourcePath: string;
  createdAt?: string;
}

export interface NormalizeGithubIssueSpecInput {
  issue: GithubIssueRef;
  repoRoot: string;
  sourcePath: string;
  createdAt?: string;
}

interface ParsedFrontmatter {
  body: string;
  data: Record<string, string | string[]>;
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

function inferTaskClassFromLabels(labels: string[]): TaskClass | undefined {
  for (const label of labels) {
    const normalized = normalizeKey(label);

    if (normalized === 'documentation' || normalized === 'docs') {
      return 'docs';
    }

    if (normalized === 'test' || normalized === 'tests') {
      return 'tests';
    }

    if (normalized === 'ci' || normalized === 'github_actions' || normalized === 'workflow') {
      return 'ci';
    }

    if (normalized === 'refactor') {
      return 'refactor';
    }

    if (normalized === 'release_notes' || normalized === 'release') {
      return 'release_notes';
    }

    if (normalized === 'triage') {
      return 'triage';
    }
  }

  return undefined;
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

export function normalizeGithubIssueSpec(input: NormalizeGithubIssueSpecInput): Spec {
  const timestamp = input.createdAt ?? new Date().toISOString();
  const body = input.issue.body?.trim() || input.issue.title;
  const sections = createSectionMap(body);
  const notes: string[] = [
    `Normalized from GitHub issue ${input.issue.repo.fullName}#${input.issue.issueNumber}.`,
  ];
  const inferredFields: string[] = [];
  const labels = input.issue.labels;
  const labelTaskClass = inferTaskClassFromLabels(labels);
  const title =
    input.issue.title.trim() || `${input.issue.repo.fullName}#${input.issue.issueNumber}`;
  const summary =
    pickFirstString(notes, inferredFields, 'summary', [
      sections.get('summary'),
      firstParagraph(body),
      title,
    ]) || title;
  const objective =
    pickFirstString(notes, inferredFields, 'objective', [
      sections.get('objective'),
      summary,
      title,
    ]) || title;
  const constraints = extractList(sections.get('constraints'));
  const acceptanceCriteria = extractList(sections.get('acceptance_criteria')).concat(
    extractList(sections.get('acceptance_criteria_and_done_conditions')),
  );
  const explicitRiskHints = extractList(sections.get('risk_hints'));
  const inferredRiskHints = inferRiskHints([title, body, ...labels].join('\n'));
  const riskHints = [...new Set([...explicitRiskHints, ...inferredRiskHints])];
  const taskClass =
    labelTaskClass ?? inferTaskClass([title, summary, objective, body, ...labels].join('\n'));

  if (!labelTaskClass) {
    inferredFields.push('taskClass');
    notes.push('taskClass was inferred from the issue title, body, and labels.');
  } else {
    notes.push(`taskClass was derived from the issue labels: ${labels.join(', ')}.`);
  }

  if (constraints.length === 0) {
    notes.push('constraints were not specified explicitly in the issue body.');
  }

  if (acceptanceCriteria.length === 0) {
    notes.push('acceptanceCriteria were not specified explicitly in the issue body.');
  }

  return SpecSchema.parse({
    id: createRunScopedId(
      'spec',
      `${input.issue.repo.fullName}#${input.issue.issueNumber}:${input.issue.title}:${body}`,
    ),
    source: 'github_issue',
    sourcePath: input.sourcePath,
    repoRoot: input.repoRoot,
    title,
    summary,
    objective,
    taskClass,
    constraints,
    acceptanceCriteria,
    riskHints,
    body,
    githubIssue: input.issue,
    normalizationNotes: notes,
    inferredFields,
    createdAt: timestamp,
  });
}

export function createPlanFromSpec(spec: Spec, generatedAt = new Date().toISOString()): Plan {
  const planId = createRunScopedId('plan', spec.id);
  const riskLevel = inferRiskLevel(spec.taskClass, spec.riskHints);
  const assumptions = [
    'The task stays within the current governed-run phase boundaries and avoids protected zones unless explicitly approved.',
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
        'Read the relevant repository instructions, current files, and constraints needed to complete the task without leaving the current governed-run scope.',
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
        'Run deterministic verification, then leave an evidence-based summary of what changed, what checks ran, and what remains unresolved.',
      dependsOn: [`${planId}-task-2`],
      riskLevel: 'low',
      suggestedMode: 'read_only',
      status: 'pending',
    },
  ];

  return PlanSchema.parse({
    id: planId,
    specId: spec.id,
    summary: `Execute the "${spec.title}" request as a bounded ${spec.taskClass} run, then capture verification evidence and an evidence-based review packet.`,
    taskUnits,
    doneConditions,
    assumptions,
    openQuestions,
    generatedAt,
  });
}
