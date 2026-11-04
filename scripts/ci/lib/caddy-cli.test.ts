// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { DEFAULT_ORIGINS, runCaddyCli } from './caddy-cli.ts';
import type { CaddyDeps } from './caddy-deps.ts';
import { CADDY_IMAGE, validateArguments } from './caddy-run.ts';
import { collectIo, fail, fakeDocker, ok } from './test-support.ts';

const ACTIONS = { GITHUB_ENV: '/runner/env-file', GITHUB_RUN_ID: '77', GITHUB_RUN_ATTEMPT: '3' };
const NAME = 'cla-caddy-77-3-beef0001';
const CADDYFILE = '/work/repo/docker/Caddyfile';
/** What `docker container inspect` prints for a container that carries our label. */
const OWNED = ['container', [ok('caddy\n')]] as const;

/** Fake dependencies: a scripted docker, fixed randomness, a fixed user and Caddyfile, the appended GITHUB_ENV text recorded. */
function fakes(docker = fakeDocker(), user = { uid: 1001, gid: 121 }, caddyfile = CADDYFILE) {
  const events: string[] = [];
  const deps: CaddyDeps = {
    exec: (file, args, env) => {
      events.push(`docker ${args[0] ?? ''}`);
      return docker.exec(file, args, env);
    },
    randomHex: () => 'beef0001',
    appendFile: (file, text) => {
      events.push(`env ${file} ${text.trim()}`);
    },
    user: () => user,
    caddyfile,
  };
  return { deps, events, docker };
}

const runsOf = (docker: ReturnType<typeof fakeDocker>) => docker.calls.filter((call) => call.args[0] === 'run');
const originOf = (args: readonly string[]) => args.find((arg) => arg.startsWith('PUBLIC_BASE_URL='));

test('with no origin given it checks the one of the TLS smoke scenario and a public name, one after the other', async () => {
  const { deps, events, docker } = fakes();
  const { io, out, err } = collectIo();
  expect(await runCaddyCli(['validate'], ACTIONS, io, deps)).toBe(0);
  expect(DEFAULT_ORIGINS).toEqual(['https://localhost', 'https://cla.example.com']);
  expect(runsOf(docker).map((call) => originOf(call.args))).toEqual([
    'PUBLIC_BASE_URL=https://localhost',
    'PUBLIC_BASE_URL=https://cla.example.com',
  ]);
  expect(out).toEqual(['caddy validate https://localhost: valid', 'caddy validate https://cla.example.com: valid']);
  expect(err).toEqual([]);
  expect(events).toEqual([`env /runner/env-file CLA_CADDY_CONTAINER=${NAME}`, 'docker run', 'docker run']);
});

test('it runs the pinned image on the Caddyfile of the checkout as the runner user, under the per-run name', async () => {
  const { deps, docker } = fakes();
  await runCaddyCli(['validate', 'https://cla.example.com'], ACTIONS, collectIo().io, deps);
  expect(docker.calls).toHaveLength(1);
  expect(docker.calls[0]?.file).toBe('docker');
  expect(docker.calls[0]?.args).toEqual(
    validateArguments({
      name: NAME,
      image: CADDY_IMAGE,
      caddyfile: CADDYFILE,
      user: '1001:121',
      origin: 'https://cla.example.com',
    }),
  );
});

test('the origins named on the command line replace the defaults', async () => {
  const { deps, docker } = fakes();
  const { io, out } = collectIo();
  expect(await runCaddyCli(['validate', 'https://one.example.org'], ACTIONS, io, deps)).toBe(0);
  expect(runsOf(docker).map((call) => originOf(call.args))).toEqual(['PUBLIC_BASE_URL=https://one.example.org']);
  expect(out).toEqual(['caddy validate https://one.example.org: valid']);
});

test('outside Actions the container name is printed instead of exported', async () => {
  const { deps } = fakes();
  const { io, out } = collectIo();
  expect(await runCaddyCli(['validate', 'https://localhost'], {}, io, deps)).toBe(0);
  expect(out).toEqual(['CLA_CADDY_CONTAINER=cla-caddy-local-beef0001', 'caddy validate https://localhost: valid']);
});

test('a configuration Caddy refuses fails the run with the end of its log, and the next origin is not tried', async () => {
  const noise = Array.from({ length: 30 }, (_, index) => `start-up line ${index}`).join('\n');
  const refusal = {
    code: 1,
    stdout: '',
    stderr: `${noise}\n{"level":"error","msg":"adapting config using caddyfile: unrecognized directive: bogus"}\n::error::forged\u001b[31m`,
  };
  const { deps, docker } = fakes(fakeDocker([['run', [refusal]]]));
  const { io, out, err } = collectIo();
  expect(await runCaddyCli(['validate'], ACTIONS, io, deps)).toBe(1);
  expect(runsOf(docker)).toHaveLength(1);
  expect(out).toEqual([]);
  expect(err[0]).toBe('ci-caddy validate: caddy validate failed for https://localhost (exit code 1):');
  expect(err).toHaveLength(21);
  expect(err.at(-2)).toBe('| {"level":"error","msg":"adapting config using caddyfile: unrecognized directive: bogus"}');
  expect(err.at(-1)).toBe('| ::error::forged\\x1b[31m');
  expect(err.join('\n')).not.toContain('start-up line 0');
});

test('the first origin passing and the second failing still fails the run', async () => {
  const { deps } = fakes(fakeDocker([['run', [ok(), fail('Error: invalid site address', 1)]]]));
  const { io, out, err } = collectIo();
  expect(await runCaddyCli(['validate'], ACTIONS, io, deps)).toBe(1);
  expect(out).toEqual(['caddy validate https://localhost: valid']);
  expect(err).toEqual([
    'ci-caddy validate: caddy validate failed for https://cla.example.com (exit code 1):',
    '| Error: invalid site address',
  ]);
});

test.each([
  ['an http origin', ['http://cla.example.com']],
  ['an origin with a port', ['https://cla.example.com:8443']],
  ['a bare scheme', ['https://']],
  ['an option smuggled in', ['https://cla.example.com --privileged']],
  ['one good and one bad', ['https://localhost', 'https://']],
])('%s is refused before docker runs', async (_what, origins) => {
  const { deps, docker, events } = fakes();
  const { io, err } = collectIo();
  expect(await runCaddyCli(['validate', ...origins], ACTIONS, io, deps)).toBe(1);
  expect(docker.calls).toEqual([]);
  expect(events).toEqual([]);
  expect(err).toHaveLength(1);
  expect(err[0]).toMatch(/^ci-caddy validate: ".*" is not an https origin: https:\/\/ and a lower-case host name/);
});

test('an origin with a control character is reported escaped, so it cannot forge a workflow command', async () => {
  const { deps } = fakes();
  const { io, err } = collectIo();
  expect(await runCaddyCli(['validate', 'https://x\u001b[31m'], ACTIONS, io, deps)).toBe(1);
  expect(err).toEqual([
    'ci-caddy validate: "https://x\\x1b[31m" is not an https origin: https:// and a lower-case host name, no port or path',
  ]);
});

test('a Caddyfile path that cannot be mounted is refused before docker runs', async () => {
  const { deps, docker } = fakes(fakeDocker(), { uid: 1001, gid: 121 }, '/work/a,b/Caddyfile');
  const { io, err } = collectIo();
  expect(await runCaddyCli(['validate'], ACTIONS, io, deps)).toBe(1);
  expect(docker.calls).toEqual([]);
  expect(err).toEqual([
    'ci-caddy validate: the Caddyfile path "/work/a,b/Caddyfile" cannot be mounted: absolute, no comma',
  ]);
});

test.each([[{ uid: -1, gid: 121 }], [{ uid: 1001, gid: -1 }]])(
  'a system without a numeric user id (%j) is refused, because the container must not run as root',
  async (user) => {
    const { deps, docker } = fakes(fakeDocker(), user);
    const { io, err } = collectIo();
    expect(await runCaddyCli(['validate'], ACTIONS, io, deps)).toBe(1);
    expect(docker.calls).toEqual([]);
    expect(err).toEqual([
      'ci-caddy validate: the Caddy container must run as the current user, and this system has no numeric user id',
    ]);
  },
);

test('user id 0 is a number like any other: it is passed on as given', async () => {
  const { deps, docker } = fakes(fakeDocker(), { uid: 0, gid: 0 });
  expect(await runCaddyCli(['validate', 'https://localhost'], ACTIONS, collectIo().io, deps)).toBe(0);
  expect(runsOf(docker)[0]?.args).toContain('0:0');
});

const RECORDED = { CLA_CADDY_CONTAINER: NAME };
const NOTHING = 'no container recorded in CLA_CADDY_CONTAINER: nothing to remove';

test.each([
  {
    what: 'removes the recorded container',
    env: RECORDED,
    reply: ok(`${NAME}\n`),
    line: `container ${NAME}: removed`,
    calls: 2,
  },
  { what: 'is idempotent when it is gone', env: RECORDED, reply: ok(''), line: `container ${NAME}: absent`, calls: 2 },
  { what: 'has nothing to do without a name', env: {}, reply: ok(''), line: NOTHING, calls: 0 },
  { what: 'treats an empty name as none', env: { CLA_CADDY_CONTAINER: '' }, reply: ok(''), line: NOTHING, calls: 0 },
])('stop $what', async ({ env, reply, line, calls }) => {
  const { deps, docker } = fakes(fakeDocker([OWNED, ['rm', [reply]]]));
  const { io, out } = collectIo();
  expect(await runCaddyCli(['stop'], env, io, deps)).toBe(0);
  expect(out).toEqual([line]);
  expect(docker.calls).toHaveLength(calls);
});

test('stop removes only a container of its own: a hostile name, a foreign label and a docker failure are refused', async () => {
  const hostile = collectIo();
  expect(await runCaddyCli(['stop'], { CLA_CADDY_CONTAINER: '-rf' }, hostile.io, fakes().deps)).toBe(1);
  expect(hostile.err).toEqual(['ci-caddy stop: refusing to remove a container with an unexpected name']);
  const foreignPrefix = collectIo();
  expect(await runCaddyCli(['stop'], { CLA_CADDY_CONTAINER: 'cla-pg-1-1-abcd' }, foreignPrefix.io, fakes().deps)).toBe(
    1,
  );
  expect(foreignPrefix.err).toEqual(['ci-caddy stop: refusing to remove a container with an unexpected name']);
  const foreignLabel = collectIo();
  const labelled = fakes(fakeDocker([['container', [ok('postgres\n')]]]));
  expect(await runCaddyCli(['stop'], RECORDED, foreignLabel.io, labelled.deps)).toBe(1);
  expect(foreignLabel.err).toEqual([
    `ci-caddy stop: refusing to remove container ${NAME}: it does not carry the label cla-gate.ci=caddy`,
  ]);
  expect(labelled.docker.calls.map((call) => call.args[0])).toEqual(['container']);
  const broken = collectIo();
  expect(
    await runCaddyCli(['stop'], RECORDED, broken.io, fakes(fakeDocker([OWNED, ['rm', [fail('daemon down')]]])).deps),
  ).toBe(1);
  expect(broken.err).toEqual(['ci-caddy stop: docker rm failed: daemon down']);
});

test.each([[[]], [['restart']], [['stop', '--force']], [['stop', 'https://localhost']]])(
  'usage error for %j',
  async (argv) => {
    const { deps, docker } = fakes();
    const { io, err } = collectIo();
    expect(await runCaddyCli(argv, {}, io, deps)).toBe(2);
    expect(err).toEqual(['usage: ci-caddy validate [origin...]', '       ci-caddy stop']);
    expect(docker.calls).toEqual([]);
  },
);
