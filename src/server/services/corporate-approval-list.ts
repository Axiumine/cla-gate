// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import { readOwnAgreement } from './corporate-agreements.ts';
import { type ApprovalPosition, approvalPageRows } from './corporate-approval-queries.ts';
import type { ApprovalRow } from './corporate-approval-row.ts';

// What the CLA manager reads of the approvals of an agreement (E21-S03): all of them, in force, expired and revoked, a page at a time.
// Reading needs the authority of a manager (the signatory) and nothing else, so a revoked agreement and a suspended tenant are served.

/** A page of approvals: the rows, and where the next page starts (`null` on the last page). */
export interface ApprovalPageOf {
  readonly items: readonly ApprovalRow[];
  readonly next: ApprovalPosition | null;
}

/**
 * One page of the approvals of the agreement `agreementId` of the person (`users.id`), newest first.
 * @throws CorporateRuleError `not_found` for an agreement that does not exist and for one that is somebody else's, which cannot be told apart.
 */
export async function listApprovals(
  db: Kysely<Database>,
  userId: number,
  at: { readonly agreementId: number; readonly limit: number; readonly from: ApprovalPosition | null },
): Promise<ApprovalPageOf> {
  const agreement = await readOwnAgreement(db, userId, at.agreementId);
  const rows = await approvalPageRows(db, { installationId: agreement.installationId }, at);
  const [following] = rows.slice(at.limit);
  return { items: rows.slice(0, at.limit), next: following === undefined ? null : { id: following.id } };
}
