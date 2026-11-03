// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { test } from 'vitest';
import { migratedTestDatabase } from '../../adapters/db/test-support.ts';
import { createJobsTable, fakeEnqueuer, liveJobCount, setJobStates } from '../jobs-fixture/test-support.ts';
import { CONTRACT_CASES, type JobsWorld } from './test-support.ts';

// The fake enqueuer against the contract of the port (E06-S06). E07-S01 adds the same table for the pg-boss adapter.

async function fakeWorld(): Promise<JobsWorld> {
  const { db } = await migratedTestDatabase();
  await createJobsTable(db);
  return {
    enqueuer: fakeEnqueuer(),
    db,
    liveJobs: () => liveJobCount(db),
    startJobs: () => setJobStates(db, 'active'),
    finishJobs: () => setJobStates(db, 'completed'),
  };
}

test.each(CONTRACT_CASES)('the fake enqueuer: %s', async (_name, run) => {
  await run(await fakeWorld());
});
