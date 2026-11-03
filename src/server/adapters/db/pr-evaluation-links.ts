// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from './schema.ts';
import type { TenantScope } from './tenant-scope.ts';

// The two reporting columns of `pr_evaluations` and the reads the reporter needs (E09-S04). The evaluation job owns `result`
// and `details` of a row (E07-S04); the reporter owns `check_run_id` and `comment_id`, and each write below sets one of them
// and `updated_at` and nothing else, so the two never overwrite each other's column. Every statement carries the installation
// id of the scope, so one tenant never reads, records or detects the ids of another; the composite foreign key
// `(repository_id, installation_id)` makes a mismatched pair unwritable besides. Nothing here deletes a row: the rows record why
// a pull request was accepted and are kept. The ids are `bigint` columns; the E04 int8 parser turns them into numbers and
// throws for a value a number cannot hold.

/** The row of one pull request at one head SHA of a repository of the tenant: the unique key of the table, without the tenant. */
export interface LinkKey {
  /** `repositories.id`. */
  readonly repositoryId: number;
  readonly prNumber: number;
  readonly headSha: string;
}

/** The row the call is about does not exist for this tenant: the job inserts it before it reports (E07-S04), so this is a defect. */
export class EvaluationRowMissingError extends Error {
  override readonly name = 'EvaluationRowMissingError';

  constructor() {
    super('no evaluation row for this pull request and head SHA');
  }
}

/** What the reporter needs to know of the rows that share a head SHA (E09-S05). */
export interface RowAtSha {
  readonly prNumber: number;
  readonly result: Database['pr_evaluations']['result'];
  readonly checkRunId: number | null;
}

/**
 * Sets one reporting column of the row of `key` and `updated_at`, in one statement.
 * @throws EvaluationRowMissingError when the tenant has no such row.
 */
async function recordLink(
  db: Kysely<Database>,
  scope: TenantScope,
  key: LinkKey,
  column: { readonly check_run_id: number } | { readonly comment_id: number },
): Promise<void> {
  const row = await db
    .updateTable('pr_evaluations')
    .set({ ...column, updated_at: sql`now()` })
    .where('installation_id', '=', scope.installationId)
    .where('repository_id', '=', key.repositoryId)
    .where('pr_number', '=', key.prNumber)
    .where('head_sha', '=', key.headSha)
    .returning('id')
    .executeTakeFirst();
  if (row === undefined) {
    throw new EvaluationRowMissingError();
  }
}

/**
 * Stores the id of the Check Run of the row of `key`. Touches `check_run_id` and `updated_at` only, never `result` or
 * `details`; a repeat with the same id changes nothing but the time.
 * @throws EvaluationRowMissingError when the tenant has no such row.
 */
export function recordCheckRunId(db: Kysely<Database>, scope: TenantScope, key: LinkKey, id: number): Promise<void> {
  return recordLink(db, scope, key, { check_run_id: id });
}

/**
 * Stores the id of the pull request comment on the row of `key`. Touches `comment_id` and `updated_at` only, never `result` or
 * `details`.
 * @throws EvaluationRowMissingError when the tenant has no such row.
 */
export function recordCommentId(db: Kysely<Database>, scope: TenantScope, key: LinkKey, id: number): Promise<void> {
  return recordLink(db, scope, key, { comment_id: id });
}

/**
 * The comment id of the most recent row of the pull request that has one, or `null`: a new head SHA keeps editing the comment
 * of the earlier ones instead of opening a second. The most recent row is the one touched last (`updated_at`, then the row id).
 */
export async function findCommentIdForPr(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryId: number,
  prNumber: number,
): Promise<number | null> {
  const row = await db
    .selectFrom('pr_evaluations')
    .select('comment_id')
    .where('installation_id', '=', scope.installationId)
    .where('repository_id', '=', repositoryId)
    .where('pr_number', '=', prNumber)
    .where('comment_id', 'is not', null)
    .orderBy('updated_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.comment_id ?? null;
}

/**
 * Every row of the repository at `headSha`, one per pull request evaluated at it, with its result and Check Run id, by pull
 * request number. Several open pull requests can share a head SHA and the Check Run belongs to the SHA (E09-S05).
 */
export async function findRowsForSha(
  db: Kysely<Database>,
  scope: TenantScope,
  repositoryId: number,
  headSha: string,
): Promise<RowAtSha[]> {
  const rows = await db
    .selectFrom('pr_evaluations')
    .select(['pr_number', 'result', 'check_run_id'])
    .where('installation_id', '=', scope.installationId)
    .where('repository_id', '=', repositoryId)
    .where('head_sha', '=', headSha)
    .orderBy('pr_number')
    .execute();
  return rows.map((row) => ({ prNumber: row.pr_number, result: row.result, checkRunId: row.check_run_id }));
}

/**
 * True when another row of the same pull request, at a different head SHA, was touched after the row of `key`: a newer commit
 * has been evaluated, so the comment, which all the SHAs of a pull request share, is the newer job's to write (E09-S07). Reads
 * the database only. False when the row of `key` does not exist: there is nothing to compare, and the write that follows
 * names the missing row. The key is unique, so a row of the pull request that is not the row of `key` is one at another head SHA,
 * and a row is never later than itself. A write of either id touches `updated_at`, so the question is asked before the comment is written
 * and its id recorded, not after.
 */
export async function hasNewerHeadRow(db: Kysely<Database>, scope: TenantScope, key: LinkKey): Promise<boolean> {
  const row = await db
    .selectFrom('pr_evaluations as newer')
    .innerJoin('pr_evaluations as own', (join) =>
      join
        .onRef('own.installation_id', '=', 'newer.installation_id')
        .onRef('own.repository_id', '=', 'newer.repository_id')
        .onRef('own.pr_number', '=', 'newer.pr_number'),
    )
    .select('newer.id')
    .where('own.installation_id', '=', scope.installationId)
    .where('own.repository_id', '=', key.repositoryId)
    .where('own.pr_number', '=', key.prNumber)
    .where('own.head_sha', '=', key.headSha)
    .whereRef('newer.updated_at', '>', 'own.updated_at')
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}
