// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// How often a job that fails is tried again (E07-S05). The queue enforces it (`QUEUE_BOUNDS`, in the queue definitions of
// the job adapter); the dead-letter handler reads it to know that the run it is in is the last one.

/**
 * Retries after the first run: a job that always fails runs `RETRY_LIMIT + 1` times, and then the queue moves it to the
 * dead-letter queue. pg-boss counts a run's retries in `retryCount`, which is 0 on the first run and `RETRY_LIMIT` on the last.
 */
export const RETRY_LIMIT = 5;
