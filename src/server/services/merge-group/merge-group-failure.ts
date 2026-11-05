// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import { detailsOfFailure } from '../../domain/merge-group.ts';
import type { GroupKey, GroupRow } from './merge-group-rows.ts';

// The write of the dead-letter handler for a merge group (E22-S01), apart from the other rows of `merge_group_evaluations`
// (merge-group-rows.ts) to keep each file small. Like them it names the installation in every statement.

/** The details a dead job leaves: a failure with the code `evaluation_failed` and no pull request. */
const FAILED_DETAILS = JSON.stringify(detailsOfFailure('evaluation_failed'));

/**
 * Sets the group of `key` to `failure` with the details of a dead job, creating the row when there is none (the job died before it
 * wrote one): the dead-letter handler's write (E22-S01), one statement, so a retry of the handler leaves one row. A verdict a
 * retry stored before the job died is replaced, because its report never went out and a check that is not reported is a queue that
 * waits for ever; a row of a destroyed group is left alone.
 * @returns the row, or `null` for a destroyed group.
 */
export async function failGroupEvaluation(
  db: Kysely<Database>,
  key: GroupKey,
  baseSha: string,
): Promise<GroupRow | null> {
  const row = await db
    .insertInto('merge_group_evaluations')
    .values({
      installation_id: key.installationId,
      repository_id: key.repositoryId,
      head_sha: key.headSha,
      base_sha: baseSha,
      result: 'failure',
      details: FAILED_DETAILS,
    })
    .onConflict((conflict) =>
      conflict
        .columns(['repository_id', 'head_sha'])
        .doUpdateSet({ result: 'failure', details: FAILED_DETAILS, updated_at: sql`now()` })
        .where('merge_group_evaluations.installation_id', '=', key.installationId)
        .where('merge_group_evaluations.destroyed_at', 'is', null),
    )
    .returning(['id', 'check_run_id'])
    .executeTakeFirst();
  return row === undefined ? null : { id: row.id, checkRunId: row.check_run_id };
}
