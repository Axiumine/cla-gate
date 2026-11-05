// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { InstallationRowId } from '../../adapters/db/installation-row-id.ts';
import type { Database } from '../../adapters/db/schema.ts';

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
