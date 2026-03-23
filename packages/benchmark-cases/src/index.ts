import { readdir, readFile } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import {
  type BenchmarkCase,
  BenchmarkCaseSchema,
  type BenchmarkExecutionMode,
  type BenchmarkIntakeRecord,
  BenchmarkIntakeRecordSchema,
  type BenchmarkMetricName,
  type BenchmarkSuite,
  type BenchmarkSuiteId,
  BenchmarkSuiteSchema,
} from '@gdh/domain';
import YAML from 'yaml';

export const benchmarkSuiteValues = ['smoke', 'fresh', 'longhorizon'] as const;

export interface LoadedBenchmarkCase extends BenchmarkCase {
  filePath: string;
  resolvedPolicyPath?: string;
  resolvedRepoFixturePath?: string;
  resolvedSpecFixturePath?: string;
  resolvedSpecPath?: string;
}

export interface LoadedBenchmarkSuite extends BenchmarkSuite {
  filePath: string;
  resolvedBaselineArtifactPath?: string;
}

export interface LoadedBenchmarkIntakeRecord extends BenchmarkIntakeRecord {
  filePath: string;
  resolvedInputSpecPath?: string;
  resolvedRepoFixturePath?: string;
}

export interface BenchmarkCatalog {
  benchmarkRoot: string;
  cases: LoadedBenchmarkCase[];
  caseMap: Map<string, LoadedBenchmarkCase>;
  suiteMap: Map<string, LoadedBenchmarkSuite>;
  suites: LoadedBenchmarkSuite[];
}

export interface BenchmarkIntakeCatalog {
  benchmarkRoot: string;
  candidates: LoadedBenchmarkIntakeRecord[];
  candidateMap: Map<string, LoadedBenchmarkIntakeRecord>;
  rejected: LoadedBenchmarkIntakeRecord[];
  rejectedMap: Map<string, LoadedBenchmarkIntakeRecord>;
}

const defaultMetricWeights: Record<BenchmarkMetricName, number> = {
  success: 0.3,
  policy_correctness: 0.2,
  verification_correctness: 0.2,
  packet_completeness: 0.15,
  artifact_presence: 0.15,
  latency: 0,
};

function resolveRepoPath(repoRoot: string, value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  return isAbsolute(value) ? value : resolve(repoRoot, value);
}

async function listYamlFilesRecursive(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      filePaths.push(...(await listYamlFilesRecursive(absolutePath)));
      continue;
    }

    if (entry.isFile() && /\.(?:ya?ml)$/i.test(entry.name)) {
      filePaths.push(absolutePath);
    }
  }

  return filePaths;
}

async function readYamlFile(filePath: string): Promise<unknown> {
  return YAML.parse(await readFile(filePath, 'utf8'));
}

function normalizeMetricWeights(
  weights: Partial<Record<BenchmarkMetricName, number>> | undefined,
): Partial<Record<BenchmarkMetricName, number>> {
  return {
    ...defaultMetricWeights,
    ...(weights ?? {}),
  };
}

function suiteIdFromBenchmarkPath(filePath: string): BenchmarkSuiteId | undefined {
  const segments = filePath.split(/[\\/]/);
  const benchmarksIndex = segments.lastIndexOf('benchmarks');
  const suiteId = segments[benchmarksIndex + 1];

  if (!suiteId) {
    return undefined;
  }

  return benchmarkSuiteValues.includes(suiteId as (typeof benchmarkSuiteValues)[number])
    ? (suiteId as BenchmarkSuiteId)
    : undefined;
}

function parseBenchmarkCase(rawValue: unknown, filePath: string): BenchmarkCase {
  const raw = (rawValue ?? {}) as Record<string, unknown>;

  return BenchmarkCaseSchema.parse({
    version: raw.version ?? 1,
    id: raw.id ?? basename(filePath).replace(/\.(?:ya?ml)$/i, ''),
    title: raw.title ?? basename(filePath),
    description: raw.description,
    metadata: raw.metadata,
    suiteIds: raw.suiteIds ?? raw.suites ?? [],
    tags: raw.tags ?? [],
    execution: {
      mode:
        raw.execution && typeof raw.execution === 'object'
          ? ((raw.execution as Record<string, unknown>).mode ?? 'ci_safe')
          : 'ci_safe',
      runner:
        raw.execution && typeof raw.execution === 'object'
          ? ((raw.execution as Record<string, unknown>).runner ?? 'fake')
          : 'fake',
      approvalMode:
        raw.execution && typeof raw.execution === 'object'
          ? ((raw.execution as Record<string, unknown>).approvalMode ?? 'fail')
          : 'fail',
      policyPath:
        raw.execution && typeof raw.execution === 'object'
          ? (raw.execution as Record<string, unknown>).policyPath
          : undefined,
      repoFixturePath:
        raw.execution && typeof raw.execution === 'object'
          ? (raw.execution as Record<string, unknown>).repoFixturePath
          : undefined,
      ciSafe:
        raw.execution && typeof raw.execution === 'object'
          ? ((raw.execution as Record<string, unknown>).ciSafe ?? true)
          : true,
    },
    input: raw.input,
    expected: {
      ...(raw.expected && typeof raw.expected === 'object'
        ? (raw.expected as Record<string, unknown>)
        : {}),
      requiredArtifacts:
        raw.expected && typeof raw.expected === 'object'
          ? (((raw.expected as Record<string, unknown>).requiredArtifacts as string[]) ?? [])
          : [],
    },
    weights: normalizeMetricWeights(
      raw.weights && typeof raw.weights === 'object'
        ? (raw.weights as Partial<Record<BenchmarkMetricName, number>>)
        : undefined,
    ),
  });
}

function parseBenchmarkIntakeRecord(rawValue: unknown, filePath: string): BenchmarkIntakeRecord {
  const raw = (rawValue ?? {}) as Record<string, unknown>;

  return BenchmarkIntakeRecordSchema.parse({
    version: raw.version ?? 1,
    id: raw.id ?? basename(filePath).replace(/\.(?:ya?ml)$/i, ''),
    title: raw.title ?? basename(filePath),
    suiteId: raw.suiteId ?? suiteIdFromBenchmarkPath(filePath),
    sourceType: raw.sourceType,
    sourceProvenance: raw.sourceProvenance,
    collectionDate: raw.collectionDate,
    taskClass: raw.taskClass,
    riskClass: raw.riskClass,
    repoFixturePath: raw.repoFixturePath,
    inputSpecPath: raw.inputSpecPath,
    successCriteria: raw.successCriteria,
    allowedPolicies: raw.allowedPolicies,
    expectedVerificationCommands: raw.expectedVerificationCommands ?? [],
    graders: raw.graders,
    simplificationNotes: raw.simplificationNotes ?? [],
    contaminationNotes: raw.contaminationNotes ?? [],
    maintainerNotes: raw.maintainerNotes ?? [],
    review: raw.review,
  });
}

function parseBenchmarkSuite(rawValue: unknown, filePath: string): BenchmarkSuite {
  const raw = (rawValue ?? {}) as Record<string, unknown>;

  return BenchmarkSuiteSchema.parse({
    version: raw.version ?? 1,
    id: raw.id ?? basename(filePath).replace(/\.(?:ya?ml)$/i, ''),
    title: raw.title ?? basename(filePath),
    description: raw.description,
    caseIds: raw.caseIds ?? [],
    tags: raw.tags ?? [],
    mode: raw.mode ?? 'ci_safe',
    baseline: raw.baseline,
    thresholds: raw.thresholds,
  });
}

function toLoadedBenchmarkCase(
  repoRoot: string,
  definition: BenchmarkCase,
  filePath: string,
): LoadedBenchmarkCase {
  const loaded: LoadedBenchmarkCase = {
    ...definition,
    filePath,
    resolvedPolicyPath: resolveRepoPath(repoRoot, definition.execution.policyPath),
    resolvedRepoFixturePath: resolveRepoPath(repoRoot, definition.execution.repoFixturePath),
    resolvedSpecFixturePath: resolveRepoPath(repoRoot, definition.input.specFixturePath),
    resolvedSpecPath: resolveRepoPath(repoRoot, definition.input.specPath),
  };

  if (!loaded.resolvedSpecPath && !loaded.resolvedSpecFixturePath) {
    throw new Error(
      `Benchmark case "${definition.id}" must define either input.specPath or input.specFixturePath.`,
    );
  }

  if (definition.execution.mode === 'ci_safe' && !definition.execution.ciSafe) {
    throw new Error(
      `Benchmark case "${definition.id}" cannot use mode "ci_safe" while execution.ciSafe is false.`,
    );
  }

  if (definition.execution.mode === 'ci_safe' && !loaded.resolvedRepoFixturePath) {
    throw new Error(
      `Benchmark case "${definition.id}" must define execution.repoFixturePath for ci_safe execution.`,
    );
  }

  const suiteId = suiteIdFromBenchmarkPath(filePath);

  if (suiteId && (definition.suiteIds.length !== 1 || definition.suiteIds[0] !== suiteId)) {
    throw new Error(
      `Benchmark case "${definition.id}" must belong only to suite "${suiteId}" because it is stored under benchmarks/${suiteId}/cases/.`,
    );
  }

  return loaded;
}

function toLoadedBenchmarkSuite(
  repoRoot: string,
  definition: BenchmarkSuite,
  filePath: string,
): LoadedBenchmarkSuite {
  const suiteId = suiteIdFromBenchmarkPath(filePath);

  if (suiteId && definition.id !== suiteId) {
    throw new Error(
      `Benchmark suite "${definition.id}" must match directory suite "${suiteId}" for "${filePath}".`,
    );
  }

  return {
    ...definition,
    filePath,
    resolvedBaselineArtifactPath: resolveRepoPath(repoRoot, definition.baseline?.artifactPath),
  };
}

function toLoadedBenchmarkIntakeRecord(
  repoRoot: string,
  definition: BenchmarkIntakeRecord,
  filePath: string,
): LoadedBenchmarkIntakeRecord {
  const suiteId = suiteIdFromBenchmarkPath(filePath);

  if (suiteId && definition.suiteId !== suiteId) {
    throw new Error(
      `Benchmark intake record "${definition.id}" must match directory suite "${suiteId}" for "${filePath}".`,
    );
  }

  return {
    ...definition,
    filePath,
    resolvedInputSpecPath: resolveRepoPath(repoRoot, definition.inputSpecPath),
    resolvedRepoFixturePath: resolveRepoPath(repoRoot, definition.repoFixturePath),
  };
}

function filterCasesForSuite(
  suite: LoadedBenchmarkSuite,
  cases: LoadedBenchmarkCase[],
): LoadedBenchmarkCase[] {
  const suiteCases = cases.filter((caseDefinition) => caseDefinition.suiteIds.includes(suite.id));

  if (suite.caseIds.length === 0) {
    return suiteCases;
  }

  const suiteCaseIds = new Set(suite.caseIds);
  return suiteCases.filter((caseDefinition) => suiteCaseIds.has(caseDefinition.id));
}

export async function loadBenchmarkCatalog(repoRoot: string): Promise<BenchmarkCatalog> {
  const benchmarkRoot = resolve(repoRoot, 'benchmarks');
  const yamlFiles = await listYamlFilesRecursive(benchmarkRoot);
  const suiteFiles = yamlFiles.filter((filePath) => basename(filePath).match(/^suite\.ya?ml$/i));
  const caseFiles = yamlFiles.filter((filePath) => /[\\/]cases[\\/]/.test(filePath));

  const suites = (
    await Promise.all(
      suiteFiles.map(async (filePath) =>
        toLoadedBenchmarkSuite(
          repoRoot,
          parseBenchmarkSuite(await readYamlFile(filePath), filePath),
          filePath,
        ),
      ),
    )
  ).sort((left, right) => left.id.localeCompare(right.id));
  const cases = (
    await Promise.all(
      caseFiles.map(async (filePath) =>
        toLoadedBenchmarkCase(
          repoRoot,
          parseBenchmarkCase(await readYamlFile(filePath), filePath),
          filePath,
        ),
      ),
    )
  ).sort((left, right) => left.id.localeCompare(right.id));

  const suiteMap = new Map(suites.map((suite) => [suite.id, suite]));
  const caseMap = new Map(cases.map((caseDefinition) => [caseDefinition.id, caseDefinition]));

  for (const caseDefinition of cases) {
    for (const suiteId of caseDefinition.suiteIds) {
      if (!suiteMap.has(suiteId)) {
        throw new Error(
          `Benchmark case "${caseDefinition.id}" references unknown suite "${suiteId}".`,
        );
      }
    }
  }

  for (const suite of suites) {
    const suiteCases = filterCasesForSuite(suite, cases);

    if (suiteCases.length === 0) {
      throw new Error(`Benchmark suite "${suite.id}" does not resolve to any benchmark cases.`);
    }

    for (const caseId of suite.caseIds) {
      if (!caseMap.has(caseId)) {
        throw new Error(
          `Benchmark suite "${suite.id}" references unknown case "${caseId}" in caseIds.`,
        );
      }
    }
  }

  return {
    benchmarkRoot,
    cases,
    caseMap,
    suiteMap,
    suites,
  };
}

export async function loadBenchmarkIntakeCatalog(
  repoRoot: string,
): Promise<BenchmarkIntakeCatalog> {
  const benchmarkRoot = resolve(repoRoot, 'benchmarks');
  const yamlFiles = await listYamlFilesRecursive(benchmarkRoot);
  const candidateFiles = yamlFiles.filter((filePath) => /[\\/]candidates[\\/]/.test(filePath));
  const rejectedFiles = yamlFiles.filter((filePath) => /[\\/]rejected[\\/]/.test(filePath));
  const candidates = (
    await Promise.all(
      candidateFiles.map(async (filePath) =>
        toLoadedBenchmarkIntakeRecord(
          repoRoot,
          parseBenchmarkIntakeRecord(await readYamlFile(filePath), filePath),
          filePath,
        ),
      ),
    )
  ).sort((left, right) => left.id.localeCompare(right.id));
  const rejected = (
    await Promise.all(
      rejectedFiles.map(async (filePath) =>
        toLoadedBenchmarkIntakeRecord(
          repoRoot,
          parseBenchmarkIntakeRecord(await readYamlFile(filePath), filePath),
          filePath,
        ),
      ),
    )
  ).sort((left, right) => left.id.localeCompare(right.id));

  for (const candidate of candidates) {
    if (candidate.review.status === 'rejected') {
      throw new Error(
        `Benchmark candidate "${candidate.id}" is stored under candidates/ but is marked rejected.`,
      );
    }
  }

  for (const rejection of rejected) {
    if (rejection.review.status !== 'rejected') {
      throw new Error(
        `Benchmark rejected record "${rejection.id}" must use review.status "rejected".`,
      );
    }
  }

  return {
    benchmarkRoot,
    candidates,
    candidateMap: new Map(candidates.map((candidate) => [candidate.id, candidate])),
    rejected,
    rejectedMap: new Map(rejected.map((rejection) => [rejection.id, rejection])),
  };
}

export function resolveBenchmarkTarget(
  catalog: BenchmarkCatalog,
  targetId: string,
):
  | { caseDefinition: LoadedBenchmarkCase; kind: 'case' }
  | { cases: LoadedBenchmarkCase[]; kind: 'suite'; suite: LoadedBenchmarkSuite } {
  const suite = catalog.suiteMap.get(targetId);

  if (suite) {
    return {
      kind: 'suite',
      suite,
      cases: filterCasesForSuite(suite, catalog.cases),
    };
  }

  const caseDefinition = catalog.caseMap.get(targetId);

  if (caseDefinition) {
    return {
      kind: 'case',
      caseDefinition,
    };
  }

  throw new Error(`Unknown benchmark target "${targetId}".`);
}

export function selectBenchmarkExecutionMode(
  caseDefinition: LoadedBenchmarkCase,
  suiteMode?: BenchmarkExecutionMode,
  forceCiSafe = false,
): BenchmarkExecutionMode {
  if (forceCiSafe) {
    return 'ci_safe';
  }

  return suiteMode ?? caseDefinition.execution.mode;
}
