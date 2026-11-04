// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { withTransaction } from '../adapters/db/transaction.ts';
import { type ErasureCounts, holdsAnythingAbout } from './signer-erasure-counts.ts';
import { ErasureCountChangedError, SignerNotFoundError } from './signer-erasure-errors.ts';

// The erasure of one signer's personal data in one tenant (E16-S04). A person the tenant lists on its allowlist and who never
// signed is erased too (their login snapshot is cleared). The deletion, the scrub of the display snapshots and the
// audit row `signer_pii.erased` are the work of the SQL function `erase_signer_pii` (the only code that may remove a
// `signer_pii` row, and the only writer of that audit row); this module counts what it will remove, calls it for the tenant of
// the scope and holds it to the number the admin confirmed.

/** One erasure asked for: the person, the number of rows the admin confirmed and the admin. */
export interface ErasureRequest {
  /** The numeric GitHub id of the person whose data is erased. */
  readonly githubUserId: GithubId;
  /** The number of `signer_pii` rows the preview showed; the erasure goes ahead only when it deletes exactly that many. */
  readonly expectedRows: number;
  /** The numeric GitHub id of the org admin: the actor of the audit row. */
  readonly actor: GithubId;
}

/**
 * How many signatures the tenant holds for the person, how many rows of personal data are kept for them and how many
 * allowlist entries name them. All are zero for a person the tenant knows nothing of, and for one who signed or was listed in
 * another tenant only: the statements name the installation.
 */
export async function erasureCounts(
  db: Kysely<Database>,
  scope: TenantScope,
  githubUserId: GithubId,
): Promise<ErasureCounts> {
  const row = await db
    .selectFrom('signatures as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .leftJoin('signer_pii as p', 'p.signature_id', 's.id')
    .where('s.installation_id', '=', scope.installationId)
    .where('u.github_id', '=', githubUserId)
    .select([sql<number>`count(*)`.as('signatures'), sql<number>`count(p.signature_id)`.as('signer_pii_rows')])
    .executeTakeFirstOrThrow();
  const entries = await db
    .selectFrom('allowlist_entries')
    .where('installation_id', '=', scope.installationId)
    .where('github_id', '=', githubUserId)
    .select(sql<number>`count(*)`.as('entries'))
    .executeTakeFirstOrThrow();
  return { signatures: row.signatures, signerPiiRows: row.signer_pii_rows, allowlistEntries: entries.entries };
}

/**
 * Erases the personal data the tenant holds for the person, through `erase_signer_pii`, in one transaction (the caller's when
 * `db` is one). The function deletes and counts in the same statement run, so the number it returns is what was removed: when
 * it is not the number the admin confirmed (someone signed, or another admin erased, since the preview) the transaction is
 * rolled back, the audit row included, and nothing has changed.
 * @returns The number of `signer_pii` rows deleted, which is `request.expectedRows`.
 * @throws SignerNotFoundError when the tenant holds nothing about the person: no signature and no allowlist entry.
 * @throws ErasureCountChangedError when the function would delete another number of rows than `request.expectedRows`.
 */
export function eraseSigner(db: Kysely<Database>, scope: TenantScope, request: ErasureRequest): Promise<number> {
  return withTransaction(db, async (trx) => {
    if (!holdsAnythingAbout(await erasureCounts(trx, scope, request.githubUserId))) {
      throw new SignerNotFoundError();
    }
    const { erased } = await trx
      .selectNoFrom(
        sql<number>`erase_signer_pii(${request.githubUserId}, ${request.actor}, ${scope.installationId})`.as('erased'),
      )
      .executeTakeFirstOrThrow();
    if (erased !== request.expectedRows) {
      throw new ErasureCountChangedError();
    }
    return erased;
  });
}
