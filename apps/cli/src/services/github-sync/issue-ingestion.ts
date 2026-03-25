import {
  createRunEvent,
  type GithubIssueRef,
  type IssueIngestionResult,
  type Run,
  type RunEventType,
  type RunGithubState,
  type SessionManifest,
  updateSessionManifestRecord,
} from '@gdh/domain';
import { renderGithubIssueSourceMarkdown } from '../../github.js';
import { persistGithubState, persistSessionManifest } from '../run-lifecycle/commit.js';
import type { ArtifactStore } from '../run-lifecycle/types.js';
import { mergeGithubState } from './state.js';

export interface GithubIssueIngestionInput {
  artifactStore: ArtifactStore;
  emitEvent: (type: RunEventType, payload: Record<string, unknown>) => Promise<unknown>;
  githubIssue: GithubIssueRef;
  githubState?: RunGithubState;
  issueIngestionResult: IssueIngestionResult;
  manifest: SessionManifest;
  run: Run;
}

async function emitGithubFailureEvent(
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

export async function ingestGithubIssue(input: GithubIssueIngestionInput): Promise<{
  manifest: SessionManifest;
  run: Run;
}> {
  let run = input.run;
  let manifest = input.manifest;

  try {
    const githubSourceArtifact = await input.artifactStore.writeTextArtifact(
      'github-issue-source',
      'github/issue.source.md',
      renderGithubIssueSourceMarkdown(input.githubIssue),
      'markdown',
      'Materialized GitHub issue snapshot used as the durable run source.',
    );
    const issueIngestionArtifact = await input.artifactStore.writeJsonArtifact(
      'github-issue-ingestion',
      'github/issue.ingestion.json',
      input.issueIngestionResult,
      'Normalized GitHub issue ingestion result for this governed run.',
    );

    const githubState = mergeGithubState(input.githubState, {
      issue: input.githubIssue,
      issueIngestionPath: issueIngestionArtifact.path,
    });
    ({ manifest, run } = await persistGithubState(input.artifactStore, run, manifest, githubState));
    manifest = updateSessionManifestRecord(manifest, {
      artifactPaths: {
        ...manifest.artifactPaths,
        githubIssueSource: githubSourceArtifact.path,
        githubIssueIngestion: issueIngestionArtifact.path,
      },
    });
    await persistSessionManifest(input.artifactStore, manifest);
    await input.emitEvent('github.issue.ingested', {
      artifactPaths: [githubSourceArtifact.path, issueIngestionArtifact.path],
      issueNumber: input.githubIssue.issueNumber,
      repository: input.githubIssue.repo.fullName,
      url: input.githubIssue.url,
    });

    return { manifest, run };
  } catch (error) {
    try {
      await emitGithubFailureEvent(input.artifactStore, input.run.id, 'issue_ingestion', error);
    } catch {
      // Preserve the original issue-ingestion failure if failure-event persistence also breaks.
    }
    throw error;
  }
}
