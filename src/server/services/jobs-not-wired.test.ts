// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { notWiredEnqueuer } from './jobs-not-wired.ts';

// The enqueuer of a server built without a queue (E06-S06) fails every send: nothing that needs a job is acknowledged.

async function sendInTransaction() {
  const { db } = await migratedTestDatabase();
  return db
    .transaction()
    .execute((tx: Transaction<Database>) =>
      notWiredEnqueuer.enqueue(
        tx,
        { type: 'sync-installation', githubInstallationId: parseGithubId(31_001) },
        { idempotencyKey: 'key' },
      ),
    );
}

test('every send is refused, with a fixed message that names no job and no id', async () => {
  const failure = await sendInTransaction().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure).toMatchObject({
    name: 'JobQueueNotWiredError',
    message: 'No job queue is wired: the job was not sent',
  });
});
