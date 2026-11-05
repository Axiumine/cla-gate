// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { withTransaction } from '../adapters/db/transaction.ts';
import type { Footprint, InstallationFootprint } from '../domain/operator-erasure.ts';

// The two statements of the operator's erasure command (E22-S05). Both meet every tenant by design: a GitHub id is global, and an
// erasure asked of the server as a whole (not of one org admin, which is E16-S04) reaches every installation the person signed
// in. The first only reads, as the runtime role does: the `users` row, the signatures and the `signer_pii` rows of one person,
// counted per installation. The second calls the SQL function `erase_signer_pii` (E16-S04), the one code that may remove a
// `signer_pii` row and the writer of the audit row `signer_pii.erased`; nothing here deletes, updates or inserts a row.

/** Whether the person has a `users` row and whether its display snapshot is the text the erasure leaves; the login is never read. */
async function readUserSnapshot(db: Kysely<Database>, githubId: GithubId) {
  return db
    .selectFrom('users')
    .where('github_id', '=', githubId)
    .select(sql<boolean>`login = 'erased-' || github_id::text`.as('scrubbed'))
    .executeTakeFirst();
}

/** Per installation, the signature cores of the person (revoked ones included) and the `signer_pii` rows of those. */
async function readSignatureCounts(db: Kysely<Database>, githubId: GithubId): Promise<InstallationFootprint[]> {
  const rows = await db
    .selectFrom('signatures as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .leftJoin('signer_pii as p', 'p.signature_id', 's.id')
    .where('u.github_id', '=', githubId)
    .groupBy('s.installation_id')
    .select([
      's.installation_id',
      sql<number>`count(*)`.as('signatures'),
      sql<number>`count(p.signature_id)`.as('signer_pii_rows'),
    ])
    .execute();
  return rows.map((row) => ({
    installationId: row.installation_id,
    signatures: row.signatures,
    signerPiiRows: row.signer_pii_rows,
    loginSnapshots: 0,
  }));
}

/** Per installation, how many allowlist entries of the person still show their login; the snapshot itself is never read. */
async function readLoginSnapshotCounts(db: Kysely<Database>, githubId: GithubId): Promise<InstallationFootprint[]> {
  const rows = await db
    .selectFrom('allowlist_entries')
    .where('github_id', '=', githubId)
    .where('login_snapshot', 'is not', null)
    .groupBy('installation_id')
    .select(['installation_id', sql<number>`count(*)`.as('login_snapshots')])
    .execute();
  return rows.map((row) => ({
    installationId: row.installation_id,
    signatures: 0,
    signerPiiRows: 0,
    loginSnapshots: row.login_snapshots,
  }));
}

/** The footprints of both reads as one list, one entry per installation, by installation id. */
function mergedByInstallation(...reads: readonly InstallationFootprint[][]): InstallationFootprint[] {
  const merged = new Map<number, InstallationFootprint>();
  for (const entry of reads.flat()) {
    const known = merged.get(entry.installationId);
    merged.set(entry.installationId, {
      installationId: entry.installationId,
      signatures: (known?.signatures ?? 0) + entry.signatures,
      signerPiiRows: (known?.signerPiiRows ?? 0) + entry.signerPiiRows,
      loginSnapshots: (known?.loginSnapshots ?? 0) + entry.loginSnapshots,
    });
  }
  return [...merged.values()].toSorted((first, second) => first.installationId - second.installationId);
}

/**
 * What the server holds about the person: whether they have a `users` row, whether its display snapshot is already scrubbed, and
 * per installation the signature cores (revoked ones included), the `signer_pii` rows and the allowlist entries that still show
 * their login (`allowlist_entries.login_snapshot`, which the same function clears per installation, so an installation where the
 * person is only allowlisted is listed too). `users.login` is compared with the text the erasure leaves in SQL and never read, and
 * so is the snapshot of an allowlist entry (only counted), so no login reaches the program. An installation in which the person
 * has neither a signature nor such an entry is not listed.
 */
export async function readSignerFootprint(db: Kysely<Database>, githubId: GithubId): Promise<Footprint> {
  const user = await readUserSnapshot(db, githubId);
  return {
    known: user !== undefined,
    scrubbed: user?.scrubbed ?? false,
    installations: mergedByInstallation(
      await readSignatureCounts(db, githubId),
      await readLoginSnapshotCounts(db, githubId),
    ),
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
