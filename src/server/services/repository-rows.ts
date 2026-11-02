// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Selectable } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';

/** One stored repository of an installation. */
export type RepositoryRow = Selectable<Database['repositories']>;

/** What GitHub lists for an installation: the id and the current name (a display snapshot). */
export interface RepositorySnapshot {
  readonly githubRepoId: GithubId;
  readonly fullName: string;
}

/** What {@link upsertRepositories} changed. A repository that was already stored as it is listed appears in neither. */
export interface RepositoryChanges {
  /** Inserted (with `enabled = false`), or listed again after having been removed. */
  readonly added: readonly GithubId[];
  /** Active before and after, with a new `full_name` (a rename, or a new owner after a transfer). */
  readonly renamed: readonly GithubId[];
}

/**
 * Rows per statement, so a 2,500-repository sync is one transaction of 5 batched statements and not 5,000 inserts.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const REPOSITORY_BATCH_SIZE = 500;

export function* batches<T>(items: readonly T[]): Generator<readonly T[]> {
  for (let start = 0; start < items.length; start += REPOSITORY_BATCH_SIZE) {
    yield items.slice(start, start + REPOSITORY_BATCH_SIZE);
  }
}
