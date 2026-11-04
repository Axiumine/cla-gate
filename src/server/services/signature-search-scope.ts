// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import { findDocumentPlacement } from './document-placement.ts';
import { mapConcurrently } from './map-concurrently.ts';
import type { RoleViewer } from './org-admin.ts';
import { PROBE_BUDGETS } from './probe-budget.ts';
import type { ListedFor } from './repository-list.ts';
import type { CachedRepoAdminLookup } from './role-lookups.ts';
import {
  documentsOfRepositories,
  findRepositoryOfDocument,
  repositoriesWithSignedDocuments,
  type ScopeRepository,
} from './signature-search-scope-queries.ts';

// Which documents the signatures of a search may come from (E15-S02). Authorisation is by document, the role matrix of E11-S07: an org
// admin reaches every document of the installation; a viewer who is only a repository admin reaches the documents scoped to a
// repository they administer, which GitHub confirms through the cached lookup of E11-S04, for at most 50 repositories a request. A
// document that is not in the tenant, and one that is not in the viewer's set, are the same answer: none.

/** How many repositories are asked about at once. */
const LOOKUP_CONCURRENCY = 5;

export interface SearchScopeDeps {
  readonly db: Kysely<Database>;
  /** The permission lookup with the role cache in front of it (E11-S04): a repository asked about a moment ago costs nothing. */
  readonly lookup: CachedRepoAdminLookup;
}

/**
 * The documents a search may take its signatures from. `documentIds` is `null` for every document of the tenant (an org admin
 * who named none), else the ids, which can be empty. `truncated` is true when more repositories had signatures than were asked about.
 */
export interface DocumentScope {
  readonly documentIds: readonly number[] | null;
  readonly truncated: boolean;
}

/** The repositories among `repositories` that the viewer administers, as the cached lookup says. */
async function administered(
  deps: SearchScopeDeps,
  listedFor: ListedFor,
  viewer: RoleViewer,
  repositories: readonly ScopeRepository[],
): Promise<ScopeRepository[]> {
  const verdicts = await mapConcurrently(repositories, LOOKUP_CONCURRENCY, async (repository) => ({
    repository,
    administers: await deps.lookup(
      { id: listedFor.installationId, github_installation_id: repository.githubInstallationId },
      { github_repo_id: repository.githubRepoId, full_name: repository.fullName, removed_at: null },
      viewer,
    ),
  }));
  return verdicts.filter(({ administers }) => administers).map(({ repository }) => repository);
}

/** The scope of a repository admin who named a document: that document when it is scoped to a repository they administer, else none. */
async function namedDocumentOfRepoAdmin(
  deps: SearchScopeDeps,
  listedFor: ListedFor,
  viewer: RoleViewer,
  documentId: number,
): Promise<DocumentScope | null> {
  const repository = await findRepositoryOfDocument(deps.db, listedFor, documentId);
  if (repository === undefined) {
    return null;
  }
  const [confirmed] = await administered(deps, listedFor, viewer, [repository]);
  return confirmed === undefined ? null : { documentIds: [documentId], truncated: false };
}

/** The scope of a repository admin who named no document: the documents of the first 50 repositories with signatures that they administer. */
async function documentsOfRepoAdmin(
  deps: SearchScopeDeps,
  listedFor: ListedFor,
  viewer: RoleViewer,
): Promise<DocumentScope> {
  const asking = PROBE_BUDGETS.repositoryList;
  const candidates = await repositoriesWithSignedDocuments(deps.db, listedFor, asking + 1);
  const confirmed = await administered(deps, listedFor, viewer, candidates.slice(0, asking));
  const documentIds =
    confirmed.length === 0
      ? []
      : await documentsOfRepositories(
          deps.db,
          listedFor,
          confirmed.map(({ id }) => id),
        );
  return { documentIds, truncated: candidates.length > asking };
}

/**
 * The documents the viewer may search, or `null` when `documentId` is not one of them: not in the tenant, or (for a repository
 * admin) not scoped to a repository they administer. A failing lookup (GitHub down, rate limited, the person over their budget)
 * fails the call, and is never "you administer none".
 * @throws what the role lookups throw for a repository admin: `GitHubUnavailableError`, `GitHubRateLimitedError`,
 * `RoleLookupThrottledError`, `InstallationNotAdmittedError`.
 */
export async function searchableDocuments(
  deps: SearchScopeDeps,
  listedFor: ListedFor,
  viewer: RoleViewer,
  documentId: number | null,
): Promise<DocumentScope | null> {
  if (listedFor.role !== 'org_admin') {
    return documentId === null
      ? documentsOfRepoAdmin(deps, listedFor, viewer)
      : namedDocumentOfRepoAdmin(deps, listedFor, viewer, documentId);
  }
  if (documentId === null) {
    return { documentIds: null, truncated: false };
  }
  const placement = await findDocumentPlacement(deps.db, listedFor, documentId);
  return placement === null ? null : { documentIds: [documentId], truncated: false };
}
