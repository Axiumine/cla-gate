// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { ContainerError } from './container-health.ts';
import type { ExecResult } from './exec.ts';
import { PortError } from './ports.ts';
import { type StartDeps, startPostgres, stopPostgres } from './postgres-container.ts';
import { CONTAINER_LABEL, databaseUrl, NAME_PATTERN, POSTGRES_IMAGE, runArguments } from './postgres-run.ts';
import { fail, fakeDocker, ok } from './test-support.ts';

const NAME = 'cla-pg-1-1-abcd1234';
const PASSWORD = 'f00dfacecafe';
const HEALTHY = ok('running healthy\n');
const STARTING = ok('running starting\n');
/** What `docker container inspect` prints for a container that carries our label. */
const OWNED: readonly [string, readonly ExecResult[]] = ['container', [ok('postgres\n')]];
const INSPECT_CALL = {
  file: 'docker',
  args: ['container', 'inspect', '--format', '{{index .Config.Labels "cla-gate.ci"}}', NAME],
  env: undefined,
};
const REMOVE_CALL = { file: 'docker', args: ['rm', '--force', '--volumes', NAME], env: undefined };

/** Dependencies on a fake clock: sleeping advances time, so a timeout needs no real waiting. */
function deps(exec: StartDeps['exec'], ports: number[] = [41_000]): StartDeps & { sleeps: number[] } {
  let clock = 0;
  const sleeps: number[] = [];
  return {
    exec,
    pickPort: () => Promise.resolve(ports.shift() ?? 41_999),
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    now: () => clock,
    sleeps,
  };
}

test('the pinned image is the postgres 18 tag with a sha256 digest', () => {
  expect(POSTGRES_IMAGE).toMatch(/^postgres:18@sha256:[0-9a-f]{64}$/);
});

test('docker run publishes loopback only, labels the container and takes the password from the environment', () => {
  expect(runArguments(NAME, 41_000, POSTGRES_IMAGE)).toEqual([
    'run',
    '--detach',
    '--name',
    NAME,
    '--label',
    CONTAINER_LABEL,
    '--publish',
    '127.0.0.1:41000:5432',
    '--env',
    'POSTGRES_USER=postgres',
    '--env',
    'POSTGRES_PASSWORD',
    '--health-cmd',
    'pg_isready -h 127.0.0.1 -U postgres',
    '--health-interval',
    '2s',
    '--health-timeout',
    '3s',
    '--health-retries',
    '30',
    POSTGRES_IMAGE,
  ]);
});

test('the connection string uses the loopback address, the port and the generated password', () => {
  expect(databaseUrl(PASSWORD, 41_000)).toBe(`postgres://postgres:${PASSWORD}@127.0.0.1:41000/postgres`);
});

test('start runs docker, waits for healthy and never puts the password on the command line', async () => {
  const docker = fakeDocker([
    ['run', [ok('container-id\n')]],
    ['inspect', [STARTING, STARTING, HEALTHY]],
  ]);
  const d = deps(docker.exec);
  const started = await startPostgres(d, { name: NAME, password: PASSWORD });
  expect(started).toEqual({ name: NAME, port: 41_000, url: databaseUrl(PASSWORD, 41_000) });
  expect(docker.calls[0]).toEqual({
    file: 'docker',
    args: runArguments(NAME, 41_000, POSTGRES_IMAGE),
    env: { POSTGRES_PASSWORD: PASSWORD },
  });
  expect(JSON.stringify(docker.calls.map((call) => call.args))).not.toContain(PASSWORD);
  expect(docker.calls.filter((call) => call.args[0] === 'inspect')).toHaveLength(3);
  expect(d.sleeps).toEqual([1000, 1000]);
});

test('an explicit image is used instead of the pinned one', async () => {
  const docker = fakeDocker([['inspect', [HEALTHY]]]);
  await startPostgres(deps(docker.exec), { name: NAME, password: PASSWORD, image: 'postgres:18-alpine' });
  expect(docker.calls[0]?.args.at(-1)).toBe('postgres:18-alpine');
});

test('a port lost in the meantime removes the half-created container and tries a new random port', async () => {
  const taken = fail(
    'docker: Error response from daemon: Bind for 127.0.0.1:41000 failed: port is already allocated.',
    125,
  );
  const docker = fakeDocker([['run', [taken, ok('id')]], OWNED, ['inspect', [HEALTHY]]]);
  const started = await startPostgres(deps(docker.exec, [41_000, 41_001]), { name: NAME, password: PASSWORD });
  expect(started.port).toBe(41_001);
  const verbs = docker.calls.map((call) => call.args[0]);
  expect(verbs).toEqual(['run', 'container', 'rm', 'run', 'inspect']);
  expect(docker.calls[1]).toEqual(INSPECT_CALL);
  expect(docker.calls[2]).toEqual(REMOVE_CALL);
});

test('a port that is always lost ends in a PortError and leaves nothing behind', async () => {
  const docker = fakeDocker([['run', [fail('port is already allocated', 125)]], OWNED]);
  const attempt = startPostgres(deps(docker.exec), { name: NAME, password: PASSWORD, portAttempts: 2 });
  await expect(attempt).rejects.toThrow(PortError);
  expect(docker.calls.filter((call) => call.args[0] === 'run')).toHaveLength(2);
  expect(docker.calls.at(-1)?.args[0]).toBe('rm');
});

test('another docker failure is reported with its first line and the container is removed', async () => {
  const docker = fakeDocker([['run', [fail('Unable to find image\npull access denied for postgres', 125)]], OWNED]);
  const attempt = startPostgres(deps(docker.exec), { name: NAME, password: PASSWORD });
  await expect(attempt).rejects.toThrow(new ContainerError('docker run failed: Unable to find image'));
  expect(docker.calls.map((call) => call.args[0])).toEqual(['run', 'container', 'rm']);
});

test.each([
  ['an unhealthy container', ok('running unhealthy'), 'is running (unhealthy)'],
  ['a container that exited', ok('exited starting'), 'is exited (starting)'],
  ['a container that is gone', fail('Error: No such object'), 'is gone (no health)'],
])('%s fails at once, with the last log lines, and the container is removed', async (_what, state, reason) => {
  const docker = fakeDocker([
    ['inspect', [state]],
    ['logs', [{ code: 0, stdout: 'line one\n', stderr: 'line two\n' }]],
    OWNED,
  ]);
  const attempt = startPostgres(deps(docker.exec), { name: NAME, password: PASSWORD });
  await expect(attempt).rejects.toThrow(new ContainerError(`container ${NAME} ${reason}:\nline one\nline two`));
  expect(docker.calls.map((call) => call.args[0])).toEqual(['run', 'inspect', 'logs', 'container', 'rm']);
  expect(docker.calls.find((call) => call.args[0] === 'logs')?.args).toEqual(['logs', '--tail', '20', NAME]);
});

test('a container that stays in "starting" is given up on at the deadline', async () => {
  const docker = fakeDocker([['inspect', [STARTING]]]);
  const d = deps(docker.exec);
  const attempt = startPostgres(d, { name: NAME, password: PASSWORD, healthTimeoutMs: 3000 });
  await expect(attempt).rejects.toThrow(`container ${NAME} was not healthy after 3000 ms`);
  expect(d.sleeps).toEqual([1000, 1000, 1000]);
});

test('the cleanup after a failure never hides the original error', async () => {
  const docker = fakeDocker([
    ['run', [fail('boom', 125)]],
    OWNED,
    ['rm', [fail('Error response from daemon: removal of container is already in progress')]],
  ]);
  const attempt = startPostgres(deps(docker.exec), { name: NAME, password: PASSWORD });
  await expect(attempt).rejects.toThrow('docker run failed: boom');
});

test.each([
  ['removed', ok(`${NAME}\n`), 'removed'],
  ['already gone, silently', ok(''), 'absent'],
  ['already gone, with an error', fail(`Error response from daemon: No such container: ${NAME}`), 'absent'],
])('stop is idempotent: %s', async (_case, reply, expected) => {
  const docker = fakeDocker([OWNED, ['rm', [reply]]]);
  expect(await stopPostgres(docker.exec, NAME)).toBe(expected);
  expect(docker.calls).toEqual([INSPECT_CALL, REMOVE_CALL]);
});

test.each([
  ['Error response from daemon: No such container: cla-pg-1-1-abcd1234'],
  ['Error: No such object: cla-pg-1-1-abcd1234'],
])('stop does not touch a container that does not exist: %s', async (stderr) => {
  const docker = fakeDocker([['container', [fail(stderr)]]]);
  expect(await stopPostgres(docker.exec, NAME)).toBe('absent');
  expect(docker.calls).toEqual([INSPECT_CALL]);
});

test.each([
  ['a container without our label', ok('\n')],
  ['a container with another value of the label', ok('mysql\n')],
])('stop refuses %s and never calls docker rm', async (_case, reply) => {
  const docker = fakeDocker([['container', [reply]]]);
  await expect(stopPostgres(docker.exec, NAME)).rejects.toThrow(
    new ContainerError(`refusing to remove container ${NAME}: it does not carry the label cla-gate.ci=postgres`),
  );
  expect(docker.calls).toEqual([INSPECT_CALL]);
});

test('stop reports an inspect failure that is not "no such container" and removes nothing', async () => {
  const docker = fakeDocker([['container', [fail('Cannot connect to the Docker daemon\nIs the daemon running?')]]]);
  await expect(stopPostgres(docker.exec, NAME)).rejects.toThrow(
    new ContainerError('docker inspect failed: Cannot connect to the Docker daemon'),
  );
  expect(docker.calls).toEqual([INSPECT_CALL]);
});

test('a name that is already taken fails the start and leaves the container that owns it alone', async () => {
  const taken = fail(
    `docker: Error response from daemon: Conflict. The container name "/${NAME}" is already in use by container "f00d". You have to remove (or rename) that container to be able to reuse that name.`,
    125,
  );
  const docker = fakeDocker([['run', [taken]], OWNED]);
  const attempt = startPostgres(deps(docker.exec), { name: NAME, password: PASSWORD });
  await expect(attempt).rejects.toThrow(/^docker run failed: docker: Error response from daemon: Conflict\./);
  expect(docker.calls.map((call) => call.args[0])).toEqual(['run']);
});

test('stop reports a docker failure that is not "no such container"', async () => {
  const docker = fakeDocker([OWNED, ['rm', [fail('Cannot connect to the Docker daemon\nIs the daemon running?')]]]);
  await expect(stopPostgres(docker.exec, NAME)).rejects.toThrow(
    new ContainerError('docker rm failed: Cannot connect to the Docker daemon'),
  );
});

test.each([
  [''],
  ['-rf'],
  ['--all'],
  ['a b'],
  ['a/b'],
  ['x'.repeat(64)],
  ['name;rm'],
  ['é'],
  ['postgres'],
  ['cla-review-sec-foreign'],
  ['cla-pg'],
  ['xcla-pg-1-1-abcd1234'],
])('stop refuses the container name %j without calling docker', async (name) => {
  const exec = vi.fn(fakeDocker().exec);
  await expect(stopPostgres(exec, name)).rejects.toThrow('refusing to remove a container with an unexpected name');
  expect(exec).not.toHaveBeenCalled();
});

test.each([['a'], ['cla-pg-123-1-ab12cd34'], ['A_b.c-9'], ['x'.repeat(63)]])('the name %j is accepted', (name) => {
  expect(NAME_PATTERN.test(name)).toBe(true);
});
