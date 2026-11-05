// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql, type Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { agreementBasisNeedle, approvalBasisNeedle } from '../domain/affected-prs.ts';
import { enqueueAffectedPrs } from './affected-prs.ts';
import { listCorporateRepositoryIds } from './corporate-claim-queries.ts';
import type { JobEnqueuer } from './ports/jobs.ts';

// The evaluations a revoked approval of a corporate agreement asks for (E21-S05), in the transaction of the revocation, as a revoked signature
// asks for them (E15-S03): a green check turns red when the approval that covered its author is gone, without waiting for the next push or
// the scheduled sweep. The open pull requests of the repositories that enforce the corporate document whose latest evaluation succeeded on the
// strength of the approval (or, when a domain or organisation approval was revoked with the approvals derived from it, of the agreement) get
// one `evaluate-pr` job each, above the cap of the E15 pattern one sweep of the repository. Each send is keyed by the approval that was
// revoked, so a retried request sends nothing twice and a later revocation sends again.

/** The approval that was revoked, with the agreement it belongs to and what its revocation took away from others. */
export interface RevokedApprovalChange {
  /** The corporate document of the agreement, which the repositories that enforce it are found by. */
  readonly documentId: number;
  readonly agreementId: number;
  readonly approvalId: number;
  readonly kind: 'user' | 'email_domain' | 'github_org';
  /** How many approvals derived from it were revoked with it (always 0 for a `user` approval). */
  readonly derivedRevoked: number;
}

/**
 * The needle that finds the stored results resting on the revoked approval, or `null` when nothing can rest on it: a `user` approval covers
 * its own person, named by the approval id; a domain or organisation approval covers nobody itself (a person is covered by the approval derived
 * from it), so it matters only when approvals derived from it were revoked, and then the agreement names what the results rest on.
 */
function needleOf(change: RevokedApprovalChange): string | null {
  if (change.kind === 'user') {
    return approvalBasisNeedle(change.approvalId);
  }
  return change.derivedRevoked > 0 ? agreementBasisNeedle(change.agreementId) : null;
}

/**
 * Sends the jobs that evaluate again the open pull requests the revoked approval covered, on the connection of `trx`, so the revocation and its
 * jobs commit or roll back together. GitHub is asked nothing: a job reads the pull request when it runs.
 * @returns how many jobs were asked for.
 * @throws Error whatever the enqueuer rejects with; the caller's transaction is rolled back, and the revocation with it.
 */
export async function reevaluateAfterApprovalRevocation(
  trx: Transaction<Database>,
  enqueuer: JobEnqueuer,
  scope: TenantScope,
  change: RevokedApprovalChange,
): Promise<number> {
  const needle = needleOf(change);
  if (needle === null) {
    return 0;
  }
  return enqueueAffectedPrs(trx, enqueuer, scope, {
    repositoryIds: await listCorporateRepositoryIds(trx, scope, change.documentId),
    result: 'success',
    detailsMatch: (details) => sql<boolean>`${details} @> ${needle}::jsonb`,
    action: { reason: 'corporate_approval_revoked', change: String(change.approvalId) },
    trigger: 'signature',
  });
}
