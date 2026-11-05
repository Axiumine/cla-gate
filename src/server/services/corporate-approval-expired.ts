// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import { auditApprovalRevoked } from './corporate-approval-audit.ts';
import { revokeApprovalRow } from './corporate-approval-revoke-queries.ts';
import type { AgreementWork } from './corporate-approval-transaction.ts';
import { findUserApproval } from './corporate-claim-queries.ts';

// An approval derived by a rule expires after a year and covers nobody from then on, but while it is not revoked it still holds the one
// place a person has under an agreement (`corporate_approvals_active_unique`). Whoever writes a new approval of the same person under the
// agreement (the person's claim, the manager adding them, the carry-over of a roster) first revokes the expired one, as `expired`, in the
// same transaction and under the lock of the agreement, and audits it as a revocation. Only `user` approvals of source `rule` expire.

/** The expired approval to revoke: the agreement it is under, the approval, the person it is about and who revokes it (`users.id`). */
export interface ExpiredApproval {
  readonly agreementId: number;
  readonly approvalId: number;
  readonly githubId: GithubId;
  readonly revokedBy: number;
}

/** Revokes the expired approval as `expired` and writes the audit row of the revocation, in the transaction of the caller. */
export async function revokeExpiredApproval({ trx, scope, audit }: AgreementWork, at: ExpiredApproval): Promise<void> {
  await revokeApprovalRow(trx, scope, {
    agreementId: at.agreementId,
    approvalId: at.approvalId,
    revokedBy: at.revokedBy,
    reason: 'expired',
  });
  await auditApprovalRevoked(trx, audit('expired'), { id: at.approvalId, kind: 'user', githubId: at.githubId });
}

/**
 * Revokes the `user` approval of the person under the agreement when it has expired and is not revoked, so a new approval can take its
 * place; one that is in force, or none, is left as it is.
 */
export async function clearExpiredUserApproval(
  work: AgreementWork,
  at: { readonly agreementId: number; readonly githubId: GithubId; readonly revokedBy: number },
): Promise<void> {
  const held = await findUserApproval(work.trx, work.scope, at);
  if (held !== null && !held.inForce) {
    await revokeExpiredApproval(work, { ...at, approvalId: held.id });
  }
}
