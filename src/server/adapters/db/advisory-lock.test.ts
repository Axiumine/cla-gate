// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, inject, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { lockInstallation } from './advisory-lock.ts';
import type { Database } from './schema.ts';
import { emptyTestDatabase, openTestDatabase, realPostgres } from './test-support.ts';

const id = parseGithubId;

/** How many advisory locks this session holds. */
async function heldLocks(db: Kysely<Database>): Promise<number> {
  const { rows } = await sql<{ held: number }>`
    select count(*)::int as held from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`.execute(db);
  return rows[0]?.held ?? -1;
}

test('the lock is held for the rest of the transaction and released when it commits', async () => {
  const { db } = await emptyTestDatabase();
  const during = await db.transaction().execute(async (trx) => {
    await lockInstallation(trx, id(100));
    return await heldLocks(trx);
  });
  expect(during).toBe(1);
  expect(await heldLocks(db)).toBe(0);
});

test('the lock is released when the transaction rolls back', async () => {
  const { db } = await emptyTestDatabase();
  await expect(
    db.transaction().execute(async (trx) => {
      await lockInstallation(trx, id(100));
      throw new Error('work failed');
    }),
  ).rejects.toThrow('work failed');
  expect(await heldLocks(db)).toBe(0);
});

test('taking the lock again in the same transaction is one lock; another installation is another lock', async () => {
  const { db } = await emptyTestDatabase();
  const counts = await db.transaction().execute(async (trx) => {
    await lockInstallation(trx, id(100));
    await lockInstallation(trx, id(100));
    const same = await heldLocks(trx);
    await lockInstallation(trx, id(101));
    return [same, await heldLocks(trx)];
  });
  expect(counts).toEqual([1, 2]);
});

// PGlite has one session and advisory locks are re-entrant within a session, so a lock held "elsewhere" can never contend
// there. Only a real server can prove that a second session waits for the same installation and not for another.
test.skipIf(!realPostgres)(
  'a second session waits for the lock of the same installation and not for another one',
  async () => {
    const { db } = await emptyTestDatabase();
    const other = await openTestDatabase(inject('testDatabaseUrl'));
    const waiting: Promise<void>[] = [];
    await other.db.transaction().execute(async (holder) => {
      await lockInstallation(holder, id(100));
      waiting.push(db.transaction().execute((trx) => lockInstallation(trx, id(100))));
      const early = await Promise.race([
        waiting[0]?.then(() => 'got the lock'),
        new Promise((resolve) => setTimeout(resolve, 300, 'still waiting')),
      ]);
      expect(early).toBe('still waiting');
      await db.transaction().execute((trx) => lockInstallation(trx, id(101)));
    });
    await Promise.all(waiting);
    await other.db.destroy();
  },
);
