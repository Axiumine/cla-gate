// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { migratedTestDatabase } from './adapters/db/test-support.ts';
import { createLogger } from './adapters/http/logger.ts';
import { jobWorkers } from './boot-jobs.ts';
import { FakePendingJobs } from './services/job-run-fixture/test-support.ts';
import { droppingEnqueuer } from './services/jobs-fixture/test-support.ts';
import { deliveryIds, insertDelivery } from './services/retention/test-support.ts';
import { FakeClock } from './services/test-support.ts';
import { testConfig } from './test-support.ts';

// The retention sweep as boot wires it (E22-S04): the handler needs the database only, so it is bound with or without a GitHub
// App, and it purges with the two settings of the configuration and the clock the workers were given.

const DAY = 86_400_000;
const NOW = '2026-11-05T03:17:00.000Z';
const CONTEXT = {
  jobId: 'job-1',
  attempt: 0,
  logger: createLogger({ logLevel: 'silent' }),
  pending: new FakePendingJobs(),
  enqueuer: droppingEnqueuer,
};

test('without a GitHub App the retention sweep is bound and purges by the days and the batch size of the configuration', async () => {
  const { db } = await migratedTestDatabase();
  const config = testConfig({ RETENTION_WEBHOOK_DELIVERIES_DAYS: '9', RETENTION_BATCH_SIZE: '1' });
  const workers = jobWorkers({
    db,
    config,
    logger: CONTEXT.logger,
    syncFor: undefined,
    clock: new FakeClock(NOW),
  });
  const now = Date.parse(NOW);
  await insertDelivery(db, 'ten-days', new Date(now - 10 * DAY));
  await insertDelivery(db, 'eight-days', new Date(now - 8 * DAY));
  await insertDelivery(db, 'nine-days-and-a-second', new Date(now - 9 * DAY - 1000));
  const outcome = await workers.registry.run(
    'retention-sweep',
    { type: 'retention-sweep' },
    { ...CONTEXT, signal: new AbortController().signal },
  );
  expect(outcome).toEqual({ outcome: 'swept' });
  expect(await deliveryIds(db)).toEqual(['eight-days']);
});
