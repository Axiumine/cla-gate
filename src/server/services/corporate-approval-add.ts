// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { ApprovalRequest } from '../../shared/corporate-approvals.ts';
import type { Database } from '../adapters/db/schema.ts';
import { isUniqueViolation } from '../adapters/db/violations.ts';
import { judgeApprovalRequest } from '../domain/corporate-approval-request.ts';
import { requireManagedAgreement } from './corporate-agreements.ts';
import { auditApprovalAdded, auditedOf } from './corporate-approval-audit.ts';
import { clearExpiredUserApproval } from './corporate-approval-expired.ts';
import { type CorporateGitHub, resolveSubject } from './corporate-approval-lookup.ts';
import { getApprovalRow } from './corporate-approval-queries.ts';
import type { ApprovalRow } from './corporate-approval-row.ts';
import { type ApprovalActor, inLockedAgreement, requireRoom } from './corporate-approval-transaction.ts';
import { insertManagerApproval } from './corporate-approval-write-queries.ts';
import { CorporateRuleError } from './corporate-rule-error.ts';

// Adding an approval (E21-S03): the manager names an account, an e-mail domain or an organisation, and from then on the agreement covers
// it. In order: the agreement is the caller's and may be changed (`not_found`, `installation_suspended`, `agreement_revoked`), the request
// is a value that can be one (`validation_failed`, `domain_not_allowed`), GitHub is asked who the login names (`github_user_not_found`,
// `not_a_user`, `github_org_not_found`, `upstream_unavailable`), and then, in one transaction under the lock of the agreement, the limit
// is checked (`approval_limit`), the approval is written with its login snapshot and the audit row. A failure at any step writes nothing.

/** What adding an approval needs: the database, and the GitHub the logins are looked up on. */
export interface ApprovalDeps {
  readonly db: Kysely<Database>;
  readonly github: CorporateGitHub;
}

/**
 * Adds the approval the request asks for under the agreement `agreementId` of the manager. A subject that already has an approval in
 * force under the agreement is the unique violation of `corporate_approvals_active_unique`, mapped to `approval_exists`; a person whose
 * derived approval has expired is approved anew, the expired one being revoked first.
 * @returns the approval as it now stands.
 * @throws CorporateRuleError the rules above.
 */
export async function addApproval(
  deps: ApprovalDeps,
  actor: ApprovalActor,
  at: { readonly agreementId: number; readonly request: ApprovalRequest },
): Promise<ApprovalRow> {
  const { db, github } = deps;
  const agreement = await requireManagedAgreement(db, actor.userId, at.agreementId);
  const judged = judgeApprovalRequest(at.request);
  if (!judged.ok) {
    throw judged.rule === 'validation_failed'
      ? new CorporateRuleError(judged.rule, { field: judged.field })
      : new CorporateRuleError(judged.rule);
  }
  const subject = await resolveSubject(github, agreement.githubInstallationId, judged.subject);
  try {
    return await inLockedAgreement(db, { agreement, actor }, async (locked) => {
      const { trx, scope, audit } = locked;
      await requireRoom(trx, scope, { agreementId: agreement.id, adding: 1 });
      if (subject.kind === 'user') {
        await clearExpiredUserApproval(locked, {
          agreementId: agreement.id,
          githubId: subject.githubId,
          revokedBy: actor.userId,
        });
      }
      const id = await insertManagerApproval(trx, scope, {
        agreementId: agreement.id,
        approvedBy: actor.userId,
        subject,
      });
      const added = await getApprovalRow(trx, scope, { agreementId: agreement.id, approvalId: id });
      await auditApprovalAdded(trx, audit(null), auditedOf(added));
      return added;
    });
  } catch (error) {
    throw isUniqueViolation(error, 'corporate_approvals_active_unique')
      ? new CorporateRuleError('approval_exists')
      : error;
  }
}
