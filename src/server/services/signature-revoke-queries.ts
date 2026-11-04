// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { z } from 'zod';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { revokeReasonSchema } from '../../shared/signature-revoke.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The two statements of a revocation (E15-S03), called inside its one transaction. Each names the installation next to the signature
// id, so a signature of another tenant is neither read nor changed. `signatures` is append-only: a trigger refuses every update but
// the one that sets the three revocation columns on a row that has none, and the runtime role holds the privilege to update only
// those three columns. Nothing here clears `revoked_at`, and nothing could: the trigger refuses it (migration 001).

/** The facts of a signature that the audit row and the re-evaluation of its revocation need. */
export interface SignatureToRevoke {
  readonly id: number;
  readonly documentId: number;
  readonly versionId: number;
  readonly major: number;
  /** The signer by the numeric GitHub id, which is what a stored result names. */
  readonly signerGithubId: GithubId;
}

/** The reason code of a revocation: a member of the set the database checks. */
export type RevokeReason = z.infer<typeof revokeReasonSchema>;

/** What a revocation writes: the person who revokes (`users.id`) and the reason code. */
export interface Revocation {
  readonly signatureId: number;
  readonly revokedBy: number;
  readonly reason: RevokeReason;
}

/** The signature `signatureId` of the tenant with its signer's GitHub id, revoked or not, or `undefined` when the tenant has none (another tenant's included). */
export async function findSignatureToRevoke(
  db: Kysely<Database>,
  scope: TenantScope,
  signatureId: number,
): Promise<SignatureToRevoke | undefined> {
  const row = await db
    .selectFrom('signatures as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .select(['s.id', 's.document_id', 's.version_id', 's.major', 'u.github_id'])
    .where('s.installation_id', '=', scope.installationId)
    .where('s.id', '=', signatureId)
    .executeTakeFirst();
  return row === undefined
    ? undefined
    : {
        id: row.id,
        documentId: row.document_id,
        versionId: row.version_id,
        major: row.major,
        signerGithubId: parseGithubId(row.github_id),
      };
}

/**
 * Sets the three revocation columns of the signature, the time being the database's, and only while it is not revoked: a signature
 * that is revoked already (also by a simultaneous call, which this statement waits for and then finds revoked) matches no row.
 * @returns the instant the database stamped, or `null` when no row changed.
 */
export async function markSignatureRevoked(
  db: Kysely<Database>,
  scope: TenantScope,
  revocation: Revocation,
): Promise<Date | null> {
  const row = await db
    .updateTable('signatures')
    .set({ revoked_at: sql<Date>`now()`, revoked_by: revocation.revokedBy, revoke_reason: revocation.reason })
    .where('installation_id', '=', scope.installationId)
    .where('id', '=', revocation.signatureId)
    .where('revoked_at', 'is', null)
    .returning('revoked_at')
    .executeTakeFirst();
  return row?.revoked_at ?? null;
}
