// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { findAffectedPrs, findAffectedRepositories } from '../../../services/affected-prs-queries.ts';
import { insertCommitOverride } from '../../../services/commit-override-queries.ts';
import { countActiveSignatures, invalidateActiveSignatures } from '../../../services/signature-invalidate-queries.ts';
import { findSignatureToRevoke, markSignatureRevoked } from '../../../services/signature-revoke-queries.ts';
import { ownersOfRepositories, ownersOfSignatures } from '../tenant-owners/test-support.ts';
import type { ScopedQuery, TenantQuery } from '../tenant-registry/test-support.ts';
import { isForeignKeyViolation } from '../tenant-registry-allowlist/test-support.ts';
import { SEARCH_TENANT_QUERIES } from '../tenant-search-fixture/test-support.ts';

// The registry entries (E11-S06) of the statements a revocation runs over a tenant table (E15-S03): the signature it reads and sets, and
// the pull requests it finds to evaluate again; and those of the invalidation of a major (E15-S04): the signatures it counts and revokes; and the one that stores a per-commit override (E15-S05). They sit in a file of their own so that the registry stays under the size cap, as the
// entries of the search do (`tenant-search-fixture`). `twoTenants` stores, for each tenant, a signature on its installation-wide
// document and finished evaluations (success) of pull requests 7, 9 and 10 of the plain repository, so a statement that strays has rows to meet.

/** The files of epic E15 that run a statement over a tenant table, which `TENANT_MODULES` spreads in (the file of the registry is at its size cap). */
export const E15_TENANT_MODULES = [
  'services/affected-prs-queries.ts',
  'services/commit-override-queries.ts',
  'services/signature-invalidate-queries.ts',
  'services/signature-revoke-queries.ts',
] as const;

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
  'services/signature-invalidate-queries.ts': {
    // The world stores one signature, at major 1 of the installation-wide document of each tenant: a count that strayed finds it under the other tenant.
    countActiveSignatures: scoped(async (db, scope, ids) => {
      const count = await countActiveSignatures(db, scope, { documentId: ids.documentId, major: 1 });
      return count === 0 ? [] : ownersOfSignatures(db, [ids.signatureId]);
    }),
    invalidateActiveSignatures: scoped(async (db, scope, ids) => {
      const { count } = await invalidateActiveSignatures(db, scope, {
        documentId: ids.documentId,
        major: 1,
        revokedBy: ids.admin.userId,
        reason: 'other',
      });
      return count === 0 ? [] : ownersOfSignatures(db, [ids.signatureId]);
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
  'services/commit-override-queries.ts': {
    // The row names the installation of the scope in its own column, so a repository of another tenant is turned away by the
    // composite foreign key of migration 001 and nothing is stored. The world stores an override of the commit `aaaa…` for each plain repository, so the commit here is another and is new.
    insertCommitOverride: {
      kind: 'scoped',
      takesIds: true,
      activeOnly: false,
      refusal: isForeignKeyViolation,
      run: async (db, scope, ids) => {
        const commitSha = 'b'.repeat(40);
        await db.transaction().execute((trx) =>
          insertCommitOverride(trx, scope, {
            repositoryId: ids.plain.repositoryId,
            commitSha,
            reason: 'Made up for the registry',
            createdBy: ids.admin.userId,
          }),
        );
        const rows = await db
          .selectFrom('commit_overrides')
          .select('installation_id')
          .where('repository_id', '=', ids.plain.repositoryId)
          .where('commit_sha', '=', commitSha)
          .execute();
        return rows.map((row) => row.installation_id);
      },
    },
  },
};

/** The entries of epic E15 for the registry: the search for signatures (E15-S02) and the revocation (E15-S03). */
export const E15_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  ...SEARCH_TENANT_QUERIES,
  ...REVOCATION_TENANT_QUERIES,
};
