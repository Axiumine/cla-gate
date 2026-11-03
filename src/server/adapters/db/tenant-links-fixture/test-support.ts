// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import {
  EvaluationRowMissingError,
  findCommentIdForPr,
  findRowsForSha,
  hasNewerHeadRow,
  type LinkKey,
  recordCheckRunId,
  recordCommentId,
} from '../pr-evaluation-links.ts';
import type { Database } from '../schema.ts';
import type { TenantWorld } from '../tenant-fixture/test-support.ts';
import type { Refusal, ScopedQuery } from '../tenant-registry/test-support.ts';
import type { TenantScope } from '../tenant-scope.ts';

// The registry entries (E11-S06) of the statements the reporter runs over `pr_evaluations` (E09-S04). `twoTenants` stores for
// each tenant pull request 9 at two head SHAs (the older row holds a Check Run and a comment, ids that differ per tenant) and
// pull request 10 at the older one, next to pull request 7 at the same SHA in both tenants, so a statement that strays has a row
// of the other tenant to meet. Each entry names the installation that owns every row its call read or changed, found by reading
// the rows again.

/** The pull request and older head SHA the fixture gives a Check Run and a comment. */
const LINKED = { prNumber: 9, headSha: 'e'.repeat(40) } as const;
/** An id no fixture row holds, one for each tenant: the test calls the entry for both tenants in one database. */
const newId = (scope: TenantScope, offset: number): number => 8_100_000_000 + scope.installationId * 10 + offset;

/** The row a write that finds no row of the tenant is turned away with. */
const isRowMissing: Refusal = (error) => error instanceof EvaluationRowMissingError;

const scoped = (options: Pick<ScopedQuery, 'run'> & { readonly refusal?: Refusal }): ScopedQuery => ({
  kind: 'scoped',
  takesIds: true,
  activeOnly: false,
  ...options,
});

/** The key of the older row of pull request 9 in the repository of `ids`. */
const linkedKey = (ids: TenantWorld): LinkKey => ({ repositoryId: ids.plain.repositoryId, ...LINKED });

/** The installation that owns each row of the table with this Check Run id or comment id, found by reading the table. */
async function ownersOfColumn(
  db: Kysely<Database>,
  column: 'check_run_id' | 'comment_id',
  values: readonly number[],
): Promise<number[]> {
  if (values.length === 0) {
    return [];
  }
  const rows = await db.selectFrom('pr_evaluations').select('installation_id').where(column, 'in', values).execute();
  return rows.map((row) => row.installation_id);
}

/** Every function that the reporter's database module exports, by name. */
export const LINK_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, ScopedQuery>>>> = {
  'adapters/db/pr-evaluation-links.ts': {
    recordCheckRunId: scoped({
      refusal: isRowMissing,
      run: async (db, scope, ids) => {
        await recordCheckRunId(db, scope, linkedKey(ids), newId(scope, 1));
        return ownersOfColumn(db, 'check_run_id', [newId(scope, 1)]);
      },
    }),
    recordCommentId: scoped({
      refusal: isRowMissing,
      run: async (db, scope, ids) => {
        await recordCommentId(db, scope, linkedKey(ids), newId(scope, 2));
        return ownersOfColumn(db, 'comment_id', [newId(scope, 2)]);
      },
    }),
    findCommentIdForPr: scoped({
      run: async (db, scope, ids) => {
        const commentId = await findCommentIdForPr(db, scope, ids.plain.repositoryId, LINKED.prNumber);
        return commentId === null ? [] : ownersOfColumn(db, 'comment_id', [commentId]);
      },
    }),
    findRowsForSha: scoped({
      run: async (db, scope, ids) => {
        const rows = await findRowsForSha(db, scope, ids.plain.repositoryId, LINKED.headSha);
        return ownersOfColumn(
          db,
          'check_run_id',
          rows.flatMap((row) => (row.checkRunId === null ? [] : [row.checkRunId])),
        );
      },
    }),
    hasNewerHeadRow: scoped({
      run: async (db, scope, ids) => {
        const newer = await hasNewerHeadRow(db, scope, linkedKey(ids));
        const rows = await db
          .selectFrom('pr_evaluations')
          .select('installation_id')
          .where('repository_id', '=', ids.plain.repositoryId)
          .where('pr_number', '=', LINKED.prNumber)
          .execute();
        return newer ? rows.map((row) => row.installation_id) : [];
      },
    }),
  },
};
