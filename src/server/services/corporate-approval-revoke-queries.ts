// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';

// The statements that revoke the approvals of a corporate agreement (E21-S03). Every statement names the installation in its WHERE clause. The
// caller runs them inside one transaction with the agreement's signature locked.

/** The revocation of one approval: which, by whom (`users.id`) and why (cleaned text without personal data, or `null`). */
export interface Revocation {
  readonly agreementId: number;
  readonly approvalId: number;
  readonly revokedBy: number;
  readonly reason: string | null;
}

/**
 * Revokes the approval of the agreement of the tenant that is not revoked yet. The time is the clock of the database server at this
 * moment and not the start of the transaction, so a revocation is never earlier than an approval another transaction committed meanwhile.
 * @throws NoResultError when the tenant's agreement has no such approval in force (the caller has just read it under the lock).
 */
export async function revokeApprovalRow(
  db: Kysely<Database>,
  scope: TenantScope,
  revocation: Revocation,
): Promise<void> {
  await db
    .updateTable('corporate_approvals')
    .set({
      revoked_at: sql<Date>`clock_timestamp()`,
      revoked_by: revocation.revokedBy,
      revoke_reason: revocation.reason,
    })
    .where('installation_id', '=', scope.installationId)
    .where('agreement_id', '=', revocation.agreementId)
    .where('id', '=', revocation.approvalId)
    .where('revoked_at', 'is', null)
    .returning('id')
    .executeTakeFirstOrThrow();
}

/** An approval that was revoked with the one it derives from: its id and the account it covered. */
export interface DerivedRevocation {
  readonly id: number;
  readonly githubId: GithubId;
}

/**
 * Revokes, with the same time as {@link revokeApprovalRow}, every approval of source `rule` that derives from the approval `parentId`
 * and is not revoked yet, with no reason of its own: the revocation of its parent is the reason.
 */
export async function revokeDerivedRows(
  db: Kysely<Database>,
  scope: TenantScope,
  derivation: { readonly agreementId: number; readonly parentId: number; readonly revokedBy: number },
): Promise<DerivedRevocation[]> {
  const rows = await db
    .updateTable('corporate_approvals')
    .set({ revoked_at: sql<Date>`clock_timestamp()`, revoked_by: derivation.revokedBy })
    .where('installation_id', '=', scope.installationId)
    .where('agreement_id', '=', derivation.agreementId)
    .where('derived_from_approval_id', '=', derivation.parentId)
    .where('revoked_at', 'is', null)
    .returning(['id', 'subject_github_id'])
    .execute();
  return rows.map((row) => ({ id: row.id, githubId: parseGithubId(row.subject_github_id) }));
}
