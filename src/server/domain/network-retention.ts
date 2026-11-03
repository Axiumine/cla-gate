// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The retention rule for the optional network metadata (E16-S05), pure: where the line between kept and purged lies. Times
// are epoch milliseconds, because the domain has no clock and no `Date`; the caller owns both.

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * The instant, in epoch milliseconds, before which the network metadata of a signature is purged: `retentionDays` full
 * days (of 24 hours, in UTC, so no daylight-saving rule can move it) before `nowMilliseconds`. A row stored exactly at the
 * cutoff is kept; the purge takes the rows strictly older.
 */
export function retentionCutoff(nowMilliseconds: number, retentionDays: number): number {
  return nowMilliseconds - retentionDays * MILLISECONDS_PER_DAY;
}
