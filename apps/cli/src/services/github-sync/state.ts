import type { RunGithubState } from '@gdh/domain';
import { createIsoTimestamp } from '@gdh/shared';

export function mergeGithubState(
  github: RunGithubState | undefined,
  patch: Partial<RunGithubState>,
): RunGithubState {
  const iterationRequestPaths = patch.iterationRequestPaths ?? github?.iterationRequestPaths ?? [];

  return {
    ...github,
    ...patch,
    iterationRequestPaths,
    updatedAt: createIsoTimestamp(),
  };
}
