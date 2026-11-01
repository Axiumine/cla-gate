// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { expect, test } from 'vitest';
import { collectIo, fakeDocker, ok } from '../../ci/lib/test-support.ts';
import { makeRepo, tempDir } from '../../code-caps/test-support.ts';
import { exitCodeOf } from './child-runner.ts';
import { connectionUrl } from './dev-db.ts';
import { type CliDeps, runDevDbCli, systemDeps } from './dev-db-cli.ts';

/** A repository root, optionally with a remembered port, and fake dependencies that record `run` calls. */
function setup(port?: number) {
  const root = tempDir();
  makeRepo(root, port === undefined ? {} : { '.local/db.json': `{"port":${port}}\n` });
  const docker = fakeDocker([['compose', [ok('id\n')]]]);
  const runs: [string, readonly string[], Readonly<Record<string, string>>][] = [];
  const deps: CliDeps = {
    exec: docker.exec,
    pickPort: () => Promise.resolve(41_000),
    run: (command, args, env) => {
      runs.push([command, args, env]);
      return Promise.resolve(7);
    },
  };
  return { root, docker, deps, runs, ...collectIo() };
}

async function dispatch(argv: string[], env: Record<string, string> = {}, port?: number) {
  const s = setup(port);
  const code = await runDevDbCli(argv, { root: s.root, env, deps: s.deps, io: s.io });
  return { code, ...s };
}

const USAGE_FIRST = 'usage: db <command>';

test('up starts the database and says where it listens', async () => {
  const { code, out, docker } = await dispatch(['up']);
  expect(code).toBe(0);
  expect(out).toEqual(['PostgreSQL 18 is up on 127.0.0.1:41000 (yarn db:url prints the connection strings)']);
  expect(docker.calls).toHaveLength(1);
});

test('url prints the pieces: host, port and both connection strings', async () => {
  const { code, out } = await dispatch(['url'], {}, 41_234);
  expect(code).toBe(0);
  expect(out).toEqual([
    'POSTGRES_HOST=127.0.0.1',
    'POSTGRES_PORT=41234',
    `DATABASE_URL=${connectionUrl('app', 41_234)}`,
    `MIGRATION_DATABASE_URL=${connectionUrl('owner', 41_234)}`,
  ]);
});

test.each([
  ['app', 'app'],
  ['owner', 'owner'],
] as const)('url %s prints one bare URL', async (role, expectedRole) => {
  const { code, out } = await dispatch(['url', role], {}, 41_234);
  expect(code).toBe(0);
  expect(out).toEqual([connectionUrl(expectedRole, 41_234)]);
});

test('url without a database says what to run and exits 1', async () => {
  const { code, out, err } = await dispatch(['url']);
  expect(code).toBe(1);
  expect(out).toEqual([]);
  expect(err).toEqual([
    'db: no development database is recorded: run "yarn db:up" first, or set the URL variable yourself',
  ]);
});

test.each([
  ['down', ['down'], ['down']],
  ['down --volumes', ['down', '--volumes'], ['down', '--volumes']],
])('%s tears the stack down', async (_what, argv, tail) => {
  const { code, out, docker } = await dispatch(argv, {}, 41_000);
  expect(code).toBe(0);
  expect(out).toEqual(['PostgreSQL stopped and removed']);
  expect(docker.calls[0]?.args.slice(5)).toEqual(tail);
});

test('run starts the command with the remembered URL in the variable of the role', async () => {
  const app = await dispatch(['run', 'app', '--', 'node', '--watch', 'x.ts'], {}, 41_000);
  expect(app.code).toBe(7);
  expect(app.runs).toEqual([
    ['node', ['--watch', 'x.ts'], { DATABASE_URL: connectionUrl('app', 41_000), PORT: '41000' }],
  ]);
  const owner = await dispatch(['run', 'owner', '--', 'node', 'migrate.ts'], {}, 41_000);
  expect(owner.runs).toEqual([['node', ['migrate.ts'], { MIGRATION_DATABASE_URL: connectionUrl('owner', 41_000) }]]);
});

test.each([
  ['an explicit variable', { DATABASE_URL: 'postgres://elsewhere/db' }],
  ['an explicit variable with no database recorded', { DATABASE_URL: 'x' }],
])('run lets %s win over the remembered database', async (_what, env) => {
  const { code, runs } = await dispatch(['run', 'app', '--', 'node', 'x.ts'], env);
  expect(code).toBe(7);
  expect(runs).toEqual([['node', ['x.ts'], { PORT: '41000' }]]);
});

test('run treats an empty variable as unset', async () => {
  const { runs } = await dispatch(['run', 'app', '--', 'node'], { DATABASE_URL: '', PORT: '' }, 41_000);
  expect(runs).toEqual([['node', [], { DATABASE_URL: connectionUrl('app', 41_000), PORT: '41000' }]]);
});

test('the dev server gets a random free port and the output says which, so nobody has to guess 3000', async () => {
  const { runs, out } = await dispatch(['run', 'app', '--', 'node', 'x.ts'], {}, 41_234);
  expect(runs[0]?.[2]['PORT']).toBe('41000');
  expect(out).toEqual(['app: http://127.0.0.1:41000 (PORT was not set: a random free port above 32768)']);
});

test('an explicit PORT is kept: nothing is picked and nothing is printed', async () => {
  const { runs, out } = await dispatch(['run', 'app', '--', 'node', 'x.ts'], { PORT: '45678' }, 41_234);
  expect(runs).toEqual([['node', ['x.ts'], { DATABASE_URL: connectionUrl('app', 41_234) }]]);
  expect(out).toEqual([]);
});

test('the migration run (owner) needs no port', async () => {
  const { runs, out } = await dispatch(['run', 'owner', '--', 'node', 'migrate.ts'], {}, 41_234);
  expect(runs).toEqual([['node', ['migrate.ts'], { MIGRATION_DATABASE_URL: connectionUrl('owner', 41_234) }]]);
  expect(out).toEqual([]);
});

test('run without a database and without a variable fails before starting anything', async () => {
  const { code, runs, err } = await dispatch(['run', 'app', '--', 'node']);
  expect(code).toBe(1);
  expect(runs).toEqual([]);
  expect(err[0]).toContain('run "yarn db:up" first');
});

test.each([
  ['no command', []],
  ['an unknown command', ['restart']],
  ['up with an argument', ['up', 'now']],
  ['down with another flag', ['down', '--all']],
  ['down with two arguments', ['down', '--volumes', 'x']],
  ['url with an unknown role', ['url', 'admin']],
  ['url with two arguments', ['url', 'app', 'owner']],
  ['run without a role', ['run']],
  ['run with an unknown role', ['run', 'admin', '--', 'node']],
  ['run without the separator', ['run', 'app', 'node']],
  ['run without a command', ['run', 'app', '--']],
])('%s is a usage error', async (_what, argv) => {
  const { code, out, err, runs, docker } = await dispatch(argv);
  expect(code).toBe(2);
  expect(out).toEqual([]);
  expect(err[0]).toBe(USAGE_FIRST);
  expect(err).toHaveLength(6);
  expect(runs).toEqual([]);
  expect(docker.calls).toEqual([]);
});

test('a thrown value that is not an Error is still reported', async () => {
  const s = setup();
  const deps: CliDeps = {
    ...s.deps,
    pickPort: () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the point of the test: a thrown value that is not an Error
      throw 'plain string';
    },
  };
  expect(await runDevDbCli(['up'], { root: s.root, env: {}, deps, io: s.io })).toBe(1);
  expect(s.err).toEqual(['db: plain string']);
});

/** Runs a Node one-liner through the real child runner. */
function child(program: string, env: Record<string, string> = {}) {
  return systemDeps.run(process.execPath, ['-e', program], env);
}

test('the real runner returns the exit code of the command', async () => {
  expect(await child('process.exit(5)')).toBe(5);
  expect(await child('process.exit(0)')).toBe(0);
});

test('the real runner adds the environment for the child only', async () => {
  const code = await child('process.exit(process.env.CLA_DB_TEST === "yes" ? 0 : 9)', { CLA_DB_TEST: 'yes' });
  expect(code).toBe(0);
  expect(process.env['CLA_DB_TEST']).toBeUndefined();
});

test('a child killed by a signal exits with 128 plus the signal number', async () => {
  expect(await child("process.kill(process.pid, 'SIGKILL')")).toBe(137);
});

test('a command that does not exist exits with 127', async () => {
  expect(await systemDeps.run('definitely-not-a-real-binary-cla', [], {})).toBe(127);
});

test('SIGTERM sent to the wrapper reaches the child, and the handlers are removed afterwards', async () => {
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  const finished = child('setInterval(() => {}, 1000)');
  process.emit('SIGTERM');
  expect(await finished).toBe(143);
  expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
});

test('SIGINT is forwarded too', async () => {
  const finished = child('setInterval(() => {}, 1000)');
  process.emit('SIGINT');
  expect(await finished).toBe(130);
});

test('the system dependencies use the real docker runner and the real port picker', async () => {
  const port = await systemDeps.pickPort();
  expect(port).toBeGreaterThanOrEqual(32_769);
  const result = await systemDeps.exec(process.execPath, ['-e', 'process.stdout.write("hi")']);
  expect(result.stdout).toBe('hi');
});

test.each([
  ['its own code', 7, null, 7],
  ['code zero', 0, null, 0],
  ['SIGTERM', null, 'SIGTERM', 143],
  ['SIGKILL', null, 'SIGKILL', 137],
  ['neither a code nor a signal', null, null, 1],
] as const)('a child that ended with %s exits with %d', (_what, code, signal, expected) => {
  expect(exitCodeOf(code, signal)).toBe(expected);
});
