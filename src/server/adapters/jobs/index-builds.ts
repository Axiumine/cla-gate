// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Boss } from './boss.ts';

// A pg-boss migration can queue index builds that its background worker (BAM) runs after the migration, one statement
// at a time. Only the migration owner runs that worker (E07-S01): the runtime role starts pg-boss with `migrate: false`
// and has no right to build an index, so a build left in the queue would never run. The migrate step therefore waits
// for the queue to be empty before it lets go of pg-boss.

export interface IndexBuildWait {
  /** How often the status is read. */
  readonly intervalMs: number;
  /** How many reads at most: the wait ends with an error after that many. */
  readonly attempts: number;
  readonly sleep: (ms: number) => Promise<void>;
}

/** Reads every second for up to 30 minutes: an index on a large job table can take that long, a fresh install has none. */
export const DEFAULT_INDEX_BUILD_WAIT: IndexBuildWait = {
  intervalMs: 1000,
  attempts: 1800,
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};

/**
 * Resolves when no pg-boss index build is pending or running.
 * @throws Error when a build failed (the table is left as it was, a rerun of the migration retries it) or when the builds
 * did not finish within the wait.
 */
export async function waitForIndexBuilds(boss: Boss, wait: IndexBuildWait): Promise<void> {
  for (let attempt = 1; attempt <= wait.attempts; attempt += 1) {
    const counts = new Map((await boss.getBamStatus()).map((row) => [row.status, row.count]));
    if ((counts.get('failed') ?? 0) > 0) {
      throw new Error('a pg-boss index build failed: see the bam table of the pgboss schema');
    }
    if ((counts.get('pending') ?? 0) + (counts.get('in_progress') ?? 0) === 0) {
      return;
    }
    if (attempt < wait.attempts) {
      await wait.sleep(wait.intervalMs);
    }
  }
  throw new Error('pg-boss index builds did not finish in time: run yarn db:migrate again');
}
