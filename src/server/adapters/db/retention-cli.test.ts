// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { expect, test, vi } from 'vitest';
import {
  at,
  DAY,
  insertDelivery,
  insertSession,
  NOW_TEXT,
  retentionWorld,
} from '../../services/retention/test-support.ts';
import { FakeClock } from '../../services/test-support.ts';
import { brokenDatabase, closable } from './cli-fixture/test-support.ts';
import { type RetentionCliOptions, runRetentionCli } from './retention-cli.ts';

// `node src/server/retention.ts [--dry-run]` (E22-S04): the arguments, the exit codes, what it prints, and that it prints counts
// and names of tables and nothing a row holds.

// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password -- made-up value: the tests prove that the password never reaches the output
const URL_WITH_PASSWORD = 'postgres://cla_app:s3cr3t-pw@db.internal:5432/cla';
const ENV = { DATABASE_URL: URL_WITH_PASSWORD };
const USAGE = 'usage: node src/server/retention.ts [--dry-run]';

type Connect = NonNullable<RetentionCliOptions['connect']>;

/** Capturing sinks, and a connection to a database that is the given one. */
async function scene(settings: Record<string, string> = {}) {
  const world = await retentionWorld();
  await insertDelivery(world.db, 'zzzz-old-delivery', at(-31 * DAY));
  await insertDelivery(world.db, 'zzzz-recent-delivery', at(-DAY));
  await insertSession(world, 1, at(-2 * DAY));
  const out: string[] = [];
  const err: string[] = [];
  const { handle, destroy } = closable(world.db);
  const connect = vi.fn<Connect>(() => handle);
  const options = (argv: readonly string[], more: Partial<RetentionCliOptions> = {}): RetentionCliOptions => ({
    argv,
    env: { ...ENV, ...settings },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    connect,
    clock: new FakeClock(NOW_TEXT),
    ...more,
  });
  return { world, out, err, connect, destroy, options };
}

test('a real run deletes what is due, prints the two counts and exits 0', async () => {
  const { world, out, err, options } = await scene();
  expect(await runRetentionCli(options([]))).toBe(0);
  expect(out).toEqual(['retention: deleted 1 webhook_deliveries and 1 sessions']);
  expect(err).toEqual([]);
  const left = await world.db.selectFrom('webhook_deliveries').select('delivery_id').execute();
  expect(left).toEqual([{ delivery_id: 'zzzz-recent-delivery' }]);
  const audit = await world.db.selectFrom('audit_log').select(['action', 'metadata']).execute();
  expect(audit).toEqual([{ action: 'retention.swept', metadata: { webhook_deliveries: 1, sessions: 1 } }]);
});

test('--dry-run prints what would be deleted, deletes nothing and writes no audit row', async () => {
  const { world, out, err, options } = await scene();
  expect(await runRetentionCli(options(['--dry-run']))).toBe(0);
  expect(out).toEqual(['retention dry run: 1 webhook_deliveries and 1 sessions would be deleted; nothing was deleted']);
  expect(err).toEqual([]);
  expect(await world.db.selectFrom('webhook_deliveries').select('delivery_id').execute()).toHaveLength(2);
  expect(await world.db.selectFrom('sessions').select('id').execute()).toHaveLength(1);
  expect(await world.db.selectFrom('audit_log').select('id').execute()).toEqual([]);
});

test('a dry run and the real run that follows it agree on the counts', async () => {
  const { out, options } = await scene();
  await runRetentionCli(options(['--dry-run']));
  await runRetentionCli(options([]));
  expect(out).toEqual([
    'retention dry run: 1 webhook_deliveries and 1 sessions would be deleted; nothing was deleted',
    'retention: deleted 1 webhook_deliveries and 1 sessions',
  ]);
});

test('the settings are those of the environment: 7 days and a batch of one row', async () => {
  const { world, out, options } = await scene({ RETENTION_WEBHOOK_DELIVERIES_DAYS: '7', RETENTION_BATCH_SIZE: '1' });
  await insertDelivery(world.db, 'zzzz-eight-days', at(-8 * DAY));
  await insertDelivery(world.db, 'zzzz-six-days', at(-6 * DAY));
  expect(await runRetentionCli(options([]))).toBe(0);
  expect(out).toEqual(['retention: deleted 2 webhook_deliveries and 1 sessions']);
});

test('it connects with the runtime connection string, which is never printed, and closes the connection', async () => {
  const { out, err, connect, destroy, options } = await scene();
  await runRetentionCli(options([]));
  expect(connect).toHaveBeenCalledExactlyOnceWith(URL_WITH_PASSWORD, expect.any(Function));
  expect(destroy).toHaveBeenCalledOnce();
  expect([...out, ...err].join('\n')).not.toContain('s3cr3t');
});

test.each([
  ['an unknown flag', ['--force']],
  ['a flag with a typo', ['--dryrun']],
  ['a value after the flag', ['--dry-run', 'now']],
  ['the flag twice', ['--dry-run', '--dry-run']],
  ['a bare word', ['dry-run']],
  ['an empty argument', ['']],
])('%s is a usage error: exit 2, the usage on stderr, nothing connected, nothing printed', async (_label, argv) => {
  const { out, err, connect, options } = await scene();
  expect(await runRetentionCli(options(argv))).toBe(2);
  expect(err).toEqual([USAGE]);
  expect(out).toEqual([]);
  expect(connect).not.toHaveBeenCalled();
});

test.each([
  ['a retention below 7 days', { RETENTION_WEBHOOK_DELIVERIES_DAYS: '6' }, 'RETENTION_WEBHOOK_DELIVERIES_DAYS'],
  ['a batch size of zero', { RETENTION_BATCH_SIZE: '0' }, 'RETENTION_BATCH_SIZE'],
])('%s exits 1 naming the variable, and connects to nothing', async (_label, settings, variable) => {
  const { out, err, connect, options } = await scene(settings);
  expect(await runRetentionCli(options([]))).toBe(1);
  expect(err).toHaveLength(1);
  expect(err).toEqual([expect.stringContaining(`retention failed: ${variable}: must be a whole number`)]);
  expect(out).toEqual([]);
  expect(connect).not.toHaveBeenCalled();
});

test('without a database url it exits 1 and names DATABASE_URL, never a value', async () => {
  const { err, options } = await scene();
  expect(await runRetentionCli(options([], { env: {} }))).toBe(1);
  expect(err).toEqual([expect.stringMatching(/^retention failed: DATABASE_URL: must be a postgres/)]);
});

test('a failure exits 1 and prints the name and the code of the error, never its message or the row it quotes', async () => {
  const { world, out, err, options } = await scene();
  const { handle, destroy } = closable(brokenDatabase(world.db));
  expect(await runRetentionCli(options([], { connect: () => handle }))).toBe(1);
  expect(err).toEqual(['retention failed: error (23505)']);
  expect(out).toEqual([]);
  expect(destroy).toHaveBeenCalledOnce();
});

test.each([
  ['a thrown string', 'zzzz-not-an-error', 'retention failed: unknown error'],
  [
    'an error with an unusable code',
    Object.assign(new Error('zzzz'), { code: 'not a plain code!' }),
    'retention failed: Error',
  ],
  ['an error with a numeric code', Object.assign(new TypeError('zzzz'), { code: 7 }), 'retention failed: TypeError'],
])('%s is reported without its text', async (_label, thrown, line) => {
  const { world, err, options } = await scene();
  const { handle } = closable(
    world.db.withPlugin({
      transformQuery: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the test throws values that are not errors on purpose
        throw thrown;
      },
      transformResult: (args) => Promise.resolve(args.result),
    }),
  );
  expect(await runRetentionCli(options([], { connect: () => handle }))).toBe(1);
  expect(err).toEqual([line]);
});

test('an error of the connection pool outside a query is printed as a database error with its code only', async () => {
  const { err, connect, options } = await scene();
  await runRetentionCli(options([]));
  const onError = connect.mock.calls[0]?.[1];
  onError?.(Object.assign(new Error('terminating connection zzzz'), { code: '57P01' }));
  onError?.(new Error('no code zzzz'));
  expect(err).toEqual(['retention: database error (57P01)', 'retention: database error']);
});

test('without sinks it writes to stdout and stderr, and without a clock it judges the rows by the wall clock', async () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const { db } = await retentionWorld();
  await insertDelivery(db, 'zzzz-old', new Date(Date.now() - 31 * DAY));
  await insertDelivery(db, 'zzzz-recent', new Date(Date.now() - DAY));
  const connect = vi.fn<Connect>(() => closable(db).handle);
  expect(await runRetentionCli({ argv: ['--dry-run'], env: ENV, connect })).toBe(0);
  expect(stdout.mock.calls).toEqual([
    ['retention dry run: 1 webhook_deliveries and 0 sessions would be deleted; nothing was deleted\n'],
  ]);
  expect(await runRetentionCli({ argv: ['--bad'], env: ENV, connect })).toBe(2);
  expect(stderr.mock.calls).toEqual([[`${USAGE}\n`]]);
});
