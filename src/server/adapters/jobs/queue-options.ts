// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ExistingQueue } from './queue-policy.ts';
import type { QueueSettings } from './queues.ts';

// The bounds of a queue (E07-S05) can be changed after it exists, unlike its policy: the migrate step brings a queue that
// an older build created in line with the definitions. pg-boss copies a queue's bounds onto a job when the job is sent,
// so a queue with other bounds would give its new jobs other retries.

/** What `updateQueue` is given: the bounds and the dead-letter queue, `null` to clear it. */
export interface QueueUpdate {
  readonly retryLimit: number;
  readonly retryDelay: number;
  readonly retryBackoff: boolean;
  readonly expireInSeconds: number;
  readonly retentionSeconds: number;
  readonly deleteAfterSeconds: number;
  readonly deadLetter: string | null;
}

/** True when the queue as the database has it differs from `wanted` in a bound or in its dead-letter queue. */
export function boundsDrifted(existing: ExistingQueue, wanted: QueueSettings): boolean {
  const pairs: readonly (readonly [unknown, unknown])[] = [
    [existing.retryLimit, wanted.retryLimit],
    [existing.retryDelay, wanted.retryDelay],
    [existing.retryBackoff, wanted.retryBackoff],
    [existing.expireInSeconds, wanted.expireInSeconds],
    [existing.retentionSeconds, wanted.retentionSeconds],
    [existing.deleteAfterSeconds, wanted.deleteAfterSeconds],
    [existing.deadLetter ?? null, wanted.deadLetter ?? null],
  ];
  return pairs.some(([found, expected]) => found !== expected);
}

/** The update that brings a queue to `wanted`. */
export function updateFor(wanted: QueueSettings): QueueUpdate {
  return {
    retryLimit: wanted.retryLimit,
    retryDelay: wanted.retryDelay,
    retryBackoff: wanted.retryBackoff,
    expireInSeconds: wanted.expireInSeconds,
    retentionSeconds: wanted.retentionSeconds,
    deleteAfterSeconds: wanted.deleteAfterSeconds,
    deadLetter: wanted.deadLetter ?? null,
  };
}
