// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test, vi } from 'vitest';
import { at, DAY, insertDelivery, retentionWorld } from '../../services/retention/test-support.ts';

// The connection of `node src/server/retention.ts` when nothing is injected (E22-S04): the pool that `createPgDatabase` opens on
// the connection string of the environment. The module that opens it is replaced by one that hands out the test database, so
// that no server is needed; the rest of the command is tested in retention-cli.test.ts.

// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password -- made-up value: the test only passes it through to the pool of the command
const URL_WITH_PASSWORD = 'postgres://cla_app:s3cr3t-pw@db.internal:5432/cla';

test('without a connect option the command opens the pool of createPgDatabase on DATABASE_URL, counts on it and closes it', async () => {
  const world = await retentionWorld();
  await insertDelivery(world.db, 'zzzz-old-delivery', at(-31 * DAY));
  const destroy = vi.spyOn(world.db, 'destroy').mockImplementation(() => Promise.resolve());
  const createPgDatabase = vi.fn<typeof import('./pg.ts').createPgDatabase>(() => world.db);
  vi.doMock('./pg.ts', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./pg.ts')>()),
    createPgDatabase,
  }));
  onTestFinished(() => {
    vi.doUnmock('./pg.ts');
    destroy.mockRestore();
  });
  vi.resetModules();
  const { runRetentionCli } = await import('./retention-cli.ts');
  const out: string[] = [];
  const err: string[] = [];
  const env = { DATABASE_URL: URL_WITH_PASSWORD };
  const code = await runRetentionCli({
    argv: ['--dry-run'],
    env,
    clock: world.clock,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  expect(code).toBe(0);
  expect(out).toEqual(['retention dry run: 1 webhook_deliveries and 0 sessions would be deleted; nothing was deleted']);
  expect(err).toEqual([]);
  const aFunction: unknown = expect.any(Function);
  expect(createPgDatabase).toHaveBeenCalledExactlyOnceWith({
    connectionString: URL_WITH_PASSWORD,
    onError: aFunction,
  });
  expect(destroy).toHaveBeenCalledOnce();
});
