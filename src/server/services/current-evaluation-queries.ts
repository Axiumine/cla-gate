// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import type { Database } from '../adapters/db/schema.ts';

// The one definition of "the latest evaluation of a pull request" (E15-S01), shared by the stories that act on pull requests
// as they stand now: the correction of the open or closed state by the sweep, the re-evaluation after a revocation or an
// override, and the pending-pull-requests view (E15-S03 to E15-S07). The query names the installation, so one tenant never
// reads the rows of another, whatever repository ids it is given.

/**
 * The newest row of each pull request of the repositories `repositoryIds` of the installation, as a query to build on, not to
 * run as it is: it reads every row of those repositories and keeps one per (repository, pull request number). "Newest" is
 * the row touched last, `updated_at` descending and then `id` descending, and not the highest head SHA or the highest id: a pull
 * request that went back to an older head SHA has the upserted older row as its newest, because that upsert set `updated_at`.
 *
 * The filters on `result`, `pr_state`, `details` and the paging belong to the outer query, `db.selectFrom(latestEvaluationPerPr(...).as('latest'))`:
 * a `where` on this query would pick the newest of the rows that pass it, which is another question (an older failing row of a
 * pull request whose newest row passes would be returned). Every column of the row is selected, so the caller reads `latest.*`.
 * No repository id gives a query that finds nothing, and the installation's rows of other repositories are never read.
 * @param db the database, or the transaction the caller reads in.
 * @param installationId `installations.id` of the tenant.
 * @param repositoryIds `repositories.id` of the repositories to read; ids of another installation match no row.
 */
export function latestEvaluationPerPr(
  db: Kysely<Database>,
  installationId: InstallationRowId,
  repositoryIds: readonly number[],
) {
  return db
    .selectFrom('pr_evaluations')
    .selectAll()
    .distinctOn(['repository_id', 'pr_number'])
    .where('installation_id', '=', installationId)
    .where((eb) => (repositoryIds.length === 0 ? eb.lit(false) : eb('repository_id', 'in', repositoryIds)))
    .orderBy('repository_id')
    .orderBy('pr_number')
    .orderBy('updated_at', 'desc')
    .orderBy('id', 'desc');
}
