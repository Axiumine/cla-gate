// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { RevokeReason } from './signature-revoke-queries.ts';

// The two statements of invalidating a major of a document (E15-S04). Each names the installation next to the document, so a document
// of another tenant finds no signature. `signatures` is append-only: a trigger refuses every update but the one that sets the three
// revocation columns on a row that has none, and the runtime role holds the privilege to update only those three columns, so the
// invalidation of a major is a revocation of every signature of it that is still in force, and nothing here can undo one.

/** What the signatures of one major of one document are asked: the document is of the tenant, the major is a version number of it. */
export interface MajorOfDocument {
  readonly documentId: number;
  readonly major: number;
}

/** What an invalidation writes on each signature: the person who invalidates (`users.id`) and the reason code. */
export interface Invalidation extends MajorOfDocument {
  readonly revokedBy: number;
  readonly reason: RevokeReason;
}

/** What the one statement of an invalidation came to: the signatures it took out of force, and the instant the database stamped on all of them. */
export interface Invalidated {
  readonly count: number;
  /** `null` when no signature was in force. */
  readonly revokedAt: Date | null;
}

/** How many signatures of the major of the document are in force: not revoked, whatever the version of the major they signed. */
export async function countActiveSignatures(
  db: Kysely<Database>,
  scope: TenantScope,
  target: MajorOfDocument,
): Promise<number> {
  const row = await db
    .selectFrom('signatures')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('installation_id', '=', scope.installationId)
    .where('document_id', '=', target.documentId)
    .where('major', '=', target.major)
    .where('revoked_at', 'is', null)
    .executeTakeFirstOrThrow();
  return row.count;
}

/**
 * Sets the three revocation columns of every signature of the major of the document that is in force, in one statement, the time
 * being the database's, so that all of them carry the instant of the transaction. The predicate `revoked_at is null` is read again
 * after a row lock: a signature that a simultaneous revocation holds is revoked by that one and skipped here, and is not in the count.
 * The statement is an `update` inside a `with`, so that the count and the instant come back without a row for each signature.
 */
export async function invalidateActiveSignatures(
  db: Kysely<Database>,
  scope: TenantScope,
  invalidation: Invalidation,
): Promise<Invalidated> {
  const row = await db
    .with('invalidated', (changed) =>
      changed
        .updateTable('signatures')
        .set({ revoked_at: sql<Date>`now()`, revoked_by: invalidation.revokedBy, revoke_reason: invalidation.reason })
        .where('installation_id', '=', scope.installationId)
        .where('document_id', '=', invalidation.documentId)
        .where('major', '=', invalidation.major)
        .where('revoked_at', 'is', null)
        .returning('revoked_at'),
    )
    .selectFrom('invalidated')
    .select([sql<number>`count(*)::int`.as('count'), sql<Date | null>`min(revoked_at)`.as('revokedAt')])
    .executeTakeFirstOrThrow();
  return { count: row.count, revokedAt: row.revokedAt };
}
