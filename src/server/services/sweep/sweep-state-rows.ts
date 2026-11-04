// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import type { RepositoryScope } from '../close-pr/close-rows.ts';
import { latestEvaluationPerPr } from '../current-evaluation-queries.ts';

// The one column the sweep writes (E15-S01): `pr_state` of the latest rows of a repository, from a complete listing of its open
// pull requests. Every statement filters by the installation, so one tenant never reaches the rows of another.

/** What the sweep read of a repository's open pull requests, and when it began to read. */
export interface ListedPulls {
  /** The numbers of the pull requests GitHub showed as open: all of them, so only a listing that was read whole is given. */
  readonly open: readonly number[];
  /** When the listing began: a row touched after it belongs to a pull request the listing may not have seen, and is left alone. */
  readonly listedAt: Date;
}

/** How many latest rows the correction of the state changed, in each direction. */
export interface StateCorrections {
  readonly closed: number;
  readonly reopened: number;
}

/**
 * Brings `pr_state` in line with a complete listing of the open pull requests of the repository (E15-S01), on the latest row of
 * each pull request (see {@link latestEvaluationPerPr}): a pull request the listing does not show is closed, and the delivery
 * that said so was missed; one it shows is open, and the delivery of its reopening was missed, or a close that ran after a
 * reopen is undone. A row touched after the listing began is not closed, because the pull request may have been opened since.
 * It never touches `updated_at`. Call it only with a listing that was read to its last page.
 * @returns the rows changed in each direction.
 */
export async function reconcilePullRequestStates(
  db: Kysely<Database>,
  scope: RepositoryScope,
  listing: ListedPulls,
): Promise<StateCorrections> {
  const latest = latestEvaluationPerPr(db, scope.installationId, [scope.repositoryId]).as('latest');
  const missing = await db
    .updateTable('pr_evaluations')
    .set({ pr_state: 'closed' })
    .where('installation_id', '=', scope.installationId)
    .where('pr_state', '=', 'open')
    .where('updated_at', '<=', listing.listedAt)
    .where(
      'id',
      'in',
      db
        .selectFrom(latest)
        .select('latest.id')
        .$if(listing.open.length > 0, (query) => query.where('latest.pr_number', 'not in', listing.open)),
    )
    .returning('id')
    .execute();
  if (listing.open.length === 0) {
    return { closed: missing.length, reopened: 0 };
  }
  const shown = await db
    .updateTable('pr_evaluations')
    .set({ pr_state: 'open' })
    .where('installation_id', '=', scope.installationId)
    .where('pr_state', '=', 'closed')
    .where('id', 'in', db.selectFrom(latest).select('latest.id').where('latest.pr_number', 'in', listing.open))
    .returning('id')
    .execute();
  return { closed: missing.length, reopened: shown.length };
}
