import { readFile } from 'node:fs/promises';
import type { ThresholdPolicy } from '@gdh/domain';
import { defaultThresholdPolicy, mergeThresholdPolicy } from './scoring.js';

export interface LoadedBenchmarkConfig {
  path: string;
  thresholds: ThresholdPolicy;
}

export async function loadBenchmarkConfig(
  repoRoot: string,
  configPath = `${repoRoot}/gdh.config.json`,
): Promise<LoadedBenchmarkConfig> {
  try {
    const raw = JSON.parse(await readFile(configPath, 'utf8')) as {
      benchmark?: {
        thresholds?: Partial<ThresholdPolicy>;
      };
    };

    return {
      path: configPath,
      thresholds: mergeThresholdPolicy(defaultThresholdPolicy, raw.benchmark?.thresholds),
    };
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;

    if (fileError.code === 'ENOENT') {
      return {
        path: configPath,
        thresholds: defaultThresholdPolicy,
      };
    }

    throw new Error(
      `Could not load benchmark config from "${configPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
