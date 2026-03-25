import { type ArtifactStore, createArtifactStore } from '@gdh/artifact-store';
import type { BenchmarkRun, ComparisonReport, RegressionResult } from '@gdh/domain';
import { BenchmarkRunSchema } from '@gdh/domain';
import { benchmarkRunsRoot } from '../runs.js';

export function createBenchmarkArtifactStore(repoRoot: string, runId: string): ArtifactStore {
  return createArtifactStore({
    repoRoot,
    runId,
    runsRoot: benchmarkRunsRoot(repoRoot),
  });
}

export async function persistBenchmarkRun(
  artifactStore: ArtifactStore,
  benchmarkRun: BenchmarkRun,
): Promise<void> {
  await artifactStore.writeJsonArtifact(
    'benchmark-run',
    'benchmark.run.json',
    benchmarkRun,
    'Persisted benchmark run state, scores, and case results.',
  );
}

export async function persistComparisonArtifacts(
  artifactStore: ArtifactStore,
  benchmarkRun: BenchmarkRun,
  comparisonReport: ComparisonReport,
  regressionResult?: RegressionResult,
): Promise<BenchmarkRun> {
  const comparisonArtifact = await artifactStore.writeJsonArtifact(
    'benchmark-comparison',
    'comparison.report.json',
    comparisonReport,
    'Comparison report for the benchmark run.',
  );
  let regressionResultPath: string | undefined;

  if (regressionResult) {
    const regressionArtifact = await artifactStore.writeJsonArtifact(
      'benchmark-regression',
      'regression.result.json',
      regressionResult,
      'Regression result for the benchmark run comparison.',
    );
    regressionResultPath = regressionArtifact.path;
  }

  return BenchmarkRunSchema.parse({
    ...benchmarkRun,
    comparisonReportPath: comparisonArtifact.path,
    regressionResultPath,
  });
}
