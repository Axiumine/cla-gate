// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { pendingOf, repositoriesWithPending } from '../../../services/pending-prs-current.ts';
import { pendingRows } from '../../../services/pending-prs-queries.ts';
import { isRepositoryOfTenant, servedRepositories } from '../../../services/pending-prs-repositories.ts';
import type { Database } from '../schema.ts';
import type { TenantWorld } from '../tenant-fixture/test-support.ts';
import { ownersOfRepositories } from '../tenant-owners/test-support.ts';
import type { ScopedQuery, TenantQuery } from '../tenant-registry/test-support.ts';

// The registry entries (E11-S06) of the statements the list of pending pull requests runs over a tenant table (E15-S07): the repositories
// it may read, whether a repository is the tenant's, which of them have pending pull requests, and the pull requests themselves. They sit
// in a file of their own so that the registry stays under the size cap, as the entries of the search do (`tenant-search-fixture`).

/**
 * Switches on the plain repository of each tenant and gives it a failed evaluation of pull request 20 that is open, which the seed leaves
 * without both: a statement that strays into the other tenant then has a pending pull request to read.
 */
async function pendingPullRequests(db: Kysely<Database>, tenants: readonly TenantWorld[]): Promise<void> {
  for (const tenant of tenants) {
    await db.updateTable('repositories').set({ enabled: true }).where('id', '=', tenant.plain.repositoryId).execute();
    await db
      .insertInto('pr_evaluations')
      .values({
        installation_id: tenant.installationId,
        repository_id: tenant.plain.repositoryId,
        pr_number: 20,
        head_sha: 'd'.repeat(40),
        result: 'failure',
        details: JSON.stringify({ code: 'evaluation_failed' }),
      })
      .execute();
  }
}

/** A function that takes the tenant and the ids of a resource and answers with the rows of that tenant it read. */
const scoped = (options: Pick<ScopedQuery, 'run'> & Partial<ScopedQuery>): ScopedQuery => ({
  kind: 'scoped',
  takesIds: true,
  activeOnly: false,
  arrange: pendingPullRequests,
  ...options,
});

/** Every function that the module of the pending pull requests exports over a tenant table, by module and name. */
export const PENDING_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  'services/pending-prs-repositories.ts': {
    servedRepositories: scoped({
      activeOnly: true,
      run: async (db, scope, ids) => {
        const served = await servedRepositories(db, scope, {
          repositoryId: ids.plain.repositoryId,
          ownDocumentOnly: false,
        });
        return served.length === 0
          ? []
          : ownersOfRepositories(
              db,
              served.map(({ id }) => id),
            );
      },
    }),
    // A repository that is removed is still the tenant's: the answer tells the tenant's repositories from the ones of other tenants.
    isRepositoryOfTenant: scoped({
      run: async (db, scope, ids) =>
        (await isRepositoryOfTenant(db, scope, ids.plain.repositoryId))
          ? ownersOfRepositories(db, [ids.plain.repositoryId])
          : [],
    }),
  },
  'services/pending-prs-current.ts': {
    pendingOf: scoped({
      run: async (db, scope, ids) => {
        const rows = await pendingOf(db, scope, [ids.plain.repositoryId], null)
          .select('latest.repository_id')
          .execute();
        return rows.length === 0
          ? []
          : ownersOfRepositories(
              db,
              rows.map((row) => row.repository_id),
            );
      },
    }),
    repositoriesWithPending: scoped({
      run: async (db, scope, ids) => {
        const found = await repositoriesWithPending(db, scope, [ids.plain.repositoryId], { reason: null, limit: 10 });
        return found.length === 0 ? [] : ownersOfRepositories(db, found);
      },
    }),
  },
  'services/pending-prs-queries.ts': {
    pendingRows: scoped({
      activeOnly: true,
      run: async (db, scope, ids) => {
        const rows = await pendingRows(db, scope, {
          repositoryIds: [ids.plain.repositoryId],
          reason: null,
          limit: 10,
          from: null,
        });
        return rows.length === 0
          ? []
          : ownersOfRepositories(
              db,
              rows.map((row) => row.repository_id),
            );
      },
    }),
  },
};
