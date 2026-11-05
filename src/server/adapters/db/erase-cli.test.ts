// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { sql } from 'kysely';
import { expect, test, vi } from 'vitest';
import {
  callFor,
  erasureAudit,
  erasureWorld,
  failStatement,
  footprintRead,
  replaceWithNoOp,
  rowsOf,
  snapshotOf,
  TARGET,
} from '../../services/operator-erasure-fixture/test-support.ts';
import { onRuntimeConnection } from '../../services/retention/test-support.ts';
import type { CliOptions } from './cli-database.ts';
import { brokenDatabase, closable } from './cli-fixture/test-support.ts';
import { runEraseCli } from './erase-cli.ts';

// `node src/server/erase.ts --github-id <n> --actor-github-id <n> [--execute]` (E22-S05): the arguments, the exit codes, what it
// prints, and that it goes through the erasure function as the runtime role. What it prints is counts and numeric ids.

// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password -- made-up value: the tests prove that the password never reaches the output
const URL_WITH_PASSWORD = 'postgres://cla_app:s3cr3t-pw@db.internal:5432/cla';
const ENV = { DATABASE_URL: URL_WITH_PASSWORD };
const USAGE = 'usage: node src/server/erase.ts --github-id <n> --actor-github-id <n> [--execute]';
const ARGS = ['--github-id', '4242', '--actor-github-id', '9001'];
const EXECUTE = [...ARGS, '--execute'];

type Connect = NonNullable<CliOptions['connect']>;

/** The world, capturing sinks, and a connection to the world's database. */
async function scene(data?: Parameters<typeof erasureWorld>[0]) {
  const world = await erasureWorld(data);
  const out: string[] = [];
  const err: string[] = [];
  const { handle, destroy } = closable(world.db);
  const connect = vi.fn<Connect>(() => handle);
  const run = (argv: readonly string[], more: Partial<CliOptions> = {}) =>
    runEraseCli({ argv, env: ENV, out: (line) => out.push(line), err: (line) => err.push(line), connect, ...more });
  return { world, out, err, connect, destroy, run };
}

test('without --execute it is a dry run: the counts per installation on stdout, exit 0, and nothing changed', async () => {
  const { world, out, err, run } = await scene();
  const { t1, t2 } = world;
  expect(await run(ARGS)).toBe(0);
  expect(out).toEqual([
    'erase dry run for GitHub id 4242: 2 signer_pii rows in 2 installations, 2 signature cores would be kept, users snapshot scrubbed: no',
    `installation ${t1.installationId}: 1 signer_pii rows, 1 signature cores`,
    `installation ${t2.installationId}: 1 signer_pii rows, 1 signature cores`,
    'nothing was changed; add --execute to erase',
  ]);
  expect(err).toEqual([]);
  expect(await rowsOf(world.db, TARGET)).toHaveLength(2);
  expect((await snapshotOf(world.db, TARGET)).login).toBe('login-4242');
  expect(await erasureAudit(world.db)).toEqual([]);
});

test('--execute erases through the function, prints the rows deleted per installation, and exits 0', async () => {
  const { world, out, err, run } = await scene();
  const { t1, t2 } = world;
  expect(await run(EXECUTE)).toBe(0);
  expect(out).toEqual([
    'erased GitHub id 4242: 2 signer_pii rows deleted in 2 installations, 2 signature cores kept, users snapshot scrubbed',
    `installation ${t1.installationId}: 1 signer_pii rows deleted`,
    `installation ${t2.installationId}: 1 signer_pii rows deleted`,
  ]);
  expect(err).toEqual([]);
  expect(await rowsOf(world.db, TARGET)).toEqual([]);
  expect((await snapshotOf(world.db, TARGET)).login).toBe('erased-4242');
  expect((await erasureAudit(world.db)).map((row) => [row.installation_id, row.actor_github_id])).toEqual([
    [t1.installationId, 9001],
    [t2.installationId, 9001],
  ]);
});

test('a dry run and the real run that follows it agree on the counts', async () => {
  const { out, run } = await scene();
  await run(ARGS);
  await run(EXECUTE);
  expect(out[0]).toContain('2 signer_pii rows in 2 installations');
  expect(out[4]).toContain('2 signer_pii rows deleted in 2 installations');
});

test('a person who is erased already prints "nothing to erase" and exits 0, for a repeat and for a dry run, and writes no audit row', async () => {
  const { world, out, err, run } = await scene();
  await run(EXECUTE);
  const audit = await erasureAudit(world.db);
  out.length = 0;
  expect(await run(EXECUTE)).toBe(0);
  expect(await run(ARGS)).toBe(0);
  expect(out).toEqual(['nothing to erase', 'nothing to erase']);
  expect(err).toEqual([]);
  expect(await erasureAudit(world.db)).toEqual(audit);
});

test.each([
  ['a dry run', ARGS],
  ['a real run', EXECUTE],
])('%s for a GitHub id the server never saw prints "no such user" on stderr and exits 1', async (_label, argv) => {
  const { out, err, run } = await scene();
  expect(await run(argv.map((word) => (word === '4242' ? '123456' : word)))).toBe(1);
  expect(err).toEqual(['no such user']);
  expect(out).toEqual([]);
});

test.each([
  ['an unknown flag', [...ARGS, '--force']],
  ['a flag with a typo', [...ARGS, '--excute']],
  ['no arguments', []],
  ['no operator', ['--github-id', '4242']],
  ['no person', ['--actor-github-id', '9001']],
  ['the person given twice', [...ARGS, '--github-id', '1']],
  ['--execute given twice', [...EXECUTE, '--execute']],
  ['a zero id', ['--github-id', '0', '--actor-github-id', '9001']],
  ['a negative id', ['--github-id', '-4242', '--actor-github-id', '9001']],
  ['a fractional id', ['--github-id', '42.5', '--actor-github-id', '9001']],
  ['an exponent', ['--github-id', '1e3', '--actor-github-id', '9001']],
  ['an unsafe id', ['--github-id', '9007199254740993', '--actor-github-id', '9001']],
  ['words', ['--github-id', 'zzzz', '--actor-github-id', '9001']],
  ['the --flag=value spelling', ['--github-id=4242', '--actor-github-id=9001']],
])('%s is a usage error: exit 2, the usage on stderr, nothing connected, nothing printed', async (_label, argv) => {
  const { out, err, connect, run } = await scene();
  expect(await run(argv)).toBe(2);
  expect(err).toEqual([USAGE]);
  expect(out).toEqual([]);
  expect(connect).not.toHaveBeenCalled();
});

test('a usage error never echoes the argument that caused it', async () => {
  const { err, run } = await scene();
  await run(['--github-id', "zzzz'; DROP TABLE users;--", '--actor-github-id', '9001']);
  expect(err.join('\n')).not.toContain('zzzz');
});

test('an invalid environment exits 1 naming the variable, and connects to nothing', async () => {
  const { out, err, connect, run } = await scene();
  expect(await run(ARGS, { env: {} })).toBe(1);
  expect(err).toEqual([expect.stringMatching(/^erase failed: DATABASE_URL: must be a postgres/)]);
  expect(out).toEqual([]);
  expect(connect).not.toHaveBeenCalled();
});

test('it connects with the runtime connection string, which is never printed, and closes the connection', async () => {
  const { out, err, connect, destroy, run } = await scene();
  await run(EXECUTE);
  expect(connect).toHaveBeenCalledExactlyOnceWith(URL_WITH_PASSWORD, expect.any(Function));
  expect(destroy).toHaveBeenCalledOnce();
  expect([...out, ...err].join('\n')).not.toContain('s3cr3t');
});

test('a function that erases nothing is caught by the check after the loop: exit 3 with the counts, and nothing on stdout', async () => {
  const { world, out, err, destroy, run } = await scene();
  await replaceWithNoOp(world.db);
  expect(await run(EXECUTE)).toBe(3);
  expect(err).toEqual([
    'erase failed: the check after the erasure of GitHub id 4242 does not hold',
    'signer_pii rows left: 2',
    `installation ${world.t1.installationId}: 1 signer_pii rows left`,
    `installation ${world.t2.installationId}: 1 signer_pii rows left`,
    'users snapshot scrubbed: no',
  ]);
  expect(out).toEqual([]);
  expect(destroy).toHaveBeenCalledOnce();
});

test('a call that fails part-way exits 4 with the installations done and pending, and a rerun finishes the erasure', async () => {
  const { world, out, err, destroy, run } = await scene();
  const { t1, t2 } = world;
  const lost = Object.assign(new Error('connection to zzzz-host lost'), { code: '08006' });
  const failing = closable(world.db.withPlugin(failStatement(callFor(t2.installationId), 1, lost)));
  expect(await run(EXECUTE, { connect: () => failing.handle })).toBe(4);
  expect(err).toEqual([
    'erase failed: Error (08006)',
    `installations done: ${t1.installationId}; pending: ${t2.installationId}; running the command again is safe`,
  ]);
  expect(out).toEqual([]);
  expect(err.join('\n')).not.toContain('zzzz');
  expect(failing.destroy).toHaveBeenCalledOnce();
  expect(destroy).not.toHaveBeenCalled();
  err.length = 0;
  expect(await run(EXECUTE)).toBe(0);
  expect(out[0]).toBe(
    'erased GitHub id 4242: 1 signer_pii rows deleted in 2 installations, 2 signature cores kept, users snapshot scrubbed',
  );
  expect(await rowsOf(world.db, TARGET)).toEqual([]);
});

test('a failure of the read after the loop exits 4 with every installation done and none pending', async () => {
  const { world, err, run } = await scene();
  const failing = closable(world.db.withPlugin(failStatement(footprintRead, 2, new TypeError('zzzz'))));
  expect(await run(EXECUTE, { connect: () => failing.handle })).toBe(4);
  expect(err).toEqual([
    'erase failed: TypeError',
    `installations done: ${world.t1.installationId}, ${world.t2.installationId}; pending: none; running the command again is safe`,
  ]);
});

test('a failure before anything was changed exits 1 and prints the name and the code of the error, never its message or the row it quotes', async () => {
  const { world, out, err, run } = await scene();
  const { handle, destroy } = closable(brokenDatabase(world.db));
  expect(await run(ARGS, { connect: () => handle })).toBe(1);
  expect(err).toEqual(['erase failed: error (23505)']);
  expect(out).toEqual([]);
  expect(destroy).toHaveBeenCalledOnce();
});

test('a thrown value that is not an error is reported without its text', async () => {
  const { world, err, run } = await scene();
  const { handle } = closable(
    world.db.withPlugin({
      transformQuery: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the test throws a value that is not an error on purpose
        throw 'zzzz-not-an-error';
      },
      transformResult: (args) => Promise.resolve(args.result),
    }),
  );
  expect(await run(ARGS, { connect: () => handle })).toBe(1);
  expect(err).toEqual(['erase failed: unknown error']);
});

test('an error of the connection pool outside a query is printed as a database error with its code only', async () => {
  const { err, connect, run } = await scene();
  await run(ARGS);
  const onError = connect.mock.calls[0]?.[1];
  onError?.(Object.assign(new Error('terminating connection zzzz'), { code: '57P01' }));
  expect(err).toEqual(['erase: database error (57P01)']);
});

test('as the runtime role the command erases through the function while a direct delete of signer_pii is refused', async () => {
  const { world, out, err, run } = await scene();
  await onRuntimeConnection(world.db, async (connection) => {
    await expect(sql`delete from signer_pii`.execute(connection)).rejects.toMatchObject({ code: '42501' });
    const { handle } = closable(connection);
    expect(await run(ARGS, { connect: () => handle })).toBe(0);
    expect(await run(EXECUTE, { connect: () => handle })).toBe(0);
  });
  expect(err).toEqual([]);
  expect(out).toContainEqual(expect.stringContaining('erased GitHub id 4242'));
  expect(await rowsOf(world.db, TARGET)).toEqual([]);
  expect((await erasureAudit(world.db)).map((row) => row.metadata)).toEqual([
    { signer_pii_rows: 1 },
    { signer_pii_rows: 1 },
  ]);
});

test('without sinks it writes to stdout and stderr', async () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const { world } = await scene();
  const connect = vi.fn<Connect>(() => closable(world.db).handle);
  expect(await runEraseCli({ argv: ARGS, env: ENV, connect })).toBe(0);
  expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
    'erase dry run for GitHub id 4242: 2 signer_pii rows in 2 installations',
  );
  expect(await runEraseCli({ argv: ['--bad'], env: ENV, connect })).toBe(2);
  expect(stderr.mock.calls).toEqual([[`${USAGE}\n`]]);
});
