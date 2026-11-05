// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database, PullRequestState } from '../../adapters/db/schema.ts';
import { MAX_STATE_CONFIRMATIONS } from '../../domain/sweep.ts';
import type { RepositoryScope } from '../close-pr/close-rows.ts';
import { latestEvaluationPerPr } from '../current-evaluation-queries.ts';

// The one column the sweep writes (E15-S01): `pr_state` of the latest rows of a repository, from a complete listing of its open
// pull requests. The listing is read page by page while pull requests close and open, so a pull request that closed after a
// page was read shifts the next one by one and an open pull request can be left out of the listing, and one that closed after
// the listing can still be in it: the listing only names the rows worth asking about, and GitHub is asked about each of them
// before a row is changed. Every statement filters by the installation, so one tenant never reaches the rows of another.

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

/** Whether GitHub shows the pull request open now: asked once for each row the correction would change, never from the listing. */
export type ConfirmOpen = (prNumber: number) => Promise<boolean>;

/** The latest row of each pull request of the repository, as a query to select from (see {@link latestEvaluationPerPr}). */
const latestOf = (db: Kysely<Database>, scope: RepositoryScope) =>
  latestEvaluationPerPr(db, scope.installationId, [scope.repositoryId]).as('latest');

/** The other state: what the rows have that a correction to `state` is about. */
const otherThan = (state: PullRequestState): PullRequestState => (state === 'open' ? 'closed' : 'open');

/**
 * The pull requests whose latest row holds the state opposite to `to` and which the listing contradicts, the ones touched last
 * first and at most {@link MAX_STATE_CONFIRMATIONS}: for `closed`, an open row of a pull request the listing does not show, not
 * touched after the listing began; for `open`, a closed row of a pull request the listing shows.
 */
async function contradicted(
  db: Kysely<Database>,
  scope: RepositoryScope,
  listing: ListedPulls,
  to: PullRequestState,
): Promise<number[]> {
  const rows = await db
    .selectFrom(latestOf(db, scope))
    .select('latest.pr_number')
    .where('latest.pr_state', '=', otherThan(to))
    .$if(to === 'closed', (query) => query.where('latest.updated_at', '<=', listing.listedAt))
    .$if(to === 'closed' && listing.open.length > 0, (query) => query.where('latest.pr_number', 'not in', listing.open))
    .$if(to === 'open', (query) => query.where('latest.pr_number', 'in', listing.open))
    .orderBy('latest.updated_at', 'desc')
    .orderBy('latest.id', 'desc')
    .limit(MAX_STATE_CONFIRMATIONS)
    .execute();
  return rows.map((row) => row.pr_number);
}

/**
 * Sets `pr_state` to `to` on the latest row of each of the pull requests `prNumbers`, when it holds the other state (and, for
 * `closed`, was not touched after the listing began: a pull request evaluated since is not the one that was asked about).
 * @returns how many rows changed.
 */
async function markLatest(
  db: Kysely<Database>,
  scope: RepositoryScope,
  prNumbers: readonly number[],
  change: { readonly to: PullRequestState; readonly listedAt: Date },
): Promise<number> {
  const rows = await db
    .updateTable('pr_evaluations')
    .set({ pr_state: change.to })
    .where('installation_id', '=', scope.installationId)
    .where('pr_state', '=', otherThan(change.to))
    .$if(change.to === 'closed', (query) => query.where('updated_at', '<=', change.listedAt))
    .where(
      'id',
      'in',
      db.selectFrom(latestOf(db, scope)).select('latest.id').where('latest.pr_number', 'in', prNumbers),
    )
    .returning('id')
    .execute();
  return rows.length;
}

/** Moves the latest rows of the pull requests the listing contradicts to `to`, those GitHub confirms, and counts them. */
async function correct(
  db: Kysely<Database>,
  scope: RepositoryScope,
  inputs: { readonly listing: ListedPulls; readonly to: PullRequestState; readonly confirmOpen: ConfirmOpen },
): Promise<number> {
  const { listing, to, confirmOpen } = inputs;
  const confirmed: number[] = [];
  for (const prNumber of await contradicted(db, scope, listing, to)) {
    if ((await confirmOpen(prNumber)) === (to === 'open')) {
      confirmed.push(prNumber);
    }
  }
  return confirmed.length === 0 ? 0 : markLatest(db, scope, confirmed, { to, listedAt: listing.listedAt });
}

/**
 * Brings `pr_state` in line with a complete listing of the open pull requests of the repository (E15-S01), on the latest row of
 * each pull request (see {@link latestEvaluationPerPr}): a pull request the listing does not show is closed, and the delivery
 * that said so was missed; one it shows is open, and the delivery of its reopening was missed, or a close that ran after a
 * reopen is undone. The listing is not trusted alone: it is read over several requests, and a pull request that closed while
 * its pages were read shifts the next page and is left out of it open, and one that closed after it is still in it. A row changes
 * only when `confirmOpen` says GitHub shows its pull request in the state the row would take, and at most
 * {@link MAX_STATE_CONFIRMATIONS} pull requests are asked about in each direction in one run (the ones touched last first), the
 * rest wait for the next sweep. A row touched after the listing began is not closed. It never touches `updated_at`. Call it only
 * with a listing that was read to its last page.
 * @throws whatever `confirmOpen` throws, before the rows of the direction it was asked for are changed.
 * @returns the rows changed in each direction.
 */
export async function reconcilePullRequestStates(
  db: Kysely<Database>,
  scope: RepositoryScope,
  listing: ListedPulls,
  confirmOpen: ConfirmOpen,
): Promise<StateCorrections> {
  const closed = await correct(db, scope, { listing, to: 'closed', confirmOpen });
  const reopened = listing.open.length === 0 ? 0 : await correct(db, scope, { listing, to: 'open', confirmOpen });
  return { closed, reopened };
}
