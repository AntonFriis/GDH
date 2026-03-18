import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  type ApprovalPolicy,
  type CommandCapture,
  CommandCaptureSchema,
  type ExecutedCommand,
  type RunnerContext,
  type RunnerKind,
  type RunnerResult,
  RunnerResultSchema,
  type SandboxMode,
} from '@gdh/domain';
import { createIsoTimestamp, hasUnsupportedCertaintyClaim } from '@gdh/shared';

export interface Runner {
  readonly kind: RunnerKind;
  execute(context: RunnerContext): Promise<RunnerResult>;
  resume?(runId: string): Promise<RunnerResult>;
}

export interface RunnerDefaults {
  model: string;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  networkAccess: boolean;
}

export interface CodexCliRunnerOptions {
  binaryPath?: string;
}

interface CodexFinalResponse {
  status?: 'completed' | 'blocked' | 'failed';
  summary?: string;
  commandsExecuted?: Array<{ command?: string; isPartial?: boolean; notes?: string }>;
  commandsExecutedCompleteness?: 'complete' | 'partial' | 'unknown';
  reportedChangedFiles?: string[];
  reportedChangedFilesCompleteness?: 'complete' | 'partial' | 'unknown';
  limitations?: string[];
  notes?: string[];
  metadata?: Record<string, unknown>;
}

const runnerOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'status',
    'summary',
    'commandsExecuted',
    'commandsExecutedCompleteness',
    'reportedChangedFiles',
    'reportedChangedFilesCompleteness',
    'limitations',
    'notes',
    'metadata',
  ],
  properties: {
    status: { type: 'string', enum: ['completed', 'blocked', 'failed'] },
    summary: { type: 'string' },
    commandsExecuted: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'isPartial'],
        properties: {
          command: { type: 'string' },
          isPartial: { type: 'boolean' },
          notes: { type: 'string' },
        },
      },
    },
    commandsExecutedCompleteness: {
      type: 'string',
      enum: ['complete', 'partial', 'unknown'],
    },
    reportedChangedFiles: {
      type: 'array',
      items: { type: 'string' },
    },
    reportedChangedFilesCompleteness: {
      type: 'string',
      enum: ['complete', 'partial', 'unknown'],
    },
    limitations: {
      type: 'array',
      items: { type: 'string' },
    },
    notes: {
      type: 'array',
      items: { type: 'string' },
    },
    metadata: {
      type: 'object',
      additionalProperties: true,
    },
  },
} as const;

export const defaultRunnerDefaults: RunnerDefaults = {
  model: 'gpt-5.4',
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  networkAccess: false,
};

function createCommandCapture(
  commands: ExecutedCommand[],
  completeness: CommandCapture['completeness'],
  source: string,
  notes: string[],
): CommandCapture {
  return CommandCaptureSchema.parse({
    source,
    completeness,
    notes,
    commands,
  });
}

function toPromptList(items: string[]): string {
  return items.length === 0 ? '- none' : items.map((item) => `- ${item}`).join('\n');
}

function createRunnerPrompt(context: RunnerContext): string {
  const taskUnitBlock = context.plan.taskUnits
    .map(
      (taskUnit) =>
        `- [${taskUnit.order}] ${taskUnit.title}: ${taskUnit.description} (mode=${taskUnit.suggestedMode}, risk=${taskUnit.riskLevel})`,
    )
    .join('\n');

  return [
    '# Governed Delivery Run',
    '',
    'You are operating inside the governed delivery control plane for this repository.',
    'Read the repository instructions that already exist before making changes:',
    '- codex_governed_delivery_handoff_spec.md',
    '- AGENTS.md',
    '- PLANS.md',
    '- implement.md',
    '- documentation.md',
    '- README.md',
    '',
    'Strict limits for this run:',
    '- Stay inside the currently approved governed-run scope only.',
    '- Do not bypass the tool-managed policy gate, approval flow, or protected-surface restrictions.',
    '- Do not implement GitHub side effects, draft PR creation, benchmark automation, dashboard work, or multi-agent orchestration.',
    '- Keep changes low-risk, minimal, and local to the approved task scope.',
    '- Keep network access disabled unless the policy context explicitly says otherwise.',
    '- Do not claim verification that you did not run.',
    '',
    'Normalized spec:',
    `- Title: ${context.spec.title}`,
    `- Summary: ${context.spec.summary}`,
    `- Objective: ${context.spec.objective}`,
    `- Task class: ${context.spec.taskClass}`,
    `- Source path: ${context.spec.sourcePath}`,
    'Constraints:',
    toPromptList(context.spec.constraints),
    'Acceptance criteria:',
    toPromptList(context.spec.acceptanceCriteria),
    'Risk hints:',
    toPromptList(context.spec.riskHints),
    '',
    'Plan summary:',
    context.plan.summary,
    '',
    'Ordered task units:',
    taskUnitBlock,
    '',
    'Done conditions:',
    toPromptList(context.plan.doneConditions),
    'Open questions:',
    toPromptList(context.plan.openQuestions),
    '',
    'Impact preview:',
    `- Summary: ${context.impactPreview.summary}`,
    `- Requested sandbox: ${context.impactPreview.requestedSandboxMode}`,
    `- Requested network access: ${context.impactPreview.requestedNetworkAccess ? 'enabled' : 'disabled'}`,
    'Predicted file targets:',
    toPromptList(context.impactPreview.proposedFileChanges.map((fileChange) => fileChange.path)),
    'Predicted commands:',
    toPromptList(context.impactPreview.proposedCommands.map((command) => command.command)),
    'Preview uncertainty:',
    toPromptList(context.impactPreview.uncertaintyNotes),
    '',
    'Policy context:',
    `- Decision: ${context.policyDecision.decision}`,
    `- Top reason: ${context.policyDecision.reasons[0]?.summary ?? 'No reason recorded.'}`,
    `- Sandbox: ${context.policyDecision.sandboxMode}`,
    `- Approval policy: ${context.policyDecision.approvalPolicy}`,
    `- Network access: ${context.policyDecision.networkAccess ? 'enabled' : 'disabled'}`,
    `- Approval mode: ${context.policyDecision.requiredApprovalMode ?? 'not_required'}`,
    'Matched policy rules:',
    toPromptList(
      context.policyDecision.matchedRules.map((rule) => `${rule.ruleId} [${rule.decision}]`),
    ),
    '',
    'Approval packet context:',
    toPromptList(
      context.approvalPacket
        ? [
            `Approval ID: ${context.approvalPacket.id}`,
            `Decision summary: ${context.approvalPacket.decisionSummary}`,
          ]
        : [],
    ),
    '',
    'Final response requirements:',
    '- Return JSON only and match the provided output schema exactly.',
    '- In `commandsExecuted`, include only commands you actually executed. If the list may be incomplete, set `commandsExecutedCompleteness` to `partial` or `unknown`.',
    '- Treat command reporting as self-reported; do not imply direct observability.',
    '- `reportedChangedFiles` may omit files if you are uncertain.',
    '- Put any caveats, partial evidence, or unresolved issues in `limitations` and `notes`.',
  ].join('\n');
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function parseFinalResponse(rawValue: string | undefined): CodexFinalResponse | undefined {
  if (!rawValue?.trim()) {
    return undefined;
  }

  const trimmed = rawValue.trim();

  try {
    return JSON.parse(trimmed) as CodexFinalResponse;
  } catch {
    const startIndex = trimmed.indexOf('{');
    const endIndex = trimmed.lastIndexOf('}');

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      try {
        return JSON.parse(trimmed.slice(startIndex, endIndex + 1)) as CodexFinalResponse;
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

function normalizeFinalCommands(finalResponse: CodexFinalResponse | undefined): CommandCapture {
  const commands: ExecutedCommand[] = [];

  for (const command of finalResponse?.commandsExecuted ?? []) {
    if (!command.command?.trim()) {
      continue;
    }

    commands.push({
      command: command.command.trim(),
      provenance: 'self_reported',
      isPartial: Boolean(command.isPartial),
      notes: command.notes?.trim() || undefined,
    });
  }

  return createCommandCapture(
    commands,
    finalResponse?.commandsExecutedCompleteness ?? 'unknown',
    'codex_final_response',
    finalResponse?.notes ?? [
      'Command capture is based on the runner final response and may be partial.',
    ],
  );
}

function fallbackSummary(stderr: string, stdout: string, exitCode: number): string {
  const candidate = stderr.trim() || stdout.trim();

  if (!candidate) {
    return `Runner exited with code ${exitCode} without a structured final response.`;
  }

  return candidate.split(/\r?\n/).slice(-5).join(' ').trim();
}

function extractRequestedOutputPath(context: RunnerContext): string {
  const combinedText = [
    context.spec.objective,
    context.spec.body,
    ...context.spec.constraints,
    ...context.spec.acceptanceCriteria,
  ].join('\n');
  const match = /`([^`]+\.[A-Za-z0-9._/-]+)`/.exec(combinedText);

  return match?.[1] ?? 'docs/fake-run-output.md';
}

async function withTemporarySchemaFile<T>(
  callback: (schemaPath: string, lastMessagePath: string) => Promise<T>,
): Promise<T> {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'gdh-runner-'));
  const schemaPath = resolve(tempDirectory, 'runner-output-schema.json');
  const lastMessagePath = resolve(tempDirectory, 'runner-last-message.json');

  await writeFile(schemaPath, `${JSON.stringify(runnerOutputSchema, null, 2)}\n`, 'utf8');

  try {
    return await callback(schemaPath, lastMessagePath);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

export class CodexCliRunner implements Runner {
  readonly kind: RunnerKind = 'codex-cli';

  private readonly binaryPath: string;

  constructor(options?: CodexCliRunnerOptions) {
    this.binaryPath = options?.binaryPath ?? 'codex';
  }

  async execute(context: RunnerContext): Promise<RunnerResult> {
    const prompt = createRunnerPrompt(context);

    return withTemporarySchemaFile(async (schemaPath, lastMessagePath) => {
      const startedAt = Date.now();
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      const args = [
        'exec',
        '--json',
        '--output-schema',
        schemaPath,
        '--output-last-message',
        lastMessagePath,
        '--cd',
        context.repoRoot,
        '--sandbox',
        context.run.sandboxMode,
        '--model',
        context.run.model,
        '--config',
        `approval_policy="${context.run.approvalPolicy}"`,
        '-',
      ];

      const child = spawn(this.binaryPath, args, {
        cwd: context.repoRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdoutChunks.push(chunk.toString());
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderrChunks.push(chunk.toString());
      });

      const exitCode = await new Promise<number>((resolveExitCode) => {
        child.on('error', (error) => {
          stderrChunks.push(String(error));
          resolveExitCode(-1);
        });

        child.on('close', (code) => {
          resolveExitCode(code ?? -1);
        });

        child.stdin.end(prompt);
      });

      const durationMs = Date.now() - startedAt;
      const stdout = stdoutChunks.join('');
      const stderr = stderrChunks.join('');
      const finalResponse = parseFinalResponse(await readOptionalFile(lastMessagePath));
      const commandCapture = normalizeFinalCommands(finalResponse);
      const limitations = [...(finalResponse?.limitations ?? [])];

      if (!finalResponse) {
        limitations.push('Structured final response could not be parsed from Codex output.');
      }

      if (commandCapture.completeness !== 'complete') {
        limitations.push('Executed command capture is partially self-reported in Phase 1.');
      }

      return RunnerResultSchema.parse({
        status: finalResponse?.status ?? (exitCode === 0 ? 'completed' : 'failed'),
        summary: finalResponse?.summary?.trim() || fallbackSummary(stderr, stdout, exitCode),
        exitCode,
        durationMs,
        prompt,
        stdout,
        stderr,
        commandCapture,
        reportedChangedFiles: finalResponse?.reportedChangedFiles ?? [],
        reportedChangedFilesCompleteness:
          finalResponse?.reportedChangedFilesCompleteness ?? 'unknown',
        reportedChangedFilesNotes: finalResponse?.notes ?? [],
        limitations,
        artifactsProduced: [],
        metadata: finalResponse?.metadata ?? {},
      });
    });
  }

  async resume(runId: string): Promise<RunnerResult> {
    return RunnerResultSchema.parse({
      status: 'failed',
      summary: `Resume is not implemented in Phase 1 for run "${runId}".`,
      exitCode: -1,
      durationMs: 0,
      prompt: '',
      stdout: '',
      stderr: 'Resume support is deferred until a later durability phase.',
      commandCapture: createCommandCapture([], 'unknown', 'phase1_resume_stub', [
        'Resume is not implemented in Phase 1.',
      ]),
      reportedChangedFiles: [],
      reportedChangedFilesCompleteness: 'unknown',
      reportedChangedFilesNotes: ['Resume is not implemented in Phase 1.'],
      limitations: ['Resume support is deferred until a later durability phase.'],
      artifactsProduced: [],
      metadata: {},
    });
  }
}

export class CodexSdkRunner extends CodexCliRunner {
  override readonly kind: RunnerKind = 'codex-sdk';
}

export class FakeRunner implements Runner {
  readonly kind = 'fake' as const;

  async execute(context: RunnerContext): Promise<RunnerResult> {
    const startedAt = Date.now();
    const relativeOutputPath = extractRequestedOutputPath(context);
    const outputPath = resolve(context.repoRoot, relativeOutputPath);
    const shouldEchoObjectiveAsSummary = hasUnsupportedCertaintyClaim(context.spec.objective);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      [
        '# Phase 6 Fake Runner Output',
        '',
        `Run ID: ${context.run.id}`,
        `Spec: ${context.spec.title}`,
        '',
        'This file is the result of a governed Phase 6 run executed through the deterministic fake runner.',
        '',
        'Objective',
        context.spec.objective,
        '',
        'Plan summary',
        context.plan.summary,
        '',
        'Current Phase 6 limitations',
        '- Policy preview and approval gating happen outside the fake runner itself.',
        '- The fake runner still simulates the work locally; benchmark scoring and regression checks happen in later governed CLI steps.',
        '- The fake runner itself is still deterministic scaffolding rather than a real Codex execution trace.',
      ].join('\n'),
      'utf8',
    );

    return RunnerResultSchema.parse({
      status: 'completed',
      summary: shouldEchoObjectiveAsSummary
        ? context.spec.objective
        : `Fake runner created ${outputPath}.`,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      prompt: createRunnerPrompt(context),
      stdout: `fake runner wrote ${outputPath}\n`,
      stderr: '',
      commandCapture: createCommandCapture(
        [
          {
            command: `fake-runner.write ${relativeOutputPath}`,
            provenance: 'observed',
            isPartial: false,
          },
        ],
        'complete',
        'fake_runner',
        ['Commands are directly observed from the deterministic fake runner implementation.'],
      ),
      reportedChangedFiles: [relativeOutputPath],
      reportedChangedFilesCompleteness: 'complete',
      reportedChangedFilesNotes: ['Fake runner reports the file it wrote directly.'],
      limitations: ['This result was produced by the deterministic fake runner.'],
      artifactsProduced: [],
      metadata: {
        generatedAt: createIsoTimestamp(),
      },
    });
  }

  async resume(runId: string): Promise<RunnerResult> {
    return RunnerResultSchema.parse({
      status: 'failed',
      summary: `Resume is not implemented for fake run "${runId}".`,
      exitCode: -1,
      durationMs: 0,
      prompt: '',
      stdout: '',
      stderr: 'Resume support is deferred.',
      commandCapture: createCommandCapture([], 'unknown', 'fake_runner_resume_stub', [
        'Resume is not implemented in Phase 1.',
      ]),
      reportedChangedFiles: [],
      reportedChangedFilesCompleteness: 'unknown',
      reportedChangedFilesNotes: ['Resume is not implemented in Phase 1.'],
      limitations: ['Resume support is deferred until a later durability phase.'],
      artifactsProduced: [],
      metadata: {},
    });
  }
}

export function createCodexCliRunner(options?: CodexCliRunnerOptions): Runner {
  return new CodexCliRunner(options);
}

export function createCodexSdkRunner(options?: CodexCliRunnerOptions): Runner {
  return new CodexSdkRunner(options);
}

export function createFakeRunner(): Runner {
  return new FakeRunner();
}
