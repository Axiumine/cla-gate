// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { GithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import type { TenantScope } from '../../adapters/db/tenant-scope.ts';
import { appendAudit } from '../audit.ts';
import { countAgreementRows, countApprovalRows } from './corporate-export-queries.ts';

// The record a corporate export leaves before its first byte (E21), as the export of the signatures does (E16-S03).

/** Which file: the agreements of the tenant, or the approvals of all of them. */
export type CorporateExportKind = 'agreements' | 'approvals';

/**
 * Counts the rows of the file of `kind` and appends the audit row that says how many, in one transaction that is committed before this
 * returns: the record exists before a byte of the file does, so a download that is cut short or fails is on record too. The count is the
 * number of rows when the export began; the file is read from a snapshot taken right after. The audit row names the tenant, the person
 * and the count, and no login, company or domain.
 * @returns the number of rows counted.
 */
export async function recordCorporateExport(
  db: Kysely<Database>,
  scope: TenantScope,
  kind: CorporateExportKind,
  actor: GithubId,
): Promise<number> {
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (trx) => {
      const rowCount =
        kind === 'agreements' ? await countAgreementRows(trx, scope) : await countApprovalRows(trx, scope);
      await appendAudit(trx, {
        action: kind === 'agreements' ? 'corporate_agreements.exported' : 'corporate_approvals.exported',
        installationId: scope.installationId,
        actorGithubId: actor,
        metadata: { row_count: rowCount },
      });
      return rowCount;
    });
}
