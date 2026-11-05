// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { NO_MATCHING_APPROVAL_HINT } from '../../shared/corporate-claims.ts';
import type { Database } from '../adapters/db/schema.ts';
import { auditApprovalDerived, auditApprovalRevoked } from './corporate-approval-audit.ts';
import { revokeApprovalRow } from './corporate-approval-revoke-queries.ts';
import { type AgreementWork, inLockedAgreement } from './corporate-approval-transaction.ts';
import { reevaluateAfterClaim } from './corporate-claim-evaluations.ts';
import type { Claimant, ClaimMatch } from './corporate-claim-match.ts';
import {
  findUserApproval,
  insertDerivedApproval,
  isRuleParentInForce,
  type UserApproval,
} from './corporate-claim-queries.ts';
import { CorporateRuleError } from './corporate-rule-error.ts';
import type { CorporateTarget } from './corporate-target.ts';
import type { JobEnqueuer } from './ports/jobs.ts';

// The write of a claim (E21-S04), in one transaction that holds the lock of the agreement the match is under, the lock the manager's changes
// of its approvals take (E21-S03). What the match read before the lock may have changed in the meantime (the manager revoked the approval it
// rests on, the agreement was revoked, the person claimed in another tab), so it is read again here and the answer is the one of this moment.

/** How long an approval derived by a rule covers the person: a year, after which the person claims again and the rule is held against what the manager approves then. */
const DERIVED_APPROVAL_DAYS = 365;

/** What a claim came to: a rule matched and an approval was written (`covered`), or the person already had one in force (`already_covered`). */
export type ClaimStatus = 'covered' | 'already_covered';

/** The refusal of a claim nothing covers: fixed text, naming no company, the same for every person and repository. */
export function noMatchingApproval(): CorporateRuleError {
  return new CorporateRuleError('no_matching_approval', { hint: NO_MATCHING_APPROVAL_HINT });
}

/** What the write needs: the database, and the queue the evaluations of the person's pull requests are sent to. */
export interface ClaimWriteDeps {
  readonly db: Kysely<Database>;
  readonly enqueuer: JobEnqueuer;
}

/**
 * Revokes the derived approval of the person that has expired, when there is one, and writes the new one the rule derives, with the audit rows.
 * An approval that has expired still holds the place of the new one (one approval that is not revoked for a person and an agreement), so it is
 * revoked first, as `expired`, by the person who claims, and audited as a revocation.
 * @returns the id of the new approval.
 * @throws CorporateRuleError `no_matching_approval` when the match is on the person's own approval, which is not in force, or the approval a
 * rule derives from is not in force any more.
 */
async function deriveApproval(
  { trx, scope, audit }: AgreementWork,
  at: { readonly match: ClaimMatch; readonly claimant: Claimant; readonly expired: UserApproval | null },
): Promise<number> {
  const { match, claimant, expired } = at;
  const agreementId = match.agreement.id;
  if (match.via === 'user' || !(await isRuleParentInForce(trx, scope, { agreementId, approvalId: match.parentId }))) {
    throw noMatchingApproval();
  }
  if (expired !== null) {
    const revocation = { agreementId, approvalId: expired.id, revokedBy: claimant.userId, reason: 'expired' };
    await revokeApprovalRow(trx, scope, revocation);
    await auditApprovalRevoked(trx, audit('expired'), { id: expired.id, kind: 'user', githubId: claimant.githubId });
  }
  const id = await insertDerivedApproval(trx, scope, {
    agreementId,
    parentId: match.parentId,
    githubId: claimant.githubId,
    login: claimant.login,
    lifetimeDays: DERIVED_APPROVAL_DAYS,
  });
  await auditApprovalDerived(trx, audit(null), { id, kind: 'user', githubId: claimant.githubId });
  return id;
}

/**
 * Writes what the match decided, under the lock of its agreement: nothing but the evaluations when the person has an approval in force by now,
 * else the approval the rule derives (see {@link deriveApproval}). The open pull requests of the person are sent to be evaluated again in the
 * same transaction, so a failing send takes the claim back.
 * @throws CorporateRuleError `no_matching_approval` when what the match rests on is gone: the approval was revoked, or the agreement was
 * revoked between the read and the lock.
 */
export async function writeClaim(
  deps: ClaimWriteDeps,
  claim: { readonly target: CorporateTarget; readonly match: ClaimMatch; readonly claimant: Claimant },
): Promise<ClaimStatus> {
  const { target, match, claimant } = claim;
  const agreement = { installationId: target.scope.installationId, signatureId: match.agreement.signatureId };
  try {
    return await inLockedAgreement(deps.db, { agreement, actor: claimant }, async (locked) => {
      const evaluateAgain = (approvalId: number) =>
        reevaluateAfterClaim(locked.trx, deps.enqueuer, locked.scope, {
          documentId: target.document.id,
          githubId: claimant.githubId,
          approvalId,
        });
      const own = await findUserApproval(locked.trx, locked.scope, {
        agreementId: match.agreement.id,
        githubId: claimant.githubId,
      });
      if (own?.inForce === true) {
        await evaluateAgain(own.id);
        return 'already_covered';
      }
      await evaluateAgain(await deriveApproval(locked, { match, claimant, expired: own }));
      return 'covered';
    });
  } catch (error) {
    throw error instanceof CorporateRuleError && error.rule === 'agreement_revoked' ? noMatchingApproval() : error;
  }
}
