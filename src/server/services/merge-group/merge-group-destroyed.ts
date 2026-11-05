// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';

// The write of the `destroyed` delivery for a merge group (E22-S01), apart from the other rows of `merge_group_evaluations`
// (merge-group-rows.ts) to keep each file small. The group is met by its GitHub ids, so a delivery can only reach its own tenant.

/** The group GitHub took down, in the numbers of the delivery. */
export interface DestroyedTarget {
  readonly githubInstallationId: number;
  readonly githubRepoId: number;
  readonly headSha: string;
  /** The base SHA of the group, for the row of a group no job has met. */
  readonly baseSha: string;
}

/**
 * Sets `destroyed_at` of the evaluation of the group, and creates the row when there is none: a `destroyed` delivery that is handled
 * before the queued job first runs would otherwise be lost, and the job would then evaluate and report a group GitHub has already
 * taken down. The row it leaves is a tombstone (`in_progress`, no details): `startGroupEvaluation` and
 * `failGroupEvaluation` (merge-group-rows.ts, merge-group-failure.ts) find `destroyed_at` set and do nothing. The installation and the repository are found by their GitHub
 * ids and the row is made for that pair, so a delivery of one tenant can only mark or create a group of that tenant, and a
 * repository this instance does not hold gets no row. The first instant is kept.
 */
export async function markGroupDestroyed(db: Kysely<Database>, target: DestroyedTarget): Promise<void> {
  await db
    .insertInto('merge_group_evaluations')
    .columns(['installation_id', 'repository_id', 'head_sha', 'base_sha', 'destroyed_at'])
    .expression((eb) =>
      eb
        .selectFrom('repositories as repository')
        .innerJoin('installations as installation', 'installation.id', 'repository.installation_id')
        .select([
          'installation.id as installation_id',
          'repository.id as repository_id',
          eb.val(target.headSha).as('head_sha'),
          eb.val(target.baseSha).as('base_sha'),
          sql<Date>`now()`.as('destroyed_at'),
        ])
        .where('repository.github_repo_id', '=', target.githubRepoId)
        .where('installation.github_installation_id', '=', target.githubInstallationId),
    )
    .onConflict((conflict) =>
      conflict
        .columns(['repository_id', 'head_sha'])
        .doUpdateSet({ destroyed_at: sql`now()`, updated_at: sql`now()` })
        .where('merge_group_evaluations.destroyed_at', 'is', null),
    )
    .execute();
}
