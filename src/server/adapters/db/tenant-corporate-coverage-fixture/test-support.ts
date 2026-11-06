// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { findAgreementOfSignature } from '../../../services/corporate-agreement-of-signature.ts';
import { listCorporateCoverRows } from '../../../services/corporate-coverage-queries.ts';
import {
  agreementExportBatch,
  approvalExportBatch,
  countAgreementRows,
  countApprovalRows,
} from '../../../services/export/corporate-export-queries.ts';
import { PEOPLE } from '../corporate-fixture/test-support.ts';
import type { Database } from '../schema.ts';
import {
  arrangeFull,
  corporateDocumentOf,
  ownersOfAgreements,
  ownersOfApprovals,
  scoped,
} from '../tenant-corporate-fixture/test-support.ts';
import type { TenantWorld } from '../tenant-fixture/test-support.ts';
import type { TenantQuery } from '../tenant-registry/test-support.ts';
import type { TenantScope } from '../tenant-scope.ts';

// The registry entries (E11-S06) of the statements behind the corporate coverage of E21-S05: the one read that says whom the approvals of a
// repository's corporate document cover when a pull request is evaluated, the lookup of the agreement of a signature that the re-evaluation after a
// revocation starts from, and the two keyset pages of the exports of agreements and approvals. Each entry arranges, for both tenants, a corporate
// document in force with the agreement of the tenant's signer and approvals of every kind (`arrangeFull`), so a call with the tenant's own ids finds rows.

/** The ids of the first `count` rows of a corporate table, those of the tenant of `scope` first, so a count that took in another tenant's row shows it. */
async function firstRowIds(
  db: Kysely<Database>,
  from: {
    readonly table: 'corporate_agreements' | 'corporate_approvals';
    readonly scope: TenantScope;
    readonly count: number;
  },
): Promise<number[]> {
  const { rows } = await sql<{ id: number }>`
    select id from ${sql.table(from.table)}
    order by installation_id = ${from.scope.installationId} desc, id limit ${from.count}`.execute(db);
  return rows.map((row) => row.id);
}

/** The files of the corporate coverage that run a statement over a tenant table, which the registry spreads in. */
export const E21_COVERAGE_TENANT_MODULES = [
  'services/corporate-coverage-queries.ts',
  'services/corporate-agreement-of-signature.ts',
  'services/export/corporate-export-queries.ts',
] as const;

/** The people the coverage read asks about: the employee of the arranged tenant and one nobody approved. */
const ASKED_ABOUT = [PEOPLE.employee, 7999] as const;

/** The numeric id of the corporate signature of the tenant: the consent its agreement rests on. */
async function corporateSignatureOf(db: Kysely<Database>, ids: TenantWorld): Promise<number> {
  const row = await db
    .selectFrom('signatures')
    .select('id')
    .where('installation_id', '=', ids.installationId)
    .where('signer_type', '=', 'corporate')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** The first page of every row the statements of the exports can return: far more than a tenant of the matrix holds. */
const FIRST_PAGE = { afterId: 0, limit: 50 } as const;

/** Every function of the corporate coverage that runs over a tenant table, by module and name. */
export const E21_COVERAGE_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  'services/corporate-coverage-queries.ts': {
    listCorporateCoverRows: scoped({
      takesIds: true,
      activeOnly: false,
      arrange: arrangeFull,
      run: async (db, scope, ids) => {
        const rows = await listCorporateCoverRows(db, scope, {
          documentId: (await corporateDocumentOf(db, ids)).documentId,
          githubIds: ASKED_ABOUT,
        });
        return ownersOfApprovals(
          db,
          rows.map((row) => row.approvalId),
        );
      },
    }),
  },
  'services/corporate-agreement-of-signature.ts': {
    findAgreementOfSignature: scoped({
      takesIds: true,
      activeOnly: false,
      arrange: arrangeFull,
      run: async (db, scope, ids) => {
        const agreementId = await findAgreementOfSignature(db, scope, await corporateSignatureOf(db, ids));
        return agreementId === null ? [] : ownersOfAgreements(db, [agreementId]);
      },
    }),
  },
  'services/export/corporate-export-queries.ts': {
    // A count has no owner to read again, so the run takes as many rows as it counted, those of the tenant first: a count that took in a
    // row of the other tenant shows that tenant as an owner.
    countAgreementRows: scoped({
      takesIds: false,
      activeOnly: false,
      arrange: arrangeFull,
      run: async (db, scope) =>
        ownersOfAgreements(
          db,
          await firstRowIds(db, { table: 'corporate_agreements', scope, count: await countAgreementRows(db, scope) }),
        ),
    }),
    countApprovalRows: scoped({
      takesIds: false,
      activeOnly: false,
      arrange: arrangeFull,
      run: async (db, scope) =>
        ownersOfApprovals(
          db,
          await firstRowIds(db, { table: 'corporate_approvals', scope, count: await countApprovalRows(db, scope) }),
        ),
    }),
    agreementExportBatch: scoped({
      takesIds: false,
      activeOnly: false,
      arrange: arrangeFull,
      run: async (db, scope) => {
        const rows = await agreementExportBatch(db, scope, FIRST_PAGE);
        return ownersOfAgreements(
          db,
          rows.map((row) => row.agreementId),
        );
      },
    }),
    approvalExportBatch: scoped({
      takesIds: false,
      activeOnly: false,
      arrange: arrangeFull,
      run: async (db, scope) =>
        ownersOfApprovals(
          db,
          (await approvalExportBatch(db, scope, FIRST_PAGE)).map((row) => row.approvalId),
        ),
    }),
  },
};
