// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, Transaction } from 'kysely';
import { APPROVAL_LIMIT } from '../../shared/corporate-approvals.ts';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import type { AgreementRow } from './corporate-agreement-queries.ts';
import type { ApprovalAuditContext } from './corporate-approval-audit.ts';
import { countActiveApprovals } from './corporate-approval-coverage-queries.ts';
import { lockAgreementSignature } from './corporate-approval-lock-queries.ts';
import { CorporateRuleError } from './corporate-rule-error.ts';

// The frame every change of the approvals of an agreement runs in (E21-S03): one transaction that holds the lock of the agreement, so two
// changes of one agreement are made one after the other, and the revocation of the agreement (E15-S03) is either seen by the change or
// waits for it. The checks made on the agreement before the transaction (it is the caller's, its tenant is served) were made on a
// moment that has passed; the one that can have changed in the meantime, its revocation, is made again under the lock.

/** The person who changes the approvals: the manager, by `users.id` and by the numeric GitHub id. */
export interface ApprovalActor {
  readonly userId: number;
  readonly githubId: GithubId;
}

/** What the work in the transaction is given: the transaction, the tenant, and the context its audit rows are written with. */
export interface AgreementWork {
  readonly trx: Transaction<Database>;
  readonly scope: TenantScope;
  readonly audit: (cause: ApprovalAuditContext['cause']) => ApprovalAuditContext;
}

/**
 * Runs `work` in one transaction with the signature of `agreement` locked, after reading that it is not revoked.
 * @throws CorporateRuleError `agreement_revoked` when the signature was revoked since the agreement was read.
 */
export function inLockedAgreement<T>(
  db: Kysely<Database>,
  change: { readonly agreement: Pick<AgreementRow, 'installationId' | 'signatureId'>; readonly actor: ApprovalActor },
  work: (locked: AgreementWork) => Promise<T>,
): Promise<T> {
  const { agreement, actor } = change;
  const scope: TenantScope = { installationId: agreement.installationId };
  return db.transaction().execute(async (trx) => {
    if ((await lockAgreementSignature(trx, scope, agreement.signatureId)) !== null) {
      throw new CorporateRuleError('agreement_revoked');
    }
    return work({
      trx,
      scope,
      audit: (cause) => ({ scope, actorGithubId: actor.githubId, signatureId: agreement.signatureId, cause }),
    });
  });
}

/**
 * Checks that `adding` more approvals fit under the limit of the agreement, counting the ones in force now. Called under the lock, so the
 * count cannot change before the approvals are written.
 * @throws CorporateRuleError `approval_limit` (with the limit in `details`) when the agreement would have more than 500 in force.
 */
export async function requireRoom(
  trx: Kysely<Database>,
  scope: TenantScope,
  at: { readonly agreementId: number; readonly adding: number },
): Promise<void> {
  if ((await countActiveApprovals(trx, scope, at.agreementId)) + at.adding > APPROVAL_LIMIT) {
    throw new CorporateRuleError('approval_limit', { limit: APPROVAL_LIMIT });
  }
}
