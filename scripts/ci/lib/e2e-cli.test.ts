// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { runE2eCli } from './e2e-cli.ts';
import type { E2eDeps } from './e2e-deps.ts';
import { runArguments } from './e2e-run.ts';
import { collectIo, fail, fakeDocker, ok } from './test-support.ts';

const IMAGE = `mcr.microsoft.com/playwright:v1.64.1-noble@sha256:${'b'.repeat(64)}`;
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password -- made-up value for a fake database, not a credential
const DATABASE = 'postgres://postgres:s3cr3tvalue@127.0.0.1:41000/postgres';
const ACTIONS = {
  GITHUB_ENV: '/runner/env-file',
  GITHUB_RUN_ID: '77',
  GITHUB_RUN_ATTEMPT: '3',
  E2E_IMAGE: IMAGE,
  DATABASE_URL: DATABASE,
  CI: 'true',
};
const NAME = 'cla-e2e-77-3-beef0001';
const OWNED = ['container', [ok('e2e\n')]] as const;

interface Fakes {
  readonly deps: E2eDeps;
  readonly events: string[];
  readonly runs: { file: string; args: readonly string[]; env: Readonly<Record<string, string>> }[];
  readonly docker: ReturnType<typeof fakeDocker>;
}

/** Fake dependencies: a scripted docker, a recorded `run`, fixed randomness, a fixed workspace and user. */
function fakes(
  code = 0,
  user = { uid: 1001, gid: 121 },
  workspace = '/home/runner/work/r',
  docker = fakeDocker(),
): Fakes {
  const events: string[] = [];
  const runs: Fakes['runs'] = [];
  const deps: E2eDeps = {
    exec: docker.exec,
    randomHex: () => 'beef0001',
    appendFile: (file, text) => {
      events.push(`env ${file} ${text.trim()}`);
    },
    run: (file, args, env) => {
      events.push('docker');
      runs.push({ file, args, env });
      return Promise.resolve(code);
    },
    cwd: () => workspace,
    user: () => user,
  };
  return { deps, events, runs, docker };
}

test('run exports the container name before docker starts, runs the command in the pinned image and returns its exit code', async () => {
  const { deps, events, runs } = fakes(0);
  const { io, out, err } = collectIo();
  expect(await runE2eCli(['run', 'yarn', 'e2e'], ACTIONS, io, deps)).toBe(0);
  expect(events).toEqual([`env /runner/env-file CLA_E2E_CONTAINER=${NAME}`, 'docker']);
  expect(runs).toEqual([
    {
      file: 'docker',
      args: runArguments({ name: NAME, image: IMAGE, workspace: '/home/runner/work/r', user: '1001:121', ci: 'true' }, [
        'yarn',
        'e2e',
      ]),
      env: { DATABASE_URL: DATABASE },
    },
  ]);
  expect(out).toEqual([`container ${NAME}: yarn e2e`, `container ${NAME}: exit code 0`]);
  expect(err).toEqual([]);
});

test.each([[0], [1], [125], [137]])(
  'the exit code of the command in the container (%i) is the exit code of run',
  async (code) => {
    const { io } = collectIo();
    expect(await runE2eCli(['run', 'yarn', 'e2e'], ACTIONS, io, fakes(code).deps)).toBe(code);
  },
);

test('the database URL reaches docker through its environment and never through the arguments or the log', async () => {
  const { deps, runs } = fakes();
  const { io, out, err } = collectIo();
  await runE2eCli(['run', 'yarn', 'e2e'], ACTIONS, io, deps);
  expect(JSON.stringify(runs[0]?.args)).not.toContain('s3cr3tvalue');
  expect([...out, ...err].join('\n')).not.toContain('s3cr3tvalue');
});

test('a leading -- only separates the command and a command with its own options passes them on', async () => {
  const { deps, runs } = fakes();
  const { io } = collectIo();
  await runE2eCli(['run', '--', 'yarn', 'e2e', '--update-snapshots=all'], ACTIONS, io, deps);
  expect(runs[0]?.args.slice(-3)).toEqual(['yarn', 'e2e', '--update-snapshots=all']);
});

test('a second -- belongs to the command', async () => {
  const { deps, runs } = fakes();
  await runE2eCli(['run', '--', 'yarn', 'e2e', '--', 'x'], ACTIONS, collectIo().io, deps);
  expect(runs[0]?.args.slice(-4)).toEqual(['yarn', 'e2e', '--', 'x']);
});

test('outside Actions the assignment is printed and CI is not passed on when it is not set', async () => {
  const { deps, events, runs } = fakes();
  const { io, out } = collectIo();
  const env = { E2E_IMAGE: IMAGE, DATABASE_URL: DATABASE };
  expect(await runE2eCli(['run', 'yarn', 'e2e'], env, io, deps)).toBe(0);
  expect(events).toEqual(['docker']);
  expect(out[0]).toBe('CLA_E2E_CONTAINER=cla-e2e-local-beef0001');
  expect(runs[0]?.args.filter((arg) => arg.startsWith('CI'))).toEqual([]);
});

test.each([
  ['no image', { ...ACTIONS, E2E_IMAGE: undefined }],
  ['an empty image', { ...ACTIONS, E2E_IMAGE: '' }],
  ['an image without a digest', { ...ACTIONS, E2E_IMAGE: 'mcr.microsoft.com/playwright:v1.64.1-noble' }],
  ['another image', { ...ACTIONS, E2E_IMAGE: `ubuntu:24.04@sha256:${'b'.repeat(64)}` }],
  ['an image followed by an option', { ...ACTIONS, E2E_IMAGE: `${IMAGE} --privileged` }],
])('run refuses %s and starts nothing', async (_what, env) => {
  const { deps, events } = fakes();
  const { io, err } = collectIo();
  expect(await runE2eCli(['run', 'yarn', 'e2e'], env, io, deps)).toBe(1);
  expect(events).toEqual([]);
  expect(err[0]).toMatch(/^ci-e2e run: E2E_IMAGE must be mcr\.microsoft\.com\/playwright:v<version>-noble@sha256:/);
});

test('a refused image is shown with its control characters escaped', async () => {
  const { io, err } = collectIo();
  await runE2eCli(['run', 'yarn'], { ...ACTIONS, E2E_IMAGE: 'x\u001b[31m' }, io, fakes().deps);
  expect(err.join('\n')).toContain('got "x\\x1b[31m"');
});

test.each([[undefined], ['']])('run refuses a database URL that is %j and says what to do', async (value) => {
  const { deps, events } = fakes();
  const { io, err } = collectIo();
  expect(await runE2eCli(['run', 'yarn', 'e2e'], { ...ACTIONS, DATABASE_URL: value }, io, deps)).toBe(1);
  expect(events).toEqual([]);
  expect(err).toEqual([
    'ci-e2e run: DATABASE_URL is not set: start and migrate the database first (yarn ci:postgres start)',
  ]);
});

test.each([['work/repo'], ['/home/x:/etc'], ['/home/x\ny']])(
  'run refuses the working directory %j',
  async (workspace) => {
    const { deps, events } = fakes(0, { uid: 1, gid: 1 }, workspace);
    const { io, err } = collectIo();
    expect(await runE2eCli(['run', 'yarn', 'e2e'], ACTIONS, io, deps)).toBe(1);
    expect(events).toEqual([]);
    expect(err[0]).toContain('cannot be mounted: it must be absolute and have no ":"');
  },
);

test.each([[{ uid: -1, gid: 5 }], [{ uid: 5, gid: -1 }]])(
  'run refuses a system without numeric ids (%j)',
  async (user) => {
    const { deps, events } = fakes(0, user);
    const { io, err } = collectIo();
    expect(await runE2eCli(['run', 'yarn', 'e2e'], ACTIONS, io, deps)).toBe(1);
    expect(events).toEqual([]);
    expect(err[0]).toContain('must run as the current user');
  },
);

test.each([[[]], [['bogus']], [['run']], [['run', '--']], [['stop', 'x']], [['STOP']]])(
  'the arguments %j print the usage and exit 2 without touching docker',
  async (argv) => {
    const { deps, events } = fakes();
    const { io, err, out } = collectIo();
    expect(await runE2eCli(argv, ACTIONS, io, deps)).toBe(2);
    expect(err).toEqual(['usage: ci-e2e run [--] <command...>', '       ci-e2e stop']);
    expect(out).toEqual([]);
    expect(events).toEqual([]);
  },
);

test('stop with no recorded container removes nothing and succeeds', async () => {
  const { deps, docker } = fakes();
  const { io, out } = collectIo();
  expect(await runE2eCli(['stop'], { ...ACTIONS, CLA_E2E_CONTAINER: '' }, io, deps)).toBe(0);
  expect(out).toEqual(['no container recorded in CLA_E2E_CONTAINER: nothing to remove']);
  expect(docker.calls).toEqual([]);
});

test('stop removes the labelled container by name', async () => {
  const docker = fakeDocker([OWNED, ['rm', [ok(`${NAME}\n`)]]]);
  const { deps } = fakes(0, undefined, undefined, docker);
  const { io, out } = collectIo();
  expect(await runE2eCli(['stop'], { CLA_E2E_CONTAINER: NAME }, io, deps)).toBe(0);
  expect(out).toEqual([`container ${NAME}: removed`]);
  expect(docker.calls.map((call) => call.args)).toEqual([
    ['container', 'inspect', '--format', '{{index .Config.Labels "cla-gate.ci"}}', NAME],
    ['rm', '--force', '--volumes', NAME],
  ]);
});

test('stop says absent for a container that --rm already removed', async () => {
  const docker = fakeDocker([['container', [fail('Error: No such container: x')]]]);
  const { io, out } = collectIo();
  expect(await runE2eCli(['stop'], { CLA_E2E_CONTAINER: NAME }, io, fakes(0, undefined, undefined, docker).deps)).toBe(
    0,
  );
  expect(out).toEqual([`container ${NAME}: absent`]);
});

test.each([
  ['a name that is not ours', 'cla-pg-1-1-beef0001', [OWNED], 'refusing to remove a container with an unexpected name'],
  ['an option instead of a name', '--force', [OWNED], 'refusing to remove a container with an unexpected name'],
  [
    'a container with a foreign label',
    NAME,
    [['container', [ok('postgres\n')]] as const],
    'it does not carry the label cla-gate.ci=e2e',
  ],
  [
    'a daemon that fails',
    NAME,
    [['container', [fail('permission denied')]] as const],
    'docker inspect failed: permission denied',
  ],
])('stop refuses %s and exits 1 with a report line', async (_what, name, script, message) => {
  const docker = fakeDocker(script);
  const { io, err } = collectIo();
  expect(await runE2eCli(['stop'], { CLA_E2E_CONTAINER: name }, io, fakes(0, undefined, undefined, docker).deps)).toBe(
    1,
  );
  expect(err[0]).toMatch(/^ci-e2e stop: /);
  expect(err[0]).toContain(message);
  expect(docker.calls.filter((call) => call.args[0] === 'rm')).toEqual([]);
});
