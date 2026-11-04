// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { findAffectedPrs, findAffectedRepositories } from '../../../services/affected-prs-queries.ts';
import { findSignatureToRevoke, markSignatureRevoked } from '../../../services/signature-revoke-queries.ts';
import { ownersOfRepositories, ownersOfSignatures } from '../tenant-owners/test-support.ts';
import type { ScopedQuery, TenantQuery } from '../tenant-registry/test-support.ts';
import { SEARCH_TENANT_QUERIES } from '../tenant-search-fixture/test-support.ts';

// The registry entries (E11-S06) of the statements a revocation runs over a tenant table (E15-S03): the signature it reads and sets, and
// the pull requests it finds to evaluate again. They sit in a file of their own so that the registry stays under the size cap, as the
// entries of the search do (`tenant-search-fixture`). `twoTenants` stores, for each tenant, a signature on its installation-wide
// document and finished evaluations (success) of pull requests 7, 9 and 10 of the plain repository, so a statement that strays has rows to meet.

/** A function that takes the tenant and the ids of a resource and answers with the rows of that tenant it read or changed. */
const scoped = (run: ScopedQuery['run']): ScopedQuery => ({ kind: 'scoped', takesIds: true, activeOnly: false, run });

/** Every function that the modules of the revocation export over a tenant table, by module and name. */
const REVOCATION_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  'services/affected-prs-queries.ts': {
    findAffectedPrs: scoped(async (db, scope, ids) => {
      const found = await findAffectedPrs(db, scope, [ids.plain.repositoryId], { result: 'success', limit: 10 });
      return found.length === 0
        ? []
        : ownersOfRepositories(
            db,
            found.map((pullRequest) => pullRequest.repositoryId),
          );
    }),
    findAffectedRepositories: scoped(async (db, scope, ids) => {
      const found = await findAffectedRepositories(db, scope, [ids.plain.repositoryId], { result: 'success' });
      return found.length === 0
        ? []
        : ownersOfRepositories(
            db,
            found.map((repository) => repository.repositoryId),
          );
    }),
  },
  'services/signature-revoke-queries.ts': {
    findSignatureToRevoke: scoped(async (db, scope, ids) => {
      const found = await findSignatureToRevoke(db, scope, ids.signatureId);
      return found === undefined ? [] : ownersOfSignatures(db, [found.id]);
    }),
    markSignatureRevoked: scoped(async (db, scope, ids) => {
      const revokedAt = await markSignatureRevoked(db, scope, {
        signatureId: ids.signatureId,
        revokedBy: ids.admin.userId,
        reason: 'other',
      });
      return revokedAt === null ? [] : ownersOfSignatures(db, [ids.signatureId]);
    }),
  },
};

/** The entries of epic E15 for the registry: the search for signatures (E15-S02) and the revocation (E15-S03). */
export const E15_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  ...SEARCH_TENANT_QUERIES,
  ...REVOCATION_TENANT_QUERIES,
};
