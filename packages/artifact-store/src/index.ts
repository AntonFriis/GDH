import type { ArtifactReference } from '@gdh/domain';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const runsTable = sqliteTable('runs', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
});

export const artifactsTable = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  kind: text('kind').notNull(),
  path: text('path').notNull(),
  createdAt: text('created_at').notNull(),
});

export const artifactStoreStack = {
  engine: 'sqlite',
  orm: 'drizzle',
} as const;

export interface ArtifactStore {
  saveArtifact(artifact: ArtifactReference): Promise<void>;
  listArtifacts(runId: string): Promise<ArtifactReference[]>;
}

export function createArtifactStore(): ArtifactStore {
  throw new Error('Phase 0 bootstrap only provides the artifact-store interface.');
}
