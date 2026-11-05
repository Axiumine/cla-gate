// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type SqlBool, sql } from 'kysely';
import type { PendingReasonCode } from '../../shared/pending-prs.ts';

// Where a page of the pending pull requests starts and what it is asked for (E15-S07), and the two pieces of SQL that put a row at a place in
// the order `updated_at desc, id desc`.

/**
 * A place in the list: the instant a row was last written and its id. The instant is kept at the microsecond precision the database
 * stores (`2026-10-15T09:00:00.123456Z`), because two rows of one millisecond can be told apart only by it.
 */
export interface PendingPosition {
  readonly updatedAt: string;
  readonly id: number;
}

/** What a page of the list is asked for. The caller has seen that `repositoryIds` is not empty. */
export interface PendingRead {
  /** `repositories.id` of the repositories the viewer may read; ids of another tenant match no row. */
  readonly repositoryIds: readonly number[];
  /** Only the pull requests that have a reason with this code; `null` for any. */
  readonly reason: PendingReasonCode | null;
  readonly limit: number;
  readonly from: PendingPosition | null;
}

/** The instant a row was written as text, to the microsecond and in UTC, as the cursor holds it. */
export const UPDATED_AT_MICROS =
  sql<string>`to_char(latest.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('updatedAtMicros');

/** The condition that keeps the rows from `position` on, that one included, in the order `updated_at desc, id desc`. */
export const fromPosition = (position: PendingPosition) =>
  sql<SqlBool>`(latest.updated_at, latest.id) <= (${position.updatedAt}::timestamptz, ${position.id})`;
