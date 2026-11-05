// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import { readOwnAgreement, requireManagedAgreement } from './corporate-agreements.ts';
import { auditApprovalAdded, auditedOf } from './corporate-approval-audit.ts';
import { clearExpiredUserApproval } from './corporate-approval-expired.ts';
import { activeApprovalRows } from './corporate-approval-queries.ts';
import { subjectKey } from './corporate-approval-subject.ts';
import { type ApprovalActor, inLockedAgreement, requireRoom } from './corporate-approval-transaction.ts';
import { insertManagerApproval } from './corporate-approval-write-queries.ts';
import { CorporateRuleError } from './corporate-rule-error.ts';

// Carrying the roster over a major bump (E21-S03). When the corporate CLA gets a new major the signatory signs again, which makes a new
// agreement with a roster of one. This copies the manager's own approvals in force from their earlier agreement for the same corporate
// document to the new one, so the roster is not retyped. A copy is a new decision of the same manager: its own row, with its own audit
// row (`corporate_approval.added`, code `carried_over`), under the new agreement. Approvals of source `rule` are not copied (they are
// derived per employee and expire), nor are revoked ones, and an approval the new agreement has in force already is left as it is. A person whose derived approval under the new agreement has expired
// is copied all the same: the expired row is revoked first (see corporate-approval-expired.ts).

/** How many approvals the new agreement got and how many it had already. */
export interface CarryOverResult {
  readonly copied: number;
  readonly skipped: number;
}

/**
 * Copies the approvals of source `manager` in force under the agreement `fromAgreementId` to the agreement `agreementId`. Both are the
 * caller's; the source may have been revoked (the roster of an agreement that ended is still the manager's), the target may not. The
 * source must be of the same corporate document and of an earlier major than the target. All or nothing: the copies together must fit
 * under the limit of the target.
 * @throws CorporateRuleError `not_found` (either agreement is not the caller's), `installation_suspended`, `agreement_revoked` (the
 * target), `validation_failed` (field `fromAgreementId`: the same agreement, another document, or a major that is not earlier) and
 * `approval_limit`.
 */
export async function carryOverApprovals(
  db: Kysely<Database>,
  actor: ApprovalActor,
  at: { readonly agreementId: number; readonly fromAgreementId: number },
): Promise<CarryOverResult> {
  const agreement = await requireManagedAgreement(db, actor.userId, at.agreementId);
  const source = await readOwnAgreement(db, actor.userId, at.fromAgreementId);
  if (source.documentId !== agreement.documentId || source.major >= agreement.major) {
    throw new CorporateRuleError('validation_failed', { field: 'fromAgreementId' });
  }
  return inLockedAgreement(db, { agreement, actor }, async (locked) => {
    const { trx, scope, audit } = locked;
    const wanted = (await activeApprovalRows(trx, scope, source.id)).filter((row) => row.source === 'manager');
    const have = new Set((await activeApprovalRows(trx, scope, agreement.id)).map((row) => subjectKey(row.subject)));
    const fresh = wanted.filter((row) => !have.has(subjectKey(row.subject)));
    await requireRoom(trx, scope, { agreementId: agreement.id, adding: fresh.length });
    for (const row of fresh) {
      if (row.subject.kind === 'user') {
        await clearExpiredUserApproval(locked, {
          agreementId: agreement.id,
          githubId: row.subject.githubId,
          revokedBy: actor.userId,
        });
      }
      const id = await insertManagerApproval(trx, scope, {
        agreementId: agreement.id,
        approvedBy: actor.userId,
        subject: row.subject,
      });
      await auditApprovalAdded(trx, audit('carried_over'), { ...auditedOf(row), id });
    }
    return { copied: fresh.length, skipped: wanted.length - fresh.length };
  });
}
