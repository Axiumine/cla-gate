// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { countRepositories } from '../../../services/repository-count-queries.ts';
import { listRepositoryEntries } from '../../../services/repository-list-queries.ts';
import type { Database } from '../schema.ts';
import { ownersOfRepositories } from '../tenant-owners/test-support.ts';
import type { ScopedQuery } from '../tenant-registry/test-support.ts';

// The entries of the registry of the tenant data access (E11-S06) for the statements that read the repositories of a tenant for
// its list (E14-S01), kept in a file of their own so that the registry stays under the size cap. `TENANT_QUERIES` has them under
// `services/repository-list-queries.ts` and `services/repository-count-queries.ts`. Both are called for a tenant by the generated test of tenant-queries-matrix.test.ts; they
// take the tenant and no other id, so only the first and the last of its three checks apply.

/** The repositories of the database that are not removed and the ones among them that enforce the CLA, in every tenant, by owner. */
async function liveRepositoriesOf(db: Kysely<Database>, installationId: number) {
  const rows = await db
    .selectFrom('repositories')
    .select(['installation_id', 'enabled'])
    .where('removed_at', 'is', null)
    .execute();
  const owned = rows.filter((row) => row.installation_id === installationId);
  return { repositories: owned.length, enabled: owned.filter((row) => row.enabled).length };
}

/** The read of `repositories` for the list. */
export const LISTING_READS: Readonly<Record<string, ScopedQuery>> = {
  listRepositoryEntries: {
    kind: 'scoped',
    // A list: the tenant is its only argument, so there is no id of another tenant to hand it.
    takesIds: false,
    activeOnly: true,
    run: async (db, scope) => {
      const entries = await listRepositoryEntries(db, scope, {
        limit: 100,
        from: null,
        q: null,
        enabled: null,
        withRepositoryDocument: false,
      });
      return entries.length === 0
        ? []
        : ownersOfRepositories(
            db,
            entries.map((entry) => entry.id),
          );
    },
  },
};

/** The count of `repositories` for the list of installations. */
export const COUNT_READS: Readonly<Record<string, ScopedQuery>> = {
  countRepositories: {
    kind: 'scoped',
    // The counts belong to the tenant they are asked for; there is no repository of another tenant to name.
    takesIds: false,
    activeOnly: false,
    run: async (db, scope) => {
      const counted = await countRepositories(db, scope);
      const owned = await liveRepositoriesOf(db, scope.installationId);
      // A count that strayed into another tenant differs from what the tenant owns: the surplus moves the id to another tenant's.
      const surplus = Math.abs(counted.repositories - owned.repositories) + Math.abs(counted.enabled - owned.enabled);
      return [scope.installationId + surplus];
    },
  },
};
