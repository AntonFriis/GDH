import {
  type BenchmarkCatalog,
  type LoadedBenchmarkCase,
  type LoadedBenchmarkSuite,
  loadBenchmarkCatalog,
  resolveBenchmarkTarget,
  selectBenchmarkExecutionMode,
} from '@gdh/benchmark-cases';
import type { BenchmarkExecutionMode } from '@gdh/domain';

export interface ResolvedBenchmarkTargetContext {
  caseDefinitions: LoadedBenchmarkCase[];
  catalog: BenchmarkCatalog;
  suite?: LoadedBenchmarkSuite;
  target: ReturnType<typeof resolveBenchmarkTarget>;
}

export function loadBenchmarkCatalogData(repoRoot: string): Promise<BenchmarkCatalog> {
  return loadBenchmarkCatalog(repoRoot);
}

export async function resolveBenchmarkTargetContext(
  repoRoot: string,
  targetId: string,
): Promise<ResolvedBenchmarkTargetContext> {
  const catalog = await loadBenchmarkCatalogData(repoRoot);
  const target = resolveBenchmarkTarget(catalog, targetId);
  const suite =
    target.kind === 'suite'
      ? target.suite
      : catalog.suiteMap.get(target.caseDefinition.suiteIds[0] ?? '');

  return {
    caseDefinitions: target.kind === 'suite' ? target.cases : [target.caseDefinition],
    catalog,
    suite,
    target,
  };
}

export function resolveBenchmarkCaseExecutionMode(
  caseDefinition: LoadedBenchmarkCase,
  suite: LoadedBenchmarkSuite | undefined,
  ciSafe: boolean,
): BenchmarkExecutionMode {
  return selectBenchmarkExecutionMode(caseDefinition, suite?.mode, ciSafe);
}
