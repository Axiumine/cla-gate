// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The one statement that reads who a corporate agreement covers when a pull request is evaluated (E21-S05), over the tables of migration 020.
// It names the installation in its WHERE clause, so an approval of another tenant is never read, and it is served by the partial index
// `corporate_approvals (installation_id, agreement_id, kind) where revoked_at is null`. "In force" means neither revoked nor expired, and
// "now" is the clock of the database, as in every other statement of the corporate flow. Only the numeric ids of the people asked about
// come in, and only numeric ids go out: no login, domain or company is read.

/** One approval of kind `user` in force that names one of the people asked about, with the major its agreement was signed under and the one now in force. */
export interface CorporateCoverRow {
  readonly approvalId: number;
  readonly agreementId: number;
  readonly githubId: number;
  readonly agreementMajor: number;
  readonly activeMajor: number;
}

/**
 * The approvals of kind `user` in force for `githubIds` under agreements of the tenant for the corporate document `documentId`, whose
 * signature is not revoked, each with the major of its agreement and the active major of the document, in the order of the person and then
 * of the approval id (so the first row of a person is the one that becomes the basis). One statement however many people are asked about:
 * the ids travel as one array. An agreement of an earlier major is returned too, marked by its major, because it covers nobody but the report
 * tells the person to ask the CLA manager to sign the current version. A document with no active version has no rows to join, and so none come back.
 * @param db the database or the transaction the evaluation reads on.
 * @param scope the tenant; another tenant's agreements and approvals are never read.
 * @param at the corporate document of the repository and the numeric GitHub ids of the people of the pull request.
 */
export async function listCorporateCoverRows(
  db: Kysely<Database>,
  scope: TenantScope,
  at: { readonly documentId: number; readonly githubIds: readonly number[] },
): Promise<CorporateCoverRow[]> {
  return db
    .selectFrom('corporate_approvals as p')
    .innerJoin('corporate_agreements as a', (join) =>
      join.onRef('a.id', '=', 'p.agreement_id').onRef('a.installation_id', '=', 'p.installation_id'),
    )
    .innerJoin('signatures as s', (join) =>
      join.onRef('s.id', '=', 'a.signature_id').onRef('s.installation_id', '=', 'a.installation_id'),
    )
    .innerJoin('cla_documents as d', (join) =>
      join.onRef('d.id', '=', 'a.document_id').onRef('d.installation_id', '=', 'a.installation_id'),
    )
    .innerJoin('cla_versions as v', 'v.id', 'd.active_version_id')
    .select([
      'p.id as approvalId',
      'p.agreement_id as agreementId',
      // A `user` approval always has its numeric id (a check of migration 020), which the column's type cannot say.
      sql<number>`p.subject_github_id`.as('githubId'),
      'a.major as agreementMajor',
      'v.major as activeMajor',
    ])
    .where('p.installation_id', '=', scope.installationId)
    .where('p.kind', '=', 'user')
    .where('p.revoked_at', 'is', null)
    .where((condition) =>
      condition.or([condition('p.expires_at', 'is', null), condition('p.expires_at', '>', sql<Date>`now()`)]),
    )
    .where('s.revoked_at', 'is', null)
    .where('a.document_id', '=', at.documentId)
    .where(sql<boolean>`p.subject_github_id = any(${at.githubIds}::bigint[])`)
    .orderBy('p.subject_github_id')
    .orderBy('p.id')
    .execute();
}
