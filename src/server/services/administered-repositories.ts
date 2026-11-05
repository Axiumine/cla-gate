// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { mapConcurrently } from './map-concurrently.ts';
import type { RoleViewer } from './org-admin.ts';
import type { ListedFor } from './repository-list.ts';
import type { CachedRepoAdminLookup } from './role-lookups.ts';

// Which of some repositories a repository admin administers (E15-S02, E15-S07): the question both the search for signatures and the
// list of pending pull requests ask of the cached role lookup of E11-S04, one repository at a time, a few at once.

/** How many repositories are asked about at once. */
const LOOKUP_CONCURRENCY = 5;

/** A repository as the role lookups need it: its row, GitHub's ids and its name. `githubInstallationId` is only the handle of the lookup. */
export interface LookupRepository {
  readonly id: number;
  readonly githubRepoId: number;
  readonly fullName: string;
  readonly githubInstallationId: number;
}

/**
 * The repositories among `repositories` that the viewer administers, as the cached lookup says, in their order. A failing lookup (GitHub
 * down, rate limited, the person over their budget) fails the call, and is never "you administer none".
 * @throws what the role lookups throw: `GitHubUnavailableError`, `GitHubRateLimitedError`, `RoleLookupThrottledError`,
 * `InstallationNotAdmittedError`.
 */
export async function administeredRepositories<T extends LookupRepository>(
  lookup: CachedRepoAdminLookup,
  listedFor: Pick<ListedFor, 'installationId'>,
  viewer: RoleViewer,
  repositories: readonly T[],
): Promise<T[]> {
  const verdicts = await mapConcurrently(repositories, LOOKUP_CONCURRENCY, async (repository) => ({
    repository,
    administers: await lookup(
      { id: listedFor.installationId, github_installation_id: repository.githubInstallationId },
      { github_repo_id: repository.githubRepoId, full_name: repository.fullName, removed_at: null },
      viewer,
    ),
  }));
  return verdicts.filter(({ administers }) => administers).map(({ repository }) => repository);
}
