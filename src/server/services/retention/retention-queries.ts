// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, type RawBuilder, sql } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../adapters/db/schema.ts';

// The two statements of the retention sweep (E22-S04), written once over a target: delete one batch of the rows that are due,
// and count them for a dry run. A target is one of the two tables the sweep may touch, named by a constant and never by
// input, with its key and the one condition that says a row is due. The delete and the count read the same condition, so a dry
// run counts exactly what a run would delete. The instance has one set of both tables, so no statement filters by
// installation (a delivery and a session belong to no tenant). No other table is named anywhere in this file.

/** One table the sweep purges. */
export interface RetentionTarget {
  readonly table: RawBuilder<unknown>;
  /** A column that identifies a row, for the batch to name the rows it deletes. */
  readonly key: RawBuilder<unknown>;
  /** The rows that are due at `cutoff`. */
  readonly due: (cutoff: Date) => RawBuilder<boolean>;
}

/**
 * The webhook deliveries processed before the cutoff. A delivery with a null `processed_at` is pending work: the comparison
 * is not true for it whatever its age, so it is never due.
 */
export const WEBHOOK_DELIVERIES: RetentionTarget = {
  table: sql.table('webhook_deliveries'),
  key: sql.ref('delivery_id'),
  due: (cutoff) => sql<boolean>`processed_at < ${cutoff}`,
};

/**
 * The sessions that died before the cutoff: the idle or the absolute expiry is before it. The table checks that the idle expiry
 * is never after the absolute one, so the earlier of the two is the moment the session died; a session that is still valid
 * has both in the future and is never due.
 */
export const SESSIONS: RetentionTarget = {
  table: sql.table('sessions'),
  key: sql.ref('id'),
  due: (cutoff) => sql<boolean>`(idle_expires_at < ${cutoff} or absolute_expires_at < ${cutoff})`,
};

/**
 * Deletes at most `limit` due rows of `target` and returns how many went. A row another transaction has locked (a redelivery
 * that reads it) is skipped, so a batch never waits on it; the next run takes it.
 */
export async function deleteBatch(
  db: Kysely<Database>,
  target: RetentionTarget,
  cutoff: Date,
  limit: number,
): Promise<number> {
  const { rows } = await sql`
    with gone as (
      delete from ${target.table}
      where ${target.key} in (
        select ${target.key} from ${target.table} where ${target.due(cutoff)} limit ${limit} for update skip locked
      )
      returning 1
    )
    select count(*)::int as n from gone`.execute(db);
  return countOf(rows);
}

/** How many rows of `target` are due at `cutoff`: what {@link deleteBatch} would delete in all, for a dry run. */
export async function countDue(db: Kysely<Database>, target: RetentionTarget, cutoff: Date): Promise<number> {
  const { rows } = await sql`
    select count(*)::int as n from ${target.table} where ${target.due(cutoff)}`.execute(db);
  return countOf(rows);
}

/** What both statements answer: one row with one count. */
const countRow = z.strictObject({ n: z.int().nonnegative() });

/** The one number of a statement that selects a count. */
function countOf(rows: readonly unknown[]): number {
  return countRow.parse(rows[0]).n;
}
