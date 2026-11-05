// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { pendingOf } from './pending-prs-current.ts';
import { fromPosition, type PendingRead, UPDATED_AT_MICROS } from './pending-prs-position.ts';
import { SERVED } from './pending-prs-served.ts';

// The statements behind the list of pending pull requests (E15-S07). Each starts from the latest evaluation of every pull request
// (E15-S01), named with the installation, and filters on the outer query as that function asks: the newest row of a pull request
// decides, never an older head SHA that failed. Only open pull requests whose latest row is a failure are pending; the repository must be
// enabled and not removed, and the installation admitted, not suspended and not uninstalled (pending-prs-served.ts). Nothing here
// writes, and nothing asks GitHub.

/**
 * The pending pull requests of the repositories `read.repositoryIds`, most recently written first (`updated_at desc, id desc`), from
 * `read.from` on (that row included) and one more than the page holds: that row is where the next page starts, and without it there is
 * none. Each comes with its repository's name. The caller has seen that `read.repositoryIds` is not empty.
 */
export function pendingRows(db: Kysely<Database>, scope: TenantScope, read: PendingRead) {
  const pending = pendingOf(db, scope, read.repositoryIds, read.reason)
    .innerJoin('repositories as r', (join) =>
      join.onRef('r.id', '=', 'latest.repository_id').onRef('r.installation_id', '=', 'latest.installation_id'),
    )
    .innerJoin('installations as i', 'i.id', 'r.installation_id')
    .where(SERVED)
    .select([
      'latest.id',
      'latest.repository_id',
      'r.full_name',
      'latest.pr_number',
      'latest.head_sha',
      'latest.updated_at',
      'latest.check_run_id',
      'latest.details',
    ])
    .select(UPDATED_AT_MICROS);
  const { from } = read;
  return (from === null ? pending : pending.where(fromPosition(from)))
    .orderBy('latest.updated_at', 'desc')
    .orderBy('latest.id', 'desc')
    .limit(read.limit + 1)
    .execute();
}

/** One row of {@link pendingRows}. */
export type PendingRow = Awaited<ReturnType<typeof pendingRows>>[number];
