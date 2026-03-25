import { createRunEvent } from '@gdh/domain';
import type { ArtifactStore } from '../run-lifecycle/types.js';

export async function appendGithubSyncFailedEvent(
  artifactStore: ArtifactStore,
  runId: string,
  operation: string,
  error: unknown,
): Promise<void> {
  await artifactStore.appendEvent(
    createRunEvent(runId, 'github.sync.failed', {
      error: error instanceof Error ? error.message : String(error),
      operation,
    }),
  );
}
