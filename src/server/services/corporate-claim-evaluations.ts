// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql, type Transaction } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { uncoveredActorNeedle } from '../domain/signature-evaluations.ts';
import { enqueueAffectedPrs } from './affected-prs.ts';
import { listCorporateRepositoryIds } from './corporate-claim-queries.ts';
import type { JobEnqueuer } from './ports/jobs.ts';

// The evaluations a successful claim asks for (E21-S04), in the transaction of the claim, as a new signature asks for them (E13-S07) and in
// the way a maintainer's action does (E15-S03): a red check turns green when the person is covered, without waiting for the next push or the
// scheduled sweep. The open pull requests of the repositories that enforce the corporate document whose latest evaluation fails and lists
// the person among the uncovered actors, and the ones still being evaluated, get one `evaluate-pr` job each (above the cap of the E15 pattern,
// one sweep of the repository). Each send is keyed by the approval that now covers the person, the repository and the pull request, so a
// retried request sends nothing twice and a later claim sends again.

/**
 * Sends the jobs that evaluate again the open pull requests of the tenant that fail for the person, on the connection of `trx`, so the claim
 * and its jobs commit or roll back together. GitHub is asked nothing: a job reads the pull request when it runs.
 * @returns how many jobs were asked for.
 * @throws Error whatever the enqueuer rejects with; the caller's transaction is rolled back, and the claim with it.
 */
export async function reevaluateAfterClaim(
  trx: Transaction<Database>,
  enqueuer: JobEnqueuer,
  scope: TenantScope,
  claim: { readonly documentId: number; readonly githubId: GithubId; readonly approvalId: number },
): Promise<number> {
  return enqueueAffectedPrs(trx, enqueuer, scope, {
    repositoryIds: await listCorporateRepositoryIds(trx, scope, claim.documentId),
    result: 'failure',
    detailsMatch: (details) => sql<boolean>`${details} @> ${uncoveredActorNeedle(claim.githubId)}::jsonb`,
    action: { reason: 'corporate_claim', change: String(claim.approvalId) },
    trigger: 'signature',
  });
}
