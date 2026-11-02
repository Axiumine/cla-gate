// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import type { RepositoryChanges, RepositorySnapshot } from './repository-rows.ts';

/** The last entry for each repository id: listing the same id twice must not make one statement touch a row twice. */
export function distinct(repositories: readonly RepositorySnapshot[]): RepositorySnapshot[] {
  return [...new Map(repositories.map((repository) => [repository.githubRepoId, repository])).values()];
}

export interface StoredState {
  readonly full_name: string;
  readonly removed_at: Date | null;
}

/** Splits a batch into the repositories that need a write, and says for each whether it is new or renamed. */
export function classify(
  batch: readonly RepositorySnapshot[],
  stored: ReadonlyMap<number, StoredState>,
): RepositoryChanges & {
  readonly changed: readonly RepositorySnapshot[];
} {
  const added: GithubId[] = [];
  const renamed: GithubId[] = [];
  for (const repository of batch) {
    const row = stored.get(repository.githubRepoId);
    // `undefined` is a repository not stored yet, a date is a removed one: both come (back) as added.
    if (row?.removed_at !== null) {
      added.push(repository.githubRepoId);
    } else if (row.full_name !== repository.fullName) {
      renamed.push(repository.githubRepoId);
    }
  }
  const touched = new Set<number>([...added, ...renamed]);
  return { added, renamed, changed: batch.filter((repository) => touched.has(repository.githubRepoId)) };
}
