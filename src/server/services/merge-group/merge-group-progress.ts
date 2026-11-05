// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { InstallationRowId } from '../../adapters/db/installation-row-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import type { MergeGroupDetails } from '../../domain/merge-group.ts';
import type { GroupKey, GroupRow } from './merge-group-rows.ts';

// The writes of a run of `evaluate-merge-group` to its row (E22-S01), apart from the reads and the keys (merge-group-rows.ts) to
// keep each file small. Like them every statement names the installation, and every write that gives the group a verdict is
// conditional on `destroyed_at is null`.

/**
 * Puts the evaluation of the group in progress, creating the row when there is none: two statements, so a retry, or two jobs for
 * one group, leave one row (the unique key decides). A row that exists keeps its id and the Check Run it recorded.
 * @returns the row, or `null` when GitHub took the group down: nothing is to be evaluated or written for it.
 */
export async function startGroupEvaluation(
  db: Kysely<Database>,
  key: GroupKey,
  baseSha: string,
): Promise<GroupRow | null> {
  await db
    .insertInto('merge_group_evaluations')
    .values({
      installation_id: key.installationId,
      repository_id: key.repositoryId,
      head_sha: key.headSha,
      base_sha: baseSha,
    })
    .onConflict((conflict) => conflict.columns(['repository_id', 'head_sha']).doNothing())
    .execute();
  const row = await db
    .updateTable('merge_group_evaluations')
    .set({ result: 'in_progress', details: '{}', base_sha: baseSha, updated_at: sql`now()` })
    .where('installation_id', '=', key.installationId)
    .where('repository_id', '=', key.repositoryId)
    .where('head_sha', '=', key.headSha)
    .where('destroyed_at', 'is', null)
    .returning(['id', 'check_run_id'])
    .executeTakeFirst();
  return row === undefined ? null : { id: row.id, checkRunId: row.check_run_id };
}

/**
 * Stores the verdict and the details of the group `id` of the installation, unless the group was destroyed.
 * @returns whether the verdict was stored: `false` for a destroyed group (or a row of another installation), which is then not reported.
 */
export async function finishGroupEvaluation(
  db: Kysely<Database>,
  installationId: InstallationRowId,
  id: number,
  details: MergeGroupDetails,
): Promise<boolean> {
  const row = await db
    .updateTable('merge_group_evaluations')
    .set({ result: details.outcome, details: JSON.stringify(details), updated_at: sql`now()` })
    .where('installation_id', '=', installationId)
    .where('id', '=', id)
    .where('destroyed_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** Stores the id of the Check Run written for the group `id` of the installation. A group that was destroyed meanwhile keeps it too: the run exists. */
export async function recordGroupCheckRun(
  db: Kysely<Database>,
  installationId: InstallationRowId,
  id: number,
  checkRunId: number,
): Promise<void> {
  await db
    .updateTable('merge_group_evaluations')
    .set({ check_run_id: checkRunId, updated_at: sql`now()` })
    .where('installation_id', '=', installationId)
    .where('id', '=', id)
    .execute();
}
