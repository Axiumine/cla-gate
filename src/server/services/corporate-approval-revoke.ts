// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { cleanRevokeReason } from '../../shared/corporate-text.ts';
import type { Database } from '../adapters/db/schema.ts';
import { requireManagedAgreement } from './corporate-agreements.ts';
import { auditApprovalRevoked, auditedOf } from './corporate-approval-audit.ts';
import { findApprovalRow, getApprovalRow } from './corporate-approval-queries.ts';
import { revokeApprovalRow, revokeDerivedRows } from './corporate-approval-revoke-queries.ts';
import type { ApprovalRow } from './corporate-approval-row.ts';
import { type ApprovalActor, inLockedAgreement } from './corporate-approval-transaction.ts';
import { CorporateRuleError } from './corporate-rule-error.ts';

// Revoking an approval (E21-S03). The revocation is prospective: the approval stays as evidence, marked with when, by whom and why, and
// stops covering from now on. Revoking a domain or an organisation approval revokes, in the same transaction, every approval of a person
// that was derived from it by a rule (E21-S04), with one audit row each, so no employee stays covered by a rule that was withdrawn.

/** What the revocation of an approval did: the approval as it now stands and how many approvals derived from it were revoked with it. */
export interface RevokedApproval {
  readonly approval: ApprovalRow;
  readonly derivedRevoked: number;
}

/** The reason to store for what the manager typed: `null` for none, the cleaned text otherwise. @throws CorporateRuleError `validation_failed` (field `reason`). */
function reasonOf(typed: string | undefined): string | null {
  if (typed === undefined) {
    return null;
  }
  const reason = cleanRevokeReason(typed);
  if (reason === null) {
    throw new CorporateRuleError('validation_failed', { field: 'reason' });
  }
  return reason;
}

/**
 * Revokes the approval `approvalId` of the manager's agreement `agreementId`, with the reason the manager typed (1 to 500 characters, no
 * address: it is kept for good).
 * @throws CorporateRuleError `not_found` (the agreement is not the caller's, or has no such approval: the same answer), `installation_suspended`,
 * `agreement_revoked`, `validation_failed` (the reason) and `already_revoked`.
 */
export async function revokeApproval(
  db: Kysely<Database>,
  actor: ApprovalActor,
  at: { readonly agreementId: number; readonly approvalId: number; readonly reason: string | undefined },
): Promise<RevokedApproval> {
  const agreement = await requireManagedAgreement(db, actor.userId, at.agreementId);
  const reason = reasonOf(at.reason);
  return inLockedAgreement(db, { agreement, actor }, async ({ trx, scope, audit }) => {
    const target = { agreementId: agreement.id, approvalId: at.approvalId };
    const approval = await findApprovalRow(trx, scope, target);
    if (approval === null) {
      throw new CorporateRuleError('not_found');
    }
    if (approval.revokedAt !== null) {
      throw new CorporateRuleError('already_revoked');
    }
    await revokeApprovalRow(trx, scope, { ...target, revokedBy: actor.userId, reason });
    await auditApprovalRevoked(trx, audit(null), auditedOf(approval));
    const derived =
      approval.kind === 'user'
        ? []
        : await revokeDerivedRows(trx, scope, {
            agreementId: agreement.id,
            parentId: approval.id,
            revokedBy: actor.userId,
          });
    for (const revoked of derived) {
      await auditApprovalRevoked(trx, audit('parent_revoked'), {
        id: revoked.id,
        kind: 'user',
        githubId: revoked.githubId,
      });
    }
    return { approval: await getApprovalRow(trx, scope, target), derivedRevoked: derived.length };
  });
}
