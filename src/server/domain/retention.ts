// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { retentionCutoff } from './network-retention.ts';

// The rules of the retention sweep (E22-S04), pure: how long the operational rows that have no evidentiary value are kept,
// and where the line between kept and purged lies. Times are epoch milliseconds, because the domain has no clock and no
// `Date`; the caller owns both.

/**
 * The fewest days `RETENTION_WEBHOOK_DELIVERIES_DAYS` may name: more than twice GitHub's 3-day window in which a delivery
 * can be redelivered, so a row is never purged while a redelivery of it is still possible.
 */
export const MIN_WEBHOOK_DELIVERIES_DAYS = 7;

/** The most days it may name: ten years, which is "never" for a table that only stops a redelivery from running twice. */
export const MAX_WEBHOOK_DELIVERIES_DAYS = 3650;

/** The default retention of a processed webhook delivery: a month. An operator default, not advice. */
export const DEFAULT_WEBHOOK_DELIVERIES_DAYS = 30;

/** The default number of rows one batch of the sweep deletes (`RETENTION_BATCH_SIZE`). */
export const DEFAULT_RETENTION_BATCH_SIZE = 5000;

/** The most rows one batch may name, so a batch never holds a long lock. */
export const MAX_RETENTION_BATCH_SIZE = 100_000;

/** How many days a session stays after it expired: a day, so the row that explains a "your session expired" support request is still there. */
const SESSION_GRACE_DAYS = 1;

/**
 * The instant, in epoch milliseconds, before which a webhook delivery that was processed is purged: `days` full days of 24
 * hours before `nowMilliseconds`. A row processed exactly at the cutoff is kept; the sweep takes the rows strictly older.
 */
export function deliveryCutoff(nowMilliseconds: number, days: number): number {
  return retentionCutoff(nowMilliseconds, days);
}

/**
 * The instant, in epoch milliseconds, before which an expired session is purged: {@link SESSION_GRACE_DAYS} before
 * `nowMilliseconds`. A session counts from the moment it died, which is the earlier of its idle and its absolute expiry; one
 * that died exactly at the cutoff is kept.
 */
export function sessionCutoff(nowMilliseconds: number): number {
  return retentionCutoff(nowMilliseconds, SESSION_GRACE_DAYS);
}
