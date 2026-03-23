import { readdir, readFile } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import {
  type BenchmarkCase,
  BenchmarkCaseSchema,
  type BenchmarkExecutionMode,
  type BenchmarkMetricName,
  type BenchmarkSuite,
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

export interface BenchmarkCatalog {
  benchmarkRoot: string;
  cases: LoadedBenchmarkCase[];
  caseMap: Map<string, LoadedBenchmarkCase>;
  suiteMap: Map<string, LoadedBenchmarkSuite>;
  suites: LoadedBenchmarkSuite[];
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

function parseBenchmarkCase(rawValue: unknown, filePath: string): BenchmarkCase {
  const raw = (rawValue ?? {}) as Record<string, unknown>;

  return BenchmarkCaseSchema.parse({
    version: raw.version ?? 1,
    id: raw.id ?? basename(filePath).replace(/\.(?:ya?ml)$/i, ''),
    title: raw.title ?? basename(filePath),
    description: raw.description,
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

  return loaded;
}

function toLoadedBenchmarkSuite(
  repoRoot: string,
  definition: BenchmarkSuite,
  filePath: string,
): LoadedBenchmarkSuite {
  return {
    ...definition,
    filePath,
    resolvedBaselineArtifactPath: resolveRepoPath(repoRoot, definition.baseline?.artifactPath),
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
  const caseFiles = yamlFiles.filter((filePath) => filePath.includes('/cases/'));

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
