// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { NAME_PATTERN } from './container-owner.ts';
import { containerName, runPostgresCli } from './postgres-cli.ts';
import type { CliDeps } from './postgres-deps.ts';
import { collectIo, fail, fakeDocker, ok } from './test-support.ts';

const PASSWORD = 'a'.repeat(48);
/** What `docker container inspect` prints for a container that carries our label. */
const OWNED = ['container', [ok('postgres\n')]] as const;
const ACTIONS = { GITHUB_ENV: '/runner/env-file', GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '2' };

/** Fake dependencies: a scripted docker, fixed randomness, and the appended GITHUB_ENV text recorded. */
function cliDeps(docker = fakeDocker([['inspect', [ok('running healthy')]]])) {
  const appended: [string, string][] = [];
  const deps: CliDeps = {
    exec: docker.exec,
    pickPort: () => Promise.resolve(41_000),
    sleep: () => Promise.resolve(),
    now: () => 0,
    randomHex: (bytes) => (bytes === 24 ? PASSWORD : 'beef0001'),
    appendFile: (file, text) => {
      appended.push([file, text]);
    },
  };
  return { deps, appended, docker };
}

test.each([
  ['GitHub run id and attempt', { GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '2' }, 'cla-pg-123456-2-beef0001'],
  ['no GitHub variables', {}, 'cla-pg-local-beef0001'],
  ['a run id without an attempt', { GITHUB_RUN_ID: '123456' }, 'cla-pg-local-beef0001'],
  ['an attempt without a run id', { GITHUB_RUN_ATTEMPT: '2' }, 'cla-pg-local-beef0001'],
  [
    'a run id that is not a plain number',
    { GITHUB_RUN_ID: '1;rm -rf /', GITHUB_RUN_ATTEMPT: '1' },
    'cla-pg-local-beef0001',
  ],
  ['a run id with a path in it', { GITHUB_RUN_ID: '../x', GITHUB_RUN_ATTEMPT: '1' }, 'cla-pg-local-beef0001'],
  ['a run id of 21 digits', { GITHUB_RUN_ID: '1'.repeat(21), GITHUB_RUN_ATTEMPT: '1' }, 'cla-pg-local-beef0001'],
  ['an empty run id', { GITHUB_RUN_ID: '', GITHUB_RUN_ATTEMPT: '1' }, 'cla-pg-local-beef0001'],
])('the container name for %s', (_what, env, expected) => {
  const name = containerName(env, 'beef0001');
  expect(name).toBe(expected);
  expect(NAME_PATTERN.test(name)).toBe(true);
});

test('start under Actions masks the password first and exports the name before docker runs', async () => {
  const { deps, appended, docker } = cliDeps();
  const { io, out, err } = collectIo();
  expect(await runPostgresCli(['start'], ACTIONS, io, deps)).toBe(0);
  expect(out[0]).toBe(`::add-mask::${PASSWORD}`);
  expect(out.at(-1)).toBe('container cla-pg-123456-2-beef0001 is healthy on 127.0.0.1:41000');
  expect(appended).toEqual([
    ['/runner/env-file', 'CLA_PG_CONTAINER=cla-pg-123456-2-beef0001\n'],
    ['/runner/env-file', `DATABASE_URL=postgres://postgres:${PASSWORD}@127.0.0.1:41000/postgres\n`],
  ]);
  expect(out.join('\n')).not.toContain('DATABASE_URL');
  expect(err).toEqual([]);
  expect(docker.calls[0]?.args[0]).toBe('run');
});

test('start outside Actions prints the assignments and has nothing to mask', async () => {
  const { deps, appended } = cliDeps();
  const { io, out } = collectIo();
  expect(await runPostgresCli(['start'], {}, io, deps)).toBe(0);
  expect(appended).toEqual([]);
  expect(out).toEqual([
    'CLA_PG_CONTAINER=cla-pg-local-beef0001',
    `DATABASE_URL=postgres://postgres:${PASSWORD}@127.0.0.1:41000/postgres`,
    'container cla-pg-local-beef0001 is healthy on 127.0.0.1:41000',
  ]);
});

test('an empty GITHUB_ENV counts as unset', async () => {
  const { deps, appended } = cliDeps();
  const { io, out } = collectIo();
  expect(await runPostgresCli(['start'], { GITHUB_ENV: '' }, io, deps)).toBe(0);
  expect(appended).toEqual([]);
  expect(out[0]).toBe('CLA_PG_CONTAINER=cla-pg-local-beef0001');
});

test('a failed start is reported line by line, with every continuation line prefixed and escaped', async () => {
  const docker = fakeDocker([
    ['inspect', [ok('running unhealthy')]],
    ['logs', [{ code: 0, stdout: '::error::forged\u001b[31m\nsecond', stderr: '' }]],
  ]);
  const { deps, appended } = cliDeps(docker);
  const { io, out, err } = collectIo();
  expect(await runPostgresCli(['start'], ACTIONS, io, deps)).toBe(1);
  expect(err).toEqual([
    'ci-postgres start: container cla-pg-123456-2-beef0001 is running (unhealthy):',
    '| ::error::forged\\x1b[31m',
    '| second',
  ]);
  expect(out).toEqual([`::add-mask::${PASSWORD}`]);
  expect(appended).toEqual([['/runner/env-file', 'CLA_PG_CONTAINER=cla-pg-123456-2-beef0001\n']]);
});

test('a thrown value that is not an Error is still reported', async () => {
  const { deps } = cliDeps();
  const { io, err } = collectIo();
  const throwing: CliDeps = {
    ...deps,
    randomHex: () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the point of the test: a thrown value that is not an Error
      throw 'plain string';
    },
  };
  expect(await runPostgresCli(['start'], {}, io, throwing)).toBe(1);
  expect(err).toEqual(['ci-postgres start: plain string']);
});

const RECORDED = { CLA_PG_CONTAINER: 'cla-pg-1-1-abcd' };
const NOTHING = 'no container recorded in CLA_PG_CONTAINER: nothing to remove';

test.each([
  {
    what: 'removes the recorded container',
    env: RECORDED,
    reply: ok('cla-pg-1-1-abcd\n'),
    line: 'container cla-pg-1-1-abcd: removed',
    calls: 2,
  },
  {
    what: 'is idempotent when it is gone',
    env: RECORDED,
    reply: ok(''),
    line: 'container cla-pg-1-1-abcd: absent',
    calls: 2,
  },
  { what: 'has nothing to do without a name', env: {}, reply: ok(''), line: NOTHING, calls: 0 },
  { what: 'treats an empty name as none', env: { CLA_PG_CONTAINER: '' }, reply: ok(''), line: NOTHING, calls: 0 },
])('stop $what', async ({ env, reply, line, calls }) => {
  const { deps, docker } = cliDeps(fakeDocker([OWNED, ['rm', [reply]]]));
  const { io, out } = collectIo();
  expect(await runPostgresCli(['stop'], env, io, deps)).toBe(0);
  expect(out).toEqual([line]);
  expect(docker.calls).toHaveLength(calls);
});

test('stop refuses a hostile name from the environment and reports a docker failure', async () => {
  const { deps } = cliDeps(fakeDocker([OWNED, ['rm', [fail('daemon down')]]]));
  const first = collectIo();
  expect(await runPostgresCli(['stop'], { CLA_PG_CONTAINER: '-rf' }, first.io, deps)).toBe(1);
  expect(first.err).toEqual(['ci-postgres stop: refusing to remove a container with an unexpected name']);
  const second = collectIo();
  expect(await runPostgresCli(['stop'], { CLA_PG_CONTAINER: 'cla-pg-good-name' }, second.io, deps)).toBe(1);
  expect(second.err).toEqual(['ci-postgres stop: docker rm failed: daemon down']);
});

test.each([[[]], [['restart']], [['start', 'extra']], [['stop', '--force']]])('usage error for %j', async (argv) => {
  const { deps, docker } = cliDeps();
  const { io, err } = collectIo();
  expect(await runPostgresCli(argv, {}, io, deps)).toBe(2);
  expect(err).toEqual(['usage: ci-postgres <start|stop>']);
  expect(docker.calls).toEqual([]);
});

test('two helpers at once get distinct ports and distinct container names', async () => {
  const ports = [41_000, 41_001, 41_002, 41_003];
  const tails = ['00000001', '00000002'];
  const docker = fakeDocker([['inspect', [ok('running healthy')]]]);
  const shared = (): CliDeps => ({
    ...cliDeps(docker).deps,
    pickPort: () => Promise.resolve(ports.shift() ?? 0),
    randomHex: (bytes) => (bytes === 24 ? PASSWORD : (tails.shift() ?? 'ffffffff')),
  });
  const results = await Promise.all([
    runPostgresCli(['start'], ACTIONS, collectIo().io, shared()),
    runPostgresCli(['start'], ACTIONS, collectIo().io, shared()),
  ]);
  expect(results).toEqual([0, 0]);
  const runs = docker.calls.filter((call) => call.args[0] === 'run');
  expect(new Set(runs.map((call) => call.args[3])).size).toBe(2);
  expect(new Set(runs.map((call) => call.args[7])).size).toBe(2);
});
