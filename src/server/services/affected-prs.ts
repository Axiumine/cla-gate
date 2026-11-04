// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { affectedEvaluationKey, affectedSweepKey, MAX_AFFECTED_PULL_REQUESTS } from '../domain/affected-prs.ts';
import type { SweepRepositoryReason } from '../domain/repository-jobs.ts';
import { type AffectedFilter, findAffectedPrs, findAffectedRepositories } from './affected-prs-queries.ts';
import type { JobEnqueuer } from './ports/jobs.ts';
import { enqueueSweepRepository } from './repository-job-enqueue.ts';

// The re-evaluation an action of a maintainer asks for (E15-S03, shared with E15-S05 and E15-S06). A revoked signature can turn a
// green check red, an override added a red one green, an override removed a green one red: the open pull requests that action can
// change are evaluated again, on the connection of the transaction that records the action, so the action and its jobs commit or
// roll back together. Only open pull requests are touched (`pr_state`, E15-S01), found by the latest evaluation of each, and GitHub
// is asked nothing here: the jobs read the pull request when they run.

/** What an action asks to have evaluated again. */
export interface AffectedPrs extends AffectedFilter {
  /** `repositories.id` of the repositories to look at: the ones that enforce the document of a signature, the one an override is for. */
  readonly repositoryIds: readonly number[];
  /** Why the jobs exist (the log and the audit trail of the action) and what names this one action in their keys: `signature_revoked` and the signature id. */
  readonly action: { readonly reason: SweepRepositoryReason; readonly change: string };
  /** The trigger the `evaluate-pr` jobs carry. */
  readonly trigger: 'signature' | 'policy_change';
}

/**
 * Sends the jobs that evaluate the pull requests of `affected` again, in the transaction `trx` that holds the action: one
 * `evaluate-pr` job for each open pull request whose latest evaluation answers the filter, keyed by the action, the repository and
 * the pull request; above {@link MAX_AFFECTED_PULL_REQUESTS} of them, one `sweep-repository` job for each repository that has such a
 * pull request instead (coalesced per repository while a run waits, so a send that finds a run waiting counts as sent: that run
 * covers it).
 * @returns how many jobs were asked for.
 * @throws Error whatever the enqueuer rejects with; the caller's transaction is rolled back, and the action with it.
 */
export async function enqueueAffectedPrs(
  trx: Transaction<Database>,
  enqueuer: JobEnqueuer,
  scope: TenantScope,
  affected: AffectedPrs,
): Promise<number> {
  const { repositoryIds, action, trigger } = affected;
  const found = await findAffectedPrs(trx, scope, repositoryIds, {
    ...affected,
    limit: MAX_AFFECTED_PULL_REQUESTS + 1,
  });
  if (found.length <= MAX_AFFECTED_PULL_REQUESTS) {
    for (const { githubInstallationId, githubRepoId, prNumber } of found) {
      await enqueuer.enqueue(
        trx,
        { type: 'evaluate-pr', githubInstallationId, githubRepoId, prNumber, trigger },
        { idempotencyKey: affectedEvaluationKey(action, githubRepoId, prNumber) },
      );
    }
    return found.length;
  }
  const swept = await findAffectedRepositories(trx, scope, repositoryIds, affected);
  for (const { githubInstallationId, githubRepoId } of swept) {
    await enqueueSweepRepository(trx, enqueuer, {
      githubInstallationId,
      githubRepoId,
      reason: action.reason,
      idempotencyKey: affectedSweepKey(action, githubRepoId),
    });
  }
  return swept.length;
}
