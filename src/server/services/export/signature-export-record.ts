// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { GithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import type { TenantScope } from '../../adapters/db/tenant-scope.ts';
import { appendAudit } from '../audit.ts';
import type { SignatureFilter } from './signature-filter.ts';
import { countSignatures } from './signature-queries.ts';

// The record an export leaves before its first byte (E16-S03).

/**
 * Counts the signatures of the filter and appends the audit row that says how many, in one transaction that is committed
 * before this returns: the record exists before a byte of the file does, so a download that is cut short or fails is on
 * record too. The audit row names the document, the state asked for and the count, and no name or email.
 */
export async function recordExport(
  db: Kysely<Database>,
  scope: TenantScope,
  filter: SignatureFilter,
  actor: GithubId,
): Promise<number> {
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (trx) => {
      const rowCount = await countSignatures(trx, scope, filter);
      await appendAudit(trx, {
        action: 'signatures.exported',
        installationId: scope.installationId,
        actorGithubId: actor,
        subject: { type: 'document', id: filter.documentId },
        metadata: { state: filter.state, row_count: rowCount },
      });
      return rowCount;
    });
}
