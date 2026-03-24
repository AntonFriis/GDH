import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { createArtifactStore } from '@gdh/artifact-store';
import {
  type BenchmarkMetricName,
  type BenchmarkRun,
  BenchmarkRunSchema,
  benchmarkMetricNameValues,
  type ComparisonReport,
  ComparisonReportSchema,
  type RegressionResult,
  RegressionResultSchema,
} from '@gdh/domain';
import type { BenchmarkCaseExecutor, BenchmarkRunResult } from '@gdh/evals';
import { runBenchmarkTarget } from '@gdh/evals';
import { createIsoTimestamp, createRunId, findRepoRoot } from '@gdh/shared';
import { readJsonArtifact } from './artifacts.js';

export interface OptimizationCommandSummary {
  artifactsDirectory: string;
  baselineArtifactPath?: string;
  baselineLabel?: string;
  benchmarkRunId?: string;
  benchmarkRunPath?: string;
  benchmarkTarget: string;
  blockedPaths: string[];
  candidateId: string;
  comparisonReportPath?: string;
  decision: 'keep' | 'reject';
  decisionPath: string;
  exitCode: number;
  optimizationRunId: string;
  regressionResultPath?: string;
  regressionStatus?: 'passed' | 'failed';
  score?: number;
  scoreDelta?: number | null;
  status: 'blocked' | 'completed' | 'failed';
  summary: string;
  surfaceIds: string[];
}

interface OptimizationSurfaceConfig {
  description: string;
  id: string;
  notes: string[];
  paths: string[];
}

interface OptimizationDecisionPolicy {
  minimumScoreImprovement: number;
  protectedMetrics: BenchmarkMetricName[];
  requireImprovement: boolean;
  tieBreak: 'reject';
}

interface OptimizationConfig {
  benchmarkTarget: string;
  decision: OptimizationDecisionPolicy;
  runsRoot: string;
  surfaces: OptimizationSurfaceConfig[];
  version: 1;
}

interface OptimizationCandidateFile {
  path: string;
  sourcePath: string;
}

interface OptimizationCandidateManifest {
  benchmarkTarget?: string;
  files: OptimizationCandidateFile[];
  id: string;
  notes: string[];
  summary: string;
  title: string;
  version: 1;
}

interface ResolvedOptimizationCandidateFile extends OptimizationCandidateFile {
  absoluteSourcePath: string;
}

interface ResolvedOptimizationCandidateManifest extends OptimizationCandidateManifest {
  manifestPath: string;
  manifestRoot: string;
  resolvedFiles: ResolvedOptimizationCandidateFile[];
}

interface OptimizationCandidateAudit {
  allowedSurfaceIds: string[];
  blockedPaths: string[];
  candidateId: string;
  changedPaths: string[];
  evaluatedAt: string;
  reasons: string[];
  status: 'blocked' | 'clean';
  summary: string;
}

interface OptimizationDecisionRecord {
  baselineArtifactPath?: string;
  baselineLabel?: string;
  benchmarkRunId?: string;
  benchmarkTarget: string;
  blockedPaths: string[];
  candidateId: string;
  comparisonReportPath?: string;
  decidedAt: string;
  decision: 'keep' | 'reject';
  protectedMetricRegressions: Array<{
    caseId: string;
    metric: BenchmarkMetricName;
    summary: string;
  }>;
  reasons: string[];
  regressionResultPath?: string;
  regressionStatus?: 'passed' | 'failed';
  score?: number;
  scoreDelta?: number | null;
  summary: string;
  surfaceIds: string[];
}

interface OptimizationRunRecord {
  benchmarkRunId?: string;
  benchmarkRunPath?: string;
  benchmarkTarget: string;
  candidateAuditPath: string;
  candidateId: string;
  candidateManifestPath: string;
  candidateTitle: string;
  completedAt?: string;
  comparisonReportPath?: string;
  configPath: string;
  decisionPath?: string;
  id: string;
  regressionResultPath?: string;
  repoRoot: string;
  runDirectory: string;
  startedAt: string;
  status: 'blocked' | 'completed' | 'failed' | 'running';
  summary: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').trim();
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function assertOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return assertString(value, label);
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }

  return value.map((entry) => entry.trim());
}

function assertMetricNameArray(value: unknown, label: string): BenchmarkMetricName[] {
  const values = assertStringArray(value, label);

  for (const metric of values) {
    if (!benchmarkMetricNameValues.includes(metric as BenchmarkMetricName)) {
      throw new Error(
        `${label} contains unsupported metric "${metric}". Expected one of: ${benchmarkMetricNameValues.join(', ')}.`,
      );
    }
  }

  return values as BenchmarkMetricName[];
}

function parseOptimizationConfig(value: unknown): OptimizationConfig {
  if (!isRecord(value)) {
    throw new Error('Optimization config must be a JSON object.');
  }

  const surfacesValue = value.surfaces;

  if (!Array.isArray(surfacesValue) || surfacesValue.length === 0) {
    throw new Error('Optimization config must declare at least one mutable surface.');
  }

  const surfaces = surfacesValue.map((surfaceValue, index) => {
    if (!isRecord(surfaceValue)) {
      throw new Error(`Optimization surface at index ${index} must be an object.`);
    }

    return {
      description: assertString(
        surfaceValue.description,
        `Optimization surface "${index}" description`,
      ),
      id: assertString(surfaceValue.id, `Optimization surface "${index}" id`),
      notes:
        surfaceValue.notes === undefined
          ? []
          : assertStringArray(surfaceValue.notes, `Optimization surface "${index}" notes`),
      paths: assertStringArray(surfaceValue.paths, `Optimization surface "${index}" paths`),
    } satisfies OptimizationSurfaceConfig;
  });

  const decisionValue = value.decision;

  if (!isRecord(decisionValue)) {
    throw new Error('Optimization config must include a decision object.');
  }

  const tieBreak = assertString(decisionValue.tieBreak, 'Optimization decision tieBreak');

  if (tieBreak !== 'reject') {
    throw new Error('Optimization decision tieBreak must currently be "reject".');
  }

  const minimumScoreImprovement =
    typeof decisionValue.minimumScoreImprovement === 'number'
      ? decisionValue.minimumScoreImprovement
      : 0;

  if (minimumScoreImprovement < 0 || minimumScoreImprovement > 1) {
    throw new Error('Optimization decision minimumScoreImprovement must be between 0 and 1.');
  }

  return {
    benchmarkTarget: assertString(value.benchmarkTarget, 'Optimization config benchmarkTarget'),
    decision: {
      minimumScoreImprovement,
      protectedMetrics: assertMetricNameArray(
        decisionValue.protectedMetrics,
        'Optimization decision protectedMetrics',
      ),
      requireImprovement:
        typeof decisionValue.requireImprovement === 'boolean'
          ? decisionValue.requireImprovement
          : true,
      tieBreak,
    },
    runsRoot: assertString(value.runsRoot, 'Optimization config runsRoot'),
    surfaces,
    version: value.version === 1 ? 1 : 1,
  };
}

function parseCandidateManifest(value: unknown): OptimizationCandidateManifest {
  if (!isRecord(value)) {
    throw new Error('Optimization candidate manifest must be a JSON object.');
  }

  const filesValue = value.files;

  if (!Array.isArray(filesValue) || filesValue.length === 0) {
    throw new Error('Optimization candidate manifest must declare at least one file.');
  }

  const files = filesValue.map((fileValue, index) => {
    if (!isRecord(fileValue)) {
      throw new Error(`Optimization candidate file at index ${index} must be an object.`);
    }

    return {
      path: assertString(fileValue.path, `Optimization candidate file "${index}" path`),
      sourcePath: assertString(
        fileValue.sourcePath,
        `Optimization candidate file "${index}" sourcePath`,
      ),
    } satisfies OptimizationCandidateFile;
  });

  return {
    benchmarkTarget: assertOptionalString(
      value.benchmarkTarget,
      'Optimization candidate benchmarkTarget',
    ),
    files,
    id: assertString(value.id, 'Optimization candidate id'),
    notes:
      value.notes === undefined
        ? []
        : assertStringArray(value.notes, 'Optimization candidate notes'),
    summary: assertString(value.summary, 'Optimization candidate summary'),
    title: assertString(value.title, 'Optimization candidate title'),
    version: value.version === 1 ? 1 : 1,
  };
}

function parseOptimizationRunRecord(value: unknown): OptimizationRunRecord {
  if (!isRecord(value)) {
    throw new Error('Optimization run artifact must be a JSON object.');
  }

  const status = assertString(value.status, 'Optimization run status');

  if (!['running', 'completed', 'blocked', 'failed'].includes(status)) {
    throw new Error(`Unsupported optimization run status "${status}".`);
  }

  return {
    benchmarkRunId: assertOptionalString(value.benchmarkRunId, 'Optimization run benchmarkRunId'),
    benchmarkRunPath: assertOptionalString(
      value.benchmarkRunPath,
      'Optimization run benchmarkRunPath',
    ),
    benchmarkTarget: assertString(value.benchmarkTarget, 'Optimization run benchmarkTarget'),
    candidateAuditPath: assertString(
      value.candidateAuditPath,
      'Optimization run candidateAuditPath',
    ),
    candidateId: assertString(value.candidateId, 'Optimization run candidateId'),
    candidateManifestPath: assertString(
      value.candidateManifestPath,
      'Optimization run candidateManifestPath',
    ),
    candidateTitle: assertString(value.candidateTitle, 'Optimization run candidateTitle'),
    completedAt: assertOptionalString(value.completedAt, 'Optimization run completedAt'),
    comparisonReportPath: assertOptionalString(
      value.comparisonReportPath,
      'Optimization run comparisonReportPath',
    ),
    configPath: assertString(value.configPath, 'Optimization run configPath'),
    decisionPath: assertOptionalString(value.decisionPath, 'Optimization run decisionPath'),
    id: assertString(value.id, 'Optimization run id'),
    regressionResultPath: assertOptionalString(
      value.regressionResultPath,
      'Optimization run regressionResultPath',
    ),
    repoRoot: assertString(value.repoRoot, 'Optimization run repoRoot'),
    runDirectory: assertString(value.runDirectory, 'Optimization run runDirectory'),
    startedAt: assertString(value.startedAt, 'Optimization run startedAt'),
    status: status as OptimizationRunRecord['status'],
    summary: assertString(value.summary, 'Optimization run summary'),
  };
}

function parseOptimizationDecisionRecord(value: unknown): OptimizationDecisionRecord {
  if (!isRecord(value)) {
    throw new Error('Optimization decision artifact must be a JSON object.');
  }

  const decision = assertString(value.decision, 'Optimization decision');

  if (decision !== 'keep' && decision !== 'reject') {
    throw new Error(`Unsupported optimization decision "${decision}".`);
  }

  const regressionsValue = value.protectedMetricRegressions;

  if (!Array.isArray(regressionsValue)) {
    throw new Error('Optimization decision protectedMetricRegressions must be an array.');
  }

  return {
    baselineArtifactPath: assertOptionalString(
      value.baselineArtifactPath,
      'Optimization decision baselineArtifactPath',
    ),
    baselineLabel: assertOptionalString(value.baselineLabel, 'Optimization decision baselineLabel'),
    benchmarkRunId: assertOptionalString(
      value.benchmarkRunId,
      'Optimization decision benchmarkRunId',
    ),
    benchmarkTarget: assertString(value.benchmarkTarget, 'Optimization decision benchmarkTarget'),
    blockedPaths: assertStringArray(value.blockedPaths ?? [], 'Optimization decision blockedPaths'),
    candidateId: assertString(value.candidateId, 'Optimization decision candidateId'),
    comparisonReportPath: assertOptionalString(
      value.comparisonReportPath,
      'Optimization decision comparisonReportPath',
    ),
    decidedAt: assertString(value.decidedAt, 'Optimization decision decidedAt'),
    decision,
    protectedMetricRegressions: regressionsValue.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(
          `Optimization decision protectedMetricRegression "${index}" must be an object.`,
        );
      }

      const metric = assertString(
        entry.metric,
        `Optimization decision protectedMetricRegression "${index}" metric`,
      );

      if (!benchmarkMetricNameValues.includes(metric as BenchmarkMetricName)) {
        throw new Error(`Unsupported optimization protected metric regression "${metric}".`);
      }

      return {
        caseId: assertString(
          entry.caseId,
          `Optimization decision protectedMetricRegression "${index}" caseId`,
        ),
        metric: metric as BenchmarkMetricName,
        summary: assertString(
          entry.summary,
          `Optimization decision protectedMetricRegression "${index}" summary`,
        ),
      };
    }),
    reasons: assertStringArray(value.reasons ?? [], 'Optimization decision reasons'),
    regressionResultPath: assertOptionalString(
      value.regressionResultPath,
      'Optimization decision regressionResultPath',
    ),
    regressionStatus:
      value.regressionStatus === undefined
        ? undefined
        : (() => {
            const regressionStatus = assertString(
              value.regressionStatus,
              'Optimization decision regressionStatus',
            );

            if (regressionStatus !== 'passed' && regressionStatus !== 'failed') {
              throw new Error(`Unsupported optimization regression status "${regressionStatus}".`);
            }

            return regressionStatus;
          })(),
    score: typeof value.score === 'number' ? value.score : undefined,
    scoreDelta:
      typeof value.scoreDelta === 'number' || value.scoreDelta === null
        ? value.scoreDelta
        : undefined,
    summary: assertString(value.summary, 'Optimization decision summary'),
    surfaceIds: assertStringArray(value.surfaceIds ?? [], 'Optimization decision surfaceIds'),
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;

    if (fileError.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function ensureSafeRepoRelativePath(value: string, label: string): string {
  const normalized = normalizePath(value);

  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error(`${label} must be a safe repo-relative path.`);
  }

  return normalized;
}

function ensureCandidateSourcePath(bundleRoot: string, sourcePath: string): string {
  const absolutePath = resolve(bundleRoot, sourcePath);
  const relativeToBundle = normalizePath(relative(bundleRoot, absolutePath));

  if (!relativeToBundle || relativeToBundle.startsWith('../') || relativeToBundle === '..') {
    throw new Error(
      `Optimization candidate sourcePath "${sourcePath}" escapes the candidate bundle.`,
    );
  }

  return absolutePath;
}

function globPatternToRegExp(pattern: string): RegExp {
  let expression = '^';
  const normalized = normalizePath(pattern);

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    const nextCharacter = normalized[index + 1];

    if (character === '*' && nextCharacter === '*') {
      expression += '.*';
      index += 1;
      continue;
    }

    if (character === '*') {
      expression += '[^/]*';
      continue;
    }

    expression += /[|\\{}()[\]^$+?.]/.test(character ?? '') ? `\\${character}` : character;
  }

  expression += '$';
  return new RegExp(expression);
}

function matchesAnyPattern(path: string, patterns: string[]): boolean {
  const normalized = normalizePath(path);
  return patterns.some((pattern) => globPatternToRegExp(pattern).test(normalized));
}

function topLevelCopyRoots(
  config: OptimizationConfig,
  candidate: ResolvedOptimizationCandidateManifest,
): string[] {
  const roots = new Set<string>(['benchmarks', 'policies', 'gdh.config.json', 'gdh.optimize.json']);

  const recordRoot = (value: string) => {
    const normalized = normalizePath(value);
    const [firstSegment] = normalized.split('/');

    if (firstSegment) {
      roots.add(firstSegment);
    }
  };

  for (const surface of config.surfaces) {
    for (const pattern of surface.paths) {
      recordRoot(pattern);
    }
  }

  for (const file of candidate.resolvedFiles) {
    recordRoot(file.path);
  }

  return [...roots];
}

async function copyPathIfPresent(sourcePath: string, destinationPath: string): Promise<void> {
  if (!(await pathExists(sourcePath))) {
    return;
  }

  const sourceStats = await stat(sourcePath);

  if (sourceStats.isDirectory()) {
    await cp(sourcePath, destinationPath, { recursive: true });
    return;
  }

  await mkdir(dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath);
}

async function loadOptimizationConfig(repoRoot: string): Promise<OptimizationConfig> {
  const filePath = resolve(repoRoot, 'gdh.optimize.json');
  return parseOptimizationConfig(JSON.parse(await readFile(filePath, 'utf8')));
}

async function loadOptimizationCandidateManifest(
  candidatePath: string,
): Promise<ResolvedOptimizationCandidateManifest> {
  const manifestPath = resolve(candidatePath);
  const manifestRoot = dirname(manifestPath);
  const manifest = parseCandidateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  const resolvedFiles = manifest.files.map((file) => ({
    ...file,
    absoluteSourcePath: ensureCandidateSourcePath(manifestRoot, file.sourcePath),
    path: ensureSafeRepoRelativePath(file.path, `Optimization candidate file "${file.path}" path`),
  }));

  for (const file of resolvedFiles) {
    if (!(await pathExists(file.absoluteSourcePath))) {
      throw new Error(
        `Optimization candidate source file "${file.absoluteSourcePath}" does not exist or is not readable.`,
      );
    }
  }

  return {
    ...manifest,
    manifestPath,
    manifestRoot,
    resolvedFiles,
  };
}

function auditCandidate(
  candidate: ResolvedOptimizationCandidateManifest,
  config: OptimizationConfig,
): OptimizationCandidateAudit {
  const changedPaths = candidate.resolvedFiles.map((file) => file.path);
  const allowedSurfaceIds = new Set<string>();
  const blockedPaths: string[] = [];

  for (const file of candidate.resolvedFiles) {
    const matchingSurfaces = config.surfaces.filter((surface) =>
      matchesAnyPattern(file.path, surface.paths),
    );

    if (matchingSurfaces.length === 0) {
      blockedPaths.push(file.path);
      continue;
    }

    for (const surface of matchingSurfaces) {
      allowedSurfaceIds.add(surface.id);
    }
  }

  const reasons =
    blockedPaths.length === 0
      ? ['All candidate file targets stayed inside the configured optimization surface allowlist.']
      : [
          `Candidate touched ${blockedPaths.length} path(s) outside the configured optimization surface allowlist.`,
        ];

  return {
    allowedSurfaceIds: [...allowedSurfaceIds].sort(),
    blockedPaths,
    candidateId: candidate.id,
    changedPaths,
    evaluatedAt: createIsoTimestamp(),
    reasons,
    status: blockedPaths.length === 0 ? 'clean' : 'blocked',
    summary:
      blockedPaths.length === 0
        ? `Candidate "${candidate.id}" stayed inside the allowed optimization surface.`
        : `Candidate "${candidate.id}" escaped the allowed optimization surface.`,
  };
}

async function prepareOptimizationWorkspace(
  repoRoot: string,
  config: OptimizationConfig,
  candidate: ResolvedOptimizationCandidateManifest,
): Promise<{ cleanup(): Promise<void>; repoRoot: string }> {
  const tempRepoRoot = await mkdtemp(resolve(tmpdir(), 'gdh-optimize-'));

  for (const copyRoot of topLevelCopyRoots(config, candidate)) {
    await copyPathIfPresent(resolve(repoRoot, copyRoot), resolve(tempRepoRoot, copyRoot));
  }

  return {
    cleanup: async () => {
      await rm(tempRepoRoot, { recursive: true, force: true });
    },
    repoRoot: tempRepoRoot,
  };
}

async function applyCandidateToWorkspace(
  workspaceRoot: string,
  candidate: ResolvedOptimizationCandidateManifest,
): Promise<void> {
  for (const file of candidate.resolvedFiles) {
    const targetPath = resolve(workspaceRoot, file.path);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, await readFile(file.absoluteSourcePath));
  }
}

async function persistCandidateArtifacts(
  repoRoot: string,
  candidate: ResolvedOptimizationCandidateManifest,
  config: OptimizationConfig,
  runId: string,
  runDirectory: string,
): Promise<{
  candidateAuditPath: string;
  candidateManifestPath: string;
  configPath: string;
  audit: OptimizationCandidateAudit;
}> {
  const artifactStore = createArtifactStore({
    repoRoot,
    runId,
    runsRoot: dirname(runDirectory),
  });
  const configArtifact = await artifactStore.writeJsonArtifact(
    'optimization-config',
    'resolved-config.json',
    config,
    'Resolved bounded optimization config used for this run.',
  );
  const manifestArtifact = await artifactStore.writeJsonArtifact(
    'optimization-candidate',
    'candidate.manifest.json',
    {
      benchmarkTarget: candidate.benchmarkTarget,
      files: candidate.resolvedFiles.map((file) => ({
        path: file.path,
        sourcePath: normalizePath(relative(candidate.manifestRoot, file.absoluteSourcePath)),
      })),
      id: candidate.id,
      notes: candidate.notes,
      summary: candidate.summary,
      title: candidate.title,
      version: candidate.version,
    },
    'Optimization candidate manifest as evaluated.',
  );

  for (const file of candidate.resolvedFiles) {
    await artifactStore.writeTextArtifact(
      'optimization-candidate-file',
      `candidate/files/${file.path}`,
      await readFile(file.absoluteSourcePath, 'utf8'),
      'text',
      `Candidate payload for ${file.path}.`,
    );
  }

  const audit = auditCandidate(candidate, config);
  const auditArtifact = await artifactStore.writeJsonArtifact(
    'optimization-candidate-audit',
    'candidate.audit.json',
    audit,
    'Allowlist audit for the proposed optimization candidate.',
  );

  return {
    audit,
    candidateAuditPath: auditArtifact.path,
    candidateManifestPath: manifestArtifact.path,
    configPath: configArtifact.path,
  };
}

async function copyBaselineArtifact(
  repoRoot: string,
  runId: string,
  runDirectory: string,
  comparisonReport: ComparisonReport | undefined,
): Promise<{ baselineArtifactPath?: string; baselineLabel?: string }> {
  if (!comparisonReport) {
    return {};
  }

  const artifactStore = createArtifactStore({
    repoRoot,
    runId,
    runsRoot: dirname(runDirectory),
  });
  const baselineText = await readFile(comparisonReport.rhs.artifactPath, 'utf8');
  const baselineArtifact = await artifactStore.writeTextArtifact(
    'optimization-baseline',
    'baseline/benchmark.run.json',
    baselineText,
    'json',
    `Baseline artifact copied from ${comparisonReport.rhs.label}.`,
  );
  await artifactStore.writeJsonArtifact(
    'optimization-baseline-ref',
    'baseline/ref.json',
    comparisonReport.rhs,
    'Baseline reference resolved for the optimization comparison.',
  );

  return {
    baselineArtifactPath: baselineArtifact.path,
    baselineLabel: comparisonReport.rhs.label,
  };
}

async function copyBenchmarkArtifacts(
  repoRoot: string,
  runId: string,
  runDirectory: string,
  benchmarkResult: BenchmarkRunResult,
): Promise<{
  baselineArtifactPath?: string;
  baselineLabel?: string;
  benchmarkRunPath: string;
  comparisonReportPath?: string;
  regressionResultPath?: string;
}> {
  const benchmarkRunCopyRoot = resolve(runDirectory, 'benchmark', 'run');
  await cp(benchmarkResult.benchmarkRun.runDirectory, benchmarkRunCopyRoot, { recursive: true });
  const baselineCopy = await copyBaselineArtifact(
    repoRoot,
    runId,
    runDirectory,
    benchmarkResult.comparisonReport,
  );

  return {
    ...baselineCopy,
    benchmarkRunPath: resolve(benchmarkRunCopyRoot, 'benchmark.run.json'),
    comparisonReportPath: benchmarkResult.comparisonReport
      ? resolve(benchmarkRunCopyRoot, 'comparison.report.json')
      : undefined,
    regressionResultPath: benchmarkResult.regressionResult
      ? resolve(benchmarkRunCopyRoot, 'regression.result.json')
      : undefined,
  };
}

function buildProtectedMetricRegressions(
  comparisonReport: ComparisonReport | undefined,
  protectedMetrics: BenchmarkMetricName[],
): OptimizationDecisionRecord['protectedMetricRegressions'] {
  if (!comparisonReport) {
    return [];
  }

  return comparisonReport.caseComparisons.flatMap((caseComparison) =>
    caseComparison.metricComparisons
      .filter(
        (metricComparison) =>
          protectedMetrics.includes(metricComparison.name) &&
          metricComparison.status === 'regressed',
      )
      .map((metricComparison) => ({
        caseId: caseComparison.caseId,
        metric: metricComparison.name,
        summary: `Protected metric "${metricComparison.name}" regressed for case "${caseComparison.caseId}".`,
      })),
  );
}

function createDecisionRecord(input: {
  audit: OptimizationCandidateAudit;
  baselineArtifactPath?: string;
  baselineLabel?: string;
  benchmarkRun?: BenchmarkRun;
  benchmarkTarget: string;
  comparisonReport?: ComparisonReport;
  comparisonReportPath?: string;
  config: OptimizationConfig;
  regressionResult?: RegressionResult;
  regressionResultPath?: string;
}): OptimizationDecisionRecord {
  const protectedMetricRegressions = buildProtectedMetricRegressions(
    input.comparisonReport,
    input.config.decision.protectedMetrics,
  );
  const reasons = [...input.audit.reasons];
  const scoreDelta = input.comparisonReport?.overall.delta ?? null;

  if (input.audit.status === 'blocked') {
    reasons.push('Candidate escaped the configured optimization surface allowlist.');
  }

  if (!input.comparisonReport || !input.regressionResult) {
    reasons.push('No persisted benchmark comparison was available, so the workflow fails closed.');
  }

  if (input.regressionResult?.status === 'failed') {
    reasons.push(...input.regressionResult.reasons);
  }

  if (protectedMetricRegressions.length > 0) {
    reasons.push(
      `Protected benchmark metrics regressed for ${protectedMetricRegressions.length} case/metric pair(s).`,
    );
  }

  if (input.config.decision.requireImprovement) {
    if (scoreDelta === null) {
      reasons.push(
        'Benchmark score delta was unavailable, so the tie-break policy rejected the candidate.',
      );
    } else if (scoreDelta <= input.config.decision.minimumScoreImprovement) {
      reasons.push(
        scoreDelta === 0
          ? 'Candidate matched the baseline score and the configured tie-break policy rejects ties.'
          : `Candidate did not exceed the minimum required score improvement of ${input.config.decision.minimumScoreImprovement.toFixed(2)}.`,
      );
    }
  }

  const decision =
    reasons.length === 1 &&
    reasons[0] ===
      'All candidate file targets stayed inside the configured optimization surface allowlist.'
      ? 'keep'
      : reasons.length === 0
        ? 'keep'
        : 'reject';

  return {
    baselineArtifactPath: input.baselineArtifactPath,
    baselineLabel: input.baselineLabel,
    benchmarkRunId: input.benchmarkRun?.id,
    benchmarkTarget: input.benchmarkTarget,
    blockedPaths: input.audit.blockedPaths,
    candidateId: input.audit.candidateId,
    comparisonReportPath: input.comparisonReportPath,
    decidedAt: createIsoTimestamp(),
    decision,
    protectedMetricRegressions,
    reasons:
      decision === 'keep'
        ? [
            'Candidate stayed inside the allowed surface and improved the configured benchmark target without protected regressions.',
          ]
        : reasons,
    regressionResultPath: input.regressionResultPath,
    regressionStatus: input.regressionResult?.status,
    score: input.benchmarkRun?.score.normalizedScore,
    scoreDelta,
    summary:
      decision === 'keep'
        ? `Keep candidate "${input.audit.candidateId}" based on benchmark evidence.`
        : `Reject candidate "${input.audit.candidateId}" based on bounded optimization rules.`,
    surfaceIds: input.audit.allowedSurfaceIds,
  };
}

async function persistDecisionArtifacts(
  repoRoot: string,
  runId: string,
  runDirectory: string,
  decision: OptimizationDecisionRecord,
): Promise<string> {
  const artifactStore = createArtifactStore({
    repoRoot,
    runId,
    runsRoot: dirname(runDirectory),
  });
  const decisionArtifact = await artifactStore.writeJsonArtifact(
    'optimization-decision',
    'decision.json',
    decision,
    'Final keep/reject decision for the bounded optimization candidate.',
  );

  await artifactStore.writeTextArtifact(
    'optimization-notes',
    'notes.md',
    [
      '# Bounded Optimization Decision',
      '',
      `- Candidate: ${decision.candidateId}`,
      `- Benchmark target: ${decision.benchmarkTarget}`,
      `- Decision: ${decision.decision}`,
      `- Baseline: ${decision.baselineLabel ?? 'none'}`,
      decision.score !== undefined ? `- Candidate score: ${decision.score.toFixed(2)}` : null,
      decision.scoreDelta !== undefined && decision.scoreDelta !== null
        ? `- Score delta: ${decision.scoreDelta.toFixed(2)}`
        : '- Score delta: unavailable',
      '',
      '## Reasons',
      ...(decision.reasons.length > 0
        ? decision.reasons.map((reason) => `- ${reason}`)
        : ['- none']),
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
    'markdown',
    'Human-readable decision notes for the bounded optimization run.',
  );

  return decisionArtifact.path;
}

async function persistRunRecord(
  repoRoot: string,
  runId: string,
  runDirectory: string,
  record: OptimizationRunRecord,
): Promise<void> {
  const artifactStore = createArtifactStore({
    repoRoot,
    runId,
    runsRoot: dirname(runDirectory),
  });
  await artifactStore.writeJsonArtifact(
    'optimization-run',
    'optimization.run.json',
    record,
    'Top-level run artifact for the bounded optimization workflow.',
  );
}

function toSummary(input: {
  decision: OptimizationDecisionRecord;
  run: OptimizationRunRecord;
}): OptimizationCommandSummary {
  return {
    artifactsDirectory: input.run.runDirectory,
    baselineArtifactPath: input.decision.baselineArtifactPath,
    baselineLabel: input.decision.baselineLabel,
    benchmarkRunId: input.decision.benchmarkRunId,
    benchmarkRunPath: input.run.benchmarkRunPath,
    benchmarkTarget: input.decision.benchmarkTarget,
    blockedPaths: input.decision.blockedPaths,
    candidateId: input.decision.candidateId,
    comparisonReportPath: input.decision.comparisonReportPath,
    decision: input.decision.decision,
    decisionPath: input.run.decisionPath ?? '',
    exitCode: input.decision.decision === 'keep' ? 0 : 1,
    optimizationRunId: input.run.id,
    regressionResultPath: input.decision.regressionResultPath,
    regressionStatus: input.decision.regressionStatus,
    score: input.decision.score,
    scoreDelta: input.decision.scoreDelta,
    status: input.run.status === 'running' ? 'failed' : input.run.status,
    summary: input.decision.summary,
    surfaceIds: input.decision.surfaceIds,
  };
}

export async function loadOptimizationRun(
  repoRoot: string,
  identifier: string,
): Promise<OptimizationRunRecord> {
  const asPath = resolve(repoRoot, identifier);
  const targetPath =
    (await pathExists(asPath)) && (await stat(asPath)).isDirectory()
      ? resolve(asPath, 'optimization.run.json')
      : (await pathExists(asPath))
        ? asPath
        : resolve(repoRoot, 'runs', 'optimizations', identifier, 'optimization.run.json');

  return readJsonArtifact(
    targetPath,
    {
      parse: parseOptimizationRunRecord,
    },
    'optimization run artifact',
  );
}

export async function runOptimizationCandidate(
  candidatePath: string,
  options: {
    cwd?: string;
    executeCase: BenchmarkCaseExecutor;
  },
): Promise<OptimizationCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const config = await loadOptimizationConfig(repoRoot);
  const candidate = await loadOptimizationCandidateManifest(resolve(cwd, candidatePath));
  const runId = createRunId(`optimize-${candidate.id}`);
  const runsRoot = resolve(repoRoot, config.runsRoot);
  const artifactStore = createArtifactStore({
    repoRoot,
    runId,
    runsRoot,
  });

  await artifactStore.initialize();

  const { audit, candidateAuditPath, candidateManifestPath, configPath } =
    await persistCandidateArtifacts(repoRoot, candidate, config, runId, artifactStore.runDirectory);
  const benchmarkTarget = candidate.benchmarkTarget ?? config.benchmarkTarget;
  let runRecord: OptimizationRunRecord = {
    benchmarkTarget,
    candidateAuditPath,
    candidateId: candidate.id,
    candidateManifestPath,
    candidateTitle: candidate.title,
    configPath,
    id: runId,
    repoRoot,
    runDirectory: artifactStore.runDirectory,
    startedAt: createIsoTimestamp(),
    status: 'running',
    summary: `Optimization candidate "${candidate.id}" is being evaluated.`,
  };
  await persistRunRecord(repoRoot, runId, artifactStore.runDirectory, runRecord);

  if (audit.status === 'blocked') {
    const decision = createDecisionRecord({
      audit,
      benchmarkTarget,
      config,
    });
    const decisionPath = await persistDecisionArtifacts(
      repoRoot,
      runId,
      artifactStore.runDirectory,
      decision,
    );
    runRecord = {
      ...runRecord,
      completedAt: createIsoTimestamp(),
      decisionPath,
      status: 'blocked',
      summary: decision.summary,
    };
    await persistRunRecord(repoRoot, runId, artifactStore.runDirectory, runRecord);
    return toSummary({
      decision,
      run: runRecord,
    });
  }

  const workspace = await prepareOptimizationWorkspace(repoRoot, config, candidate);

  try {
    await applyCandidateToWorkspace(workspace.repoRoot, candidate);
    const benchmarkResult = await runBenchmarkTarget({
      ciSafe: true,
      executeCase: options.executeCase,
      repoRoot: workspace.repoRoot,
      targetId: benchmarkTarget,
    });
    const copiedArtifacts = await copyBenchmarkArtifacts(
      repoRoot,
      runId,
      artifactStore.runDirectory,
      benchmarkResult,
    );
    const comparisonReport = benchmarkResult.comparisonReport
      ? ComparisonReportSchema.parse(benchmarkResult.comparisonReport)
      : undefined;
    const regressionResult = benchmarkResult.regressionResult
      ? RegressionResultSchema.parse(benchmarkResult.regressionResult)
      : undefined;
    const benchmarkRun = BenchmarkRunSchema.parse(benchmarkResult.benchmarkRun);
    const decision = createDecisionRecord({
      audit,
      baselineArtifactPath: copiedArtifacts.baselineArtifactPath,
      baselineLabel: copiedArtifacts.baselineLabel,
      benchmarkRun,
      benchmarkTarget,
      comparisonReport,
      comparisonReportPath: copiedArtifacts.comparisonReportPath,
      config,
      regressionResult,
      regressionResultPath: copiedArtifacts.regressionResultPath,
    });
    const decisionPath = await persistDecisionArtifacts(
      repoRoot,
      runId,
      artifactStore.runDirectory,
      decision,
    );

    runRecord = {
      ...runRecord,
      benchmarkRunId: benchmarkRun.id,
      benchmarkRunPath: copiedArtifacts.benchmarkRunPath,
      comparisonReportPath: copiedArtifacts.comparisonReportPath,
      completedAt: createIsoTimestamp(),
      decisionPath,
      regressionResultPath: copiedArtifacts.regressionResultPath,
      status: decision.decision === 'keep' ? 'completed' : 'failed',
      summary: decision.summary,
    };
    await persistRunRecord(repoRoot, runId, artifactStore.runDirectory, runRecord);

    return toSummary({
      decision,
      run: runRecord,
    });
  } finally {
    await workspace.cleanup();
  }
}

export async function compareOptimizationRunId(
  runId: string,
  options: { cwd?: string } = {},
): Promise<OptimizationCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const run = await loadOptimizationRun(repoRoot, runId);
  const decision = await readJsonArtifact(
    run.decisionPath ?? resolve(run.runDirectory, 'decision.json'),
    {
      parse: parseOptimizationDecisionRecord,
    },
    'optimization decision artifact',
  );

  return toSummary({
    decision,
    run,
  });
}

export async function decideOptimizationRunId(
  runId: string,
  options: { cwd?: string } = {},
): Promise<OptimizationCommandSummary> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const run = await loadOptimizationRun(repoRoot, runId);
  const config = await readJsonArtifact(
    run.configPath,
    {
      parse: parseOptimizationConfig,
    },
    'resolved optimization config artifact',
  );
  const audit = await readJsonArtifact(
    run.candidateAuditPath,
    {
      parse(value: unknown) {
        if (!isRecord(value)) {
          throw new Error('Optimization candidate audit must be an object.');
        }

        return {
          allowedSurfaceIds: assertStringArray(
            value.allowedSurfaceIds ?? [],
            'Optimization candidate audit allowedSurfaceIds',
          ),
          blockedPaths: assertStringArray(
            value.blockedPaths ?? [],
            'Optimization candidate audit blockedPaths',
          ),
          candidateId: assertString(value.candidateId, 'Optimization candidate audit candidateId'),
          changedPaths: assertStringArray(
            value.changedPaths ?? [],
            'Optimization candidate audit changedPaths',
          ),
          evaluatedAt: assertString(value.evaluatedAt, 'Optimization candidate audit evaluatedAt'),
          reasons: assertStringArray(value.reasons ?? [], 'Optimization candidate audit reasons'),
          status:
            assertString(value.status, 'Optimization candidate audit status') === 'blocked'
              ? 'blocked'
              : 'clean',
          summary: assertString(value.summary, 'Optimization candidate audit summary'),
        } satisfies OptimizationCandidateAudit;
      },
    },
    'optimization candidate audit artifact',
  );

  const comparisonReport =
    run.comparisonReportPath && (await pathExists(run.comparisonReportPath))
      ? await readJsonArtifact(
          run.comparisonReportPath,
          ComparisonReportSchema,
          'comparison report',
        )
      : undefined;
  const regressionResult =
    run.regressionResultPath && (await pathExists(run.regressionResultPath))
      ? await readJsonArtifact(
          run.regressionResultPath,
          RegressionResultSchema,
          'regression result',
        )
      : undefined;
  const benchmarkRun =
    run.benchmarkRunPath && (await pathExists(run.benchmarkRunPath))
      ? await readJsonArtifact(run.benchmarkRunPath, BenchmarkRunSchema, 'benchmark run')
      : undefined;
  const baselineLabel = comparisonReport?.rhs.label;
  const baselineArtifactPath = run.comparisonReportPath
    ? resolve(run.runDirectory, 'baseline', 'benchmark.run.json')
    : undefined;
  const decision = createDecisionRecord({
    audit,
    baselineArtifactPath:
      baselineArtifactPath && (await pathExists(baselineArtifactPath))
        ? baselineArtifactPath
        : undefined,
    baselineLabel,
    benchmarkRun,
    benchmarkTarget: run.benchmarkTarget,
    comparisonReport,
    comparisonReportPath: run.comparisonReportPath,
    config,
    regressionResult,
    regressionResultPath: run.regressionResultPath,
  });
  const decisionPath = await persistDecisionArtifacts(repoRoot, run.id, run.runDirectory, decision);
  const updatedRun: OptimizationRunRecord = {
    ...run,
    completedAt: run.completedAt ?? createIsoTimestamp(),
    decisionPath,
    status:
      decision.decision === 'keep' ? 'completed' : run.status === 'blocked' ? 'blocked' : 'failed',
    summary: decision.summary,
  };
  await persistRunRecord(repoRoot, run.id, run.runDirectory, updatedRun);

  return toSummary({
    decision,
    run: updatedRun,
  });
}
