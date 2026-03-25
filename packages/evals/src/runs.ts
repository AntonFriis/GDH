import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveRunDirectory } from '@gdh/artifact-store';
import type { BaselineRef, BenchmarkRun } from '@gdh/domain';
import { BenchmarkRunSchema } from '@gdh/domain';

const benchmarkRunsDirectoryName = 'runs/benchmarks';

function readJsonFile<T>(
  filePath: string,
  parser: { parse(value: unknown): T },
  label: string,
): Promise<T> {
  return readFile(filePath, 'utf8')
    .then((contents) => parser.parse(JSON.parse(contents)))
    .catch((error) => {
      throw new Error(
        `Could not read ${label} from "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
      );
    });
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

export function benchmarkRunsRoot(repoRoot: string): string {
  return resolve(repoRoot, benchmarkRunsDirectoryName);
}

export function benchmarkRunFilePath(repoRoot: string, runId: string): string {
  return resolve(
    resolveRunDirectory(repoRoot, runId, benchmarkRunsRoot(repoRoot)),
    'benchmark.run.json',
  );
}

export function baselineRefFromRun(run: BenchmarkRun, artifactPath: string): BaselineRef {
  return {
    kind: 'benchmark_run',
    id: run.id,
    label: run.id,
    artifactPath,
    benchmarkRunId: run.id,
  };
}

export async function loadBenchmarkRunFromPath(
  filePath: string,
  label: string,
): Promise<BenchmarkRun> {
  return readJsonFile(filePath, BenchmarkRunSchema, label);
}

export async function loadBenchmarkRun(
  repoRoot: string,
  identifier: string,
): Promise<BenchmarkRun> {
  const asPath = resolve(repoRoot, identifier);

  if (await pathExists(asPath)) {
    const targetFilePath = (await stat(asPath)).isDirectory()
      ? resolve(asPath, 'benchmark.run.json')
      : asPath;

    return loadBenchmarkRunFromPath(targetFilePath, 'benchmark run snapshot');
  }

  return loadBenchmarkRunFromPath(
    benchmarkRunFilePath(repoRoot, identifier),
    'benchmark run artifact',
  );
}
