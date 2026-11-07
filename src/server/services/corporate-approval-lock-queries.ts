// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The lock every change of the approvals of a corporate agreement takes first (E21-S03). The read carries the installation id.

/**
 * The signature of the agreement, locked until the end of the caller's transaction (`select ... for update`): the lock every change of
 * the approvals of one agreement takes, which makes two of them wait for each other and makes the revocation of the agreement (the update
 * of its signature, E15-S03) wait for them or be seen by them. The runtime role may take it: it holds the update privilege on the
 * revocation columns of `signatures`. The read carries the installation id.
 * @returns when the signature was revoked, or `null`.
 * @throws NoResultError when the tenant has no such signature (the caller has just read it).
 */
export async function lockAgreementSignature(
  db: Kysely<Database>,
  scope: TenantScope,
  signatureId: number,
): Promise<Date | null> {
  const row = await db
    .selectFrom('signatures')
    .select('revoked_at')
    .where('installation_id', '=', scope.installationId)
    .where('id', '=', signatureId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  return row.revoked_at;
}
