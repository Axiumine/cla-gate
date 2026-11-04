// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ownersOfRepositories } from '../tenant-owners/test-support.ts';
import type { ScopedQuery } from '../tenant-registry/test-support.ts';
import { assertRepositoryInTenant, TenantMismatchError } from '../tenant-scope.ts';

// The entry of the registry of the tenant data access (E11-S06) for the scope check itself, kept in a file of its own so that the
// registry stays under the size cap after the merge of E13 and E14. `TENANT_QUERIES` has it under `adapters/db/tenant-scope.ts`.

/** The one export of `adapters/db/tenant-scope.ts` that runs a statement: it turns the repository of another tenant away with an error. */
export const SCOPE_QUERIES: Readonly<Record<string, ScopedQuery>> = {
  assertRepositoryInTenant: {
    kind: 'scoped',
    takesIds: true,
    activeOnly: false,
    refusal: (error) => error instanceof TenantMismatchError,
    run: async (db, scope, ids) => {
      await assertRepositoryInTenant(db, scope, ids.plain.repositoryId);
      return ownersOfRepositories(db, [ids.plain.repositoryId]);
    },
  },
};
