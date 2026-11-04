// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import type { RepositoryScope } from '../close-pr/close-rows.ts';

// The rows of `pr_evaluations` that the `finalise-repository` job (E14-S04) walks. The statement names the installation, so one
// tenant never reaches the rows of another.

/** How many pull requests one page of the walk holds, and so how many `finalise-check` jobs one transaction sends. */
export const FINALISE_BATCH = 50;

/** Where a page of the walk starts and how long it is. */
interface Page {
  /** The pull requests after this number, which is 0 for the first page. */
  readonly after: number;
  readonly limit: number;
}

/**
 * The numbers of the pull requests of the repository whose latest evaluation (the row that changed last, the highest id among
 * rows that changed together) is `in_progress` or `failure`, ascending, one page at a time: the checks a switch-off may leave
 * pending or red. A pull request whose latest row is `success` or `cancelled` is not in it, and neither is one with no row.
 * Nothing is read from GitHub: the page may name pull requests that are closed now, which the job per pull request skips.
 */
export async function unfinishedPullRequests(
  db: Kysely<Database>,
  scope: RepositoryScope,
  page: Page,
): Promise<number[]> {
  const rows = await db
    .selectFrom((latest) =>
      latest
        .selectFrom('pr_evaluations')
        .select(['pr_number', 'result'])
        .distinctOn('pr_number')
        .where('installation_id', '=', scope.installationId)
        .where('repository_id', '=', scope.repositoryId)
        .where('pr_number', '>', page.after)
        .orderBy('pr_number')
        .orderBy('updated_at', 'desc')
        .orderBy('id', 'desc')
        .as('latest'),
    )
    .select('pr_number')
    .where('result', 'in', ['in_progress', 'failure'])
    .orderBy('pr_number')
    .limit(page.limit)
    .execute();
  return rows.map((row) => row.pr_number);
}
