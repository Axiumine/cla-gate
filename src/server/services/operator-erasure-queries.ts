// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { withTransaction } from '../adapters/db/transaction.ts';
import type { Footprint } from '../domain/operator-erasure.ts';

// The two statements of the operator's erasure command (E22-S05). Both meet every tenant by design: a GitHub id is global, and an
// erasure asked of the server as a whole (not of one org admin, which is E16-S04) reaches every installation the person signed
// in. The first only reads, as the runtime role does: the `users` row, the signatures and the `signer_pii` rows of one person,
// counted per installation. The second calls the SQL function `erase_signer_pii` (E16-S04), the one code that may remove a
// `signer_pii` row and the writer of the audit row `signer_pii.erased`; nothing here deletes, updates or inserts a row.

/**
 * What the server holds about the person: whether they have a `users` row, whether its display snapshot is already scrubbed, and
 * per installation the signature cores (revoked ones included) and the `signer_pii` rows. `users.login` is compared with the
 * text the erasure leaves in SQL and never read, so no login reaches the program. An installation in which the person has no
 * signature is not listed.
 */
export async function readSignerFootprint(db: Kysely<Database>, githubId: GithubId): Promise<Footprint> {
  const user = await db
    .selectFrom('users')
    .where('github_id', '=', githubId)
    .select(sql<boolean>`login = 'erased-' || github_id::text`.as('scrubbed'))
    .executeTakeFirst();
  const rows = await db
    .selectFrom('signatures as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .leftJoin('signer_pii as p', 'p.signature_id', 's.id')
    .where('u.github_id', '=', githubId)
    .groupBy('s.installation_id')
    .orderBy('s.installation_id')
    .select([
      's.installation_id',
      sql<number>`count(*)`.as('signatures'),
      sql<number>`count(p.signature_id)`.as('signer_pii_rows'),
    ])
    .execute();
  return {
    known: user !== undefined,
    scrubbed: user?.scrubbed ?? false,
    installations: rows.map((row) => ({
      installationId: row.installation_id,
      signatures: row.signatures,
      signerPiiRows: row.signer_pii_rows,
    })),
  };
}

/**
 * Calls `erase_signer_pii(github id, actor, installation)` in a transaction of its own and answers how many `signer_pii` rows it
 * deleted. The function deletes the person's rows of that installation, writes the audit row `signer_pii.erased` with the
 * installation's id, and scrubs the `users` snapshot and deletes the sessions once the person has no row left anywhere.
 */
export function eraseInInstallation(
  db: Kysely<Database>,
  person: { readonly githubId: GithubId; readonly actor: GithubId },
  installationId: number,
): Promise<number> {
  return withTransaction(db, async (trx) => {
    const { erased } = await trx
      .selectNoFrom(sql<number>`erase_signer_pii(${person.githubId}, ${person.actor}, ${installationId})`.as('erased'))
      .executeTakeFirstOrThrow();
    return erased;
  });
}
