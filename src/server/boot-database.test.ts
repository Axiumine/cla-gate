// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { afterAll, expect, onTestFinished, test, vi } from 'vitest';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import type { Database } from './adapters/db/schema.ts';
import { createLogger } from './adapters/http/logger.ts';
import { boot } from './boot.ts';
import { checkDatabase } from './boot-database.ts';
import { captureLogs, FakeProcess, freePort, startFakeJobQueue, UNREACHABLE_DATABASE_URL } from './test-support.ts';

// E19-S02: before the server listens, `select 1` runs as the runtime role: five tries, two seconds apart. A database that
// stays away ends the start with one line that names the error code and never the connection string or the driver's message.

const LINE = 'database: cannot connect (ECONNREFUSED); check DATABASE_URL and that the database is up';

/** One database for the tests that only check it; the ones that start a server or close it open their own. */
const shared = await openPgliteDatabase();
afterAll(async () => {
  await shared.destroy();
});

/** `db` (the shared one by default) with its next `failures` queries failing with `error`, then answering as it does. */
async function flaky(
  failures: number,
  error: unknown,
  own?: 'own',
): Promise<{ db: Kysely<Database>; queries: () => number }> {
  const db = own === undefined ? shared : await openPgliteDatabase();
  const getExecutor = db.getExecutor.bind(db);
  let queries = 0;
  const spy = vi.spyOn(db, 'getExecutor').mockImplementation(() => {
    queries += 1;
    if (queries <= failures) {
      throw error;
    }
    return getExecutor();
  });
  onTestFinished(async () => {
    spy.mockRestore();
    if (own !== undefined) {
      await db.destroy();
    }
  });
  return { db, queries: () => queries };
}

const refused = (): Error =>
  Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432 postgres://u:hunter2@h/db'), { code: 'ECONNREFUSED' });

function fixture() {
  const logs = captureLogs();
  const lines: string[] = [];
  const waits: number[] = [];
  return {
    logs,
    lines,
    waits,
    options: {
      logger: createLogger({ logLevel: 'info' }, logs.destination),
      err: (line: string) => lines.push(line),
      sleep: (milliseconds: number) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
    },
  };
}

test('a database that answers is checked once, with no wait and no line', async () => {
  const { db, queries } = await flaky(0, refused());
  const { options, lines, waits, logs } = fixture();
  expect(await checkDatabase({ db, ...options })).toBe(true);
  expect([queries(), lines, waits, logs.text()]).toEqual([1, [], [], '']);
});

test('a database that comes up on the third try is used, after two waits of two seconds, each try logged with its code only', async () => {
  const { db, queries } = await flaky(2, refused());
  const { options, lines, waits, logs } = fixture();
  expect(await checkDatabase({ db, ...options })).toBe(true);
  expect(queries()).toBe(3);
  expect(waits).toEqual([2000, 2000]);
  expect(lines).toEqual([]);
  expect(logs.lines()).toMatchObject([
    { level: 40, msg: 'database.connect_retry', attempt: 1, code: 'ECONNREFUSED' },
    { level: 40, msg: 'database.connect_retry', attempt: 2, code: 'ECONNREFUSED' },
  ]);
  expect(logs.text()).not.toContain('hunter2');
});

test('a database that comes up on the fifth try is still used', async () => {
  const { db, queries } = await flaky(4, refused());
  const { options, waits } = fixture();
  expect(await checkDatabase({ db, ...options })).toBe(true);
  expect([queries(), waits]).toEqual([5, [2000, 2000, 2000, 2000]]);
});

test('five failed tries end in false and one line with the error code, and the fifth is not followed by a wait', async () => {
  const { db, queries } = await flaky(99, refused());
  const { options, lines, waits, logs } = fixture();
  expect(await checkDatabase({ db, ...options })).toBe(false);
  expect(queries()).toBe(5);
  expect(waits).toEqual([2000, 2000, 2000, 2000]);
  expect(lines).toEqual([LINE]);
  expect(logs.lines()).toHaveLength(4);
  expect(`${lines.join('')}${logs.text()}`).not.toMatch(/hunter2|10\.0\.0\.1|postgres:\/\//);
});

test.each([
  ['a server error code', { code: '28P01' }, '28P01'],
  ['a code that is not a plain code', { code: 'postgres://u:hunter2@h/db' }, 'UNKNOWN'],
  ['a code that is too long', { code: 'E'.repeat(33) }, 'UNKNOWN'],
  ['a numeric code', { code: 7 }, 'UNKNOWN'],
])('with %s the line carries the expected code', async (_label, props, code) => {
  const { db } = await flaky(99, Object.assign(new Error('driver message with hunter2'), props));
  const { options, lines } = fixture();
  expect(await checkDatabase({ db, ...options })).toBe(false);
  expect(lines).toEqual([`database: cannot connect (${code}); check DATABASE_URL and that the database is up`]);
});

test.each([
  ['an error with no code', new Error('timeout exceeded when trying to connect')],
  ['a thrown string', 'hunter2'],
  ['null', null],
])('%s is UNKNOWN, and nothing of it is printed', async (_label, thrown) => {
  const { db } = await flaky(99, thrown);
  const { options, lines, logs } = fixture();
  expect(await checkDatabase({ db, ...options })).toBe(false);
  expect(lines).toEqual(['database: cannot connect (UNKNOWN); check DATABASE_URL and that the database is up']);
  expect(`${lines.join('')}${logs.text()}`).not.toMatch(/hunter2|timeout/);
});

test('the default wait is a real timer of two seconds', async () => {
  const { db, queries } = await flaky(1, refused());
  const { options } = fixture();
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const checking = checkDatabase({ db, logger: options.logger, err: options.err });
  await vi.advanceTimersByTimeAsync(1999);
  expect(queries()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await checking).toBe(true);
  expect(queries()).toBe(2);
});

test('boot against a database that refuses connections: the line goes to err, nothing listens, the exit code is 1', async () => {
  const signals = new FakeProcess();
  const { options, lines, waits, logs } = fixture();
  const server = await boot({
    env: {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      LOG_LEVEL: 'info',
    },
    signals,
    err: options.err,
    sleep: options.sleep,
    createJobQueue: startFakeJobQueue,
    logDestination: logs.destination,
  });
  expect(server).toBeUndefined();
  expect(signals.exitCode).toBe(1);
  expect(lines).toEqual([LINE]);
  expect(waits).toEqual([2000, 2000, 2000, 2000]);
  expect(signals.listenerCount('SIGTERM')).toBe(0);
  expect(`${lines.join('')}${logs.text()}`).not.toMatch(/pw@|postgres:\/\//);
});

test('boot closes the database it opened when the check fails, and never starts the job queue', async () => {
  const signals = new FakeProcess();
  const { options, lines } = fixture();
  const { db } = await flaky(99, refused(), 'own');
  const destroy = vi.spyOn(db, 'destroy');
  const createJobQueue = vi.fn(startFakeJobQueue);
  const server = await boot({
    env: { DATABASE_URL: UNREACHABLE_DATABASE_URL, LOG_LEVEL: 'silent' },
    signals,
    createDb: () => db,
    createJobQueue,
    err: options.err,
    sleep: options.sleep,
  });
  expect(server).toBeUndefined();
  expect(signals.exitCode).toBe(1);
  expect(lines).toEqual([LINE]);
  expect(destroy).toHaveBeenCalledOnce();
  expect(createJobQueue).not.toHaveBeenCalled();
});

test('boot starts when the database comes up on a later try', async () => {
  const signals = new FakeProcess();
  const { options, waits } = fixture();
  const { db } = await flaky(2, refused(), 'own');
  const server = await boot({
    env: {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      LOG_LEVEL: 'silent',
    },
    signals,
    createDb: () => db,
    createJobQueue: startFakeJobQueue,
    err: options.err,
    sleep: options.sleep,
    reconcileOnStart: false,
  });
  onTestFinished(async () => {
    await server?.close();
  });
  expect(waits).toEqual([2000, 2000]);
  expect((await fetch(`${server?.address}/healthz`)).status).toBe(200);
});
