// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { InstallationRowId } from '../../adapters/db/installation-row-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import { detailsOfFailure, type MergeGroupDetails } from '../../domain/merge-group.ts';

// The rows of `merge_group_evaluations` (migration 018, E22-S01): the evaluation of a merge queue's group, one per head SHA of a
// repository. Every statement names the installation (`installations.id`), so one tenant never reaches the rows of another, and
// every write that gives the group a verdict is conditional on `destroyed_at is null`: a group GitHub took down is never written to
// again, and the statement that finds it destroyed is also the check that the job makes "immediately before writing".

/** One group of a repository of an installation: the unique key of the table, with its tenant. */
export interface GroupKey {
  /** `installations.id`. */
  readonly installationId: InstallationRowId;
  /** `repositories.id`. */
  readonly repositoryId: number;
  readonly headSha: string;
}

/** A group's row as a run that is going to write needs it: its id, and the Check Run an earlier run recorded for it. */
export interface GroupRow {
  readonly id: number;
  readonly checkRunId: number | null;
}

/** A group's row as the reporter reads it, with the instant GitHub took the group down, or `null` while it stands. */
export interface ReportedGroupRow extends GroupRow {
  readonly destroyedAt: Date | null;
}

/** The row a report is about does not exist for this tenant: the job inserts it before it reports (E22-S01), so this is a defect. */
export class GroupRowMissingError extends Error {
  override readonly name = 'GroupRowMissingError';

  constructor() {
    super('no evaluation row for this merge group');
  }
}

/** GitHub took the group down before its report was written: the run is not written (E22-S01), and the report ends as a skip. */
export class MergeGroupDestroyedError extends Error {
  override readonly name = 'MergeGroupDestroyedError';

  constructor() {
    super('the merge group was destroyed');
  }
}

/** The row of the group of `key`, or `null` when the installation has none for the head SHA of that repository. */
export async function findGroupRow(db: Kysely<Database>, key: GroupKey): Promise<ReportedGroupRow | null> {
  const row = await db
    .selectFrom('merge_group_evaluations')
    .select(['id', 'check_run_id', 'destroyed_at'])
    .where('installation_id', '=', key.installationId)
    .where('repository_id', '=', key.repositoryId)
    .where('head_sha', '=', key.headSha)
    .executeTakeFirst();
  return row === undefined ? null : { id: row.id, checkRunId: row.check_run_id, destroyedAt: row.destroyed_at };
}

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
 * taken down. The row it leaves is a tombstone (`in_progress`, no details): {@link startGroupEvaluation} and
 * {@link failGroupEvaluation} find `destroyed_at` set and do nothing. The installation and the repository are found by their GitHub
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
