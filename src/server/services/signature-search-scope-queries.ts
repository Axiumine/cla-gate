// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// What the scope of the signature search reads (E15-S02): the repositories a repository admin can be found through, and the
// documents scoped to them. Every statement names the installation, so a repository or a document of another tenant is never read.

/** A repository as the role lookups need it: its row, GitHub's ids and its name. `githubInstallationId` is only the handle of the lookup. */
export interface ScopeRepository {
  readonly id: number;
  readonly githubRepoId: number;
  readonly fullName: string;
  readonly githubInstallationId: number;
}

/** The repositories of the tenant that are not removed, with the handle of their installation. */
function repositoriesOf(db: Kysely<Database>, scope: TenantScope) {
  return db
    .selectFrom('repositories as r')
    .innerJoin('installations as i', 'i.id', 'r.installation_id')
    .select([
      'r.id',
      'r.github_repo_id as githubRepoId',
      'r.full_name as fullName',
      'i.github_installation_id as githubInstallationId',
    ])
    .where('r.installation_id', '=', scope.installationId)
    .where('r.removed_at', 'is', null);
}

/**
 * The repository the document `documentId` of the tenant is scoped to, when it is not removed. `undefined` for a document that
 * covers the installation, one of a removed repository, an unknown one and another tenant's: the permission of a person on a
 * repository that is no longer the installation's cannot be checked, so none of them is a document a repository admin reaches.
 */
export function findRepositoryOfDocument(
  db: Kysely<Database>,
  scope: TenantScope,
  documentId: number,
): Promise<ScopeRepository | undefined> {
  return repositoriesOf(db, scope)
    .innerJoin('cla_documents as d', (join) =>
      join.onRef('d.repository_id', '=', 'r.id').onRef('d.installation_id', '=', 'r.installation_id'),
    )
    .where('d.id', '=', documentId)
    .executeTakeFirst();
}

/**
 * Up to `limit` repositories of the tenant, in the order of their id, that carry a repo-scoped document with at least one
 * signature: the only ones a signature of a repository admin's can be found through, and the only ones worth a lookup.
 */
export function repositoriesWithSignedDocuments(
  db: Kysely<Database>,
  scope: TenantScope,
  limit: number,
): Promise<ScopeRepository[]> {
  return repositoriesOf(db, scope)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('cla_documents as d')
          .select('d.id')
          .whereRef('d.repository_id', '=', 'r.id')
          .where('d.installation_id', '=', scope.installationId)
          .where((inner) =>
            inner.exists(
              inner
                .selectFrom('signatures as s')
                .select('s.id')
                .whereRef('s.document_id', '=', 'd.id')
                .where('s.installation_id', '=', scope.installationId),
            ),
          ),
      ),
    )
    .orderBy('r.id')
    .limit(limit)
    .execute();
}

/** The ids of the documents of the tenant that are scoped to one of the repositories. */
export async function documentsOfRepositories(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryIds: readonly number[],
): Promise<number[]> {
  const rows = await db
    .selectFrom('cla_documents')
    .select('id')
    .where('installation_id', '=', scope.installationId)
    .where('repository_id', 'in', repositoryIds)
    .orderBy('id')
    .execute();
  return rows.map((row) => row.id);
}
