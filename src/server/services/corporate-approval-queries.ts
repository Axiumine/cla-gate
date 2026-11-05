// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { type ApprovalRow, readRow } from './corporate-approval-row.ts';
import { whenPresent } from './when-present.ts';

// The statements that read the approvals of a corporate agreement (E21-S03). Every statement names the installation in its WHERE clause,
// and the agreement too, so an approval of another agreement or another tenant is never read. An approval is in force while it is neither
// revoked nor expired; "now" is the clock of the database, the one the count of the agreements list (E21-S02) uses.

/** The approvals of an agreement of a tenant, with the login snapshot, before any filter of a statement. */
function approvalRows(db: Kysely<Database>, scope: TenantScope, agreementId: number) {
  return db
    .selectFrom('corporate_approvals as p')
    .leftJoin('corporate_approval_pii as pii', 'pii.approval_id', 'p.id')
    .select([
      'p.id',
      'p.agreement_id as agreementId',
      'p.kind',
      'p.source',
      'p.subject_github_id as githubId',
      'p.subject_domain as domain',
      'pii.login',
      'p.derived_from_approval_id as derivedFromApprovalId',
      'p.approved_at as approvedAt',
      'p.expires_at as expiresAt',
      'p.revoked_at as revokedAt',
      'p.revoke_reason as revokeReason',
      sql<boolean>`p.expires_at is not null and p.expires_at <= now()`.as('expired'),
    ])
    .where('p.installation_id', '=', scope.installationId)
    .where('p.agreement_id', '=', agreementId);
}

/** The newest approval a page starts at (that one included): a list is ordered by the id of the approval, newest first. */
export interface ApprovalPosition {
  readonly id: number;
}

/**
 * One more row than `limit` of the approvals of the agreement, revoked and expired ones included, newest first, from `from`; the extra
 * row, when there is one, tells the caller that a page follows.
 */
export async function approvalPageRows(
  db: Kysely<Database>,
  scope: TenantScope,
  page: { readonly agreementId: number; readonly limit: number; readonly from: ApprovalPosition | null },
): Promise<ApprovalRow[]> {
  const rows = await whenPresent(approvalRows(db, scope, page.agreementId), page.from, (query, from) =>
    query.where('p.id', '<=', from.id),
  )
    .orderBy('p.id', 'desc')
    .limit(page.limit + 1)
    .execute();
  return rows.map(readRow);
}

/** The approval `approvalId` of the agreement, in whatever state, or `null` when the agreement has none (another agreement's included). */
export async function findApprovalRow(
  db: Kysely<Database>,
  scope: TenantScope,
  at: { readonly agreementId: number; readonly approvalId: number },
): Promise<ApprovalRow | null> {
  const row = await approvalRows(db, scope, at.agreementId).where('p.id', '=', at.approvalId).executeTakeFirst();
  return row === undefined ? null : readRow(row);
}

/**
 * The approval `approvalId` of the agreement, which the caller has just written or locked and so knows is there.
 * @throws NoResultError when the agreement has no such approval (a defect).
 */
export async function getApprovalRow(
  db: Kysely<Database>,
  scope: TenantScope,
  at: { readonly agreementId: number; readonly approvalId: number },
): Promise<ApprovalRow> {
  return readRow(
    await approvalRows(db, scope, at.agreementId).where('p.id', '=', at.approvalId).executeTakeFirstOrThrow(),
  );
}

/** The approvals of the agreement that are in force: not revoked, not expired. At most 500, by the limit of the agreement. */
export async function activeApprovalRows(
  db: Kysely<Database>,
  scope: TenantScope,
  agreementId: number,
): Promise<ApprovalRow[]> {
  const rows = await approvalRows(db, scope, agreementId)
    .where('p.revoked_at', 'is', null)
    .where((condition) =>
      condition.or([condition('p.expires_at', 'is', null), condition('p.expires_at', '>', sql<Date>`now()`)]),
    )
    .orderBy('p.id', 'asc')
    .execute();
  return rows.map(readRow);
}
