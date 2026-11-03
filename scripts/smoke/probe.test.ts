// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { ExecResult } from '../ci/lib/exec.ts';
import { fail, ok } from '../ci/lib/test-support.ts';
import { execIn, inspectService, output, sqlAs } from './probe.ts';

// E19-S08: how the scenarios look into a running stack. docker is a stub that records its arguments.

const CONTAINER = {
  Id: 'abc123',
  Config: { User: '10001:10001', Env: ['NODE_ENV=production'], Labels: { 'cla-gate.ci': 'container' } },
  State: { Status: 'running', ExitCode: 0, Health: { Status: 'healthy' } },
  HostConfig: { ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], PortBindings: null },
  NetworkSettings: { Ports: { '5432/tcp': null, '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '41000' }] } },
};

/** A stack whose compose and docker answer from queues and whose calls are recorded. */
function stub(compose: ExecResult, docker: ExecResult = ok()) {
  const calls: string[][] = [];
  return {
    calls,
    compose: (args: readonly string[]) => {
      calls.push(['compose', ...args]);
      return Promise.resolve(compose);
    },
    docker: (args: readonly string[]) => {
      calls.push(['docker', ...args]);
      return Promise.resolve(docker);
    },
  };
}

test('inspectService asks compose for the id of the service and docker for what it reports', async () => {
  const probe = stub(ok('abc123\n'), ok(JSON.stringify(CONTAINER)));
  const container = await inspectService(probe, 'app');
  expect(probe.calls).toEqual([
    ['compose', 'ps', '--all', '--quiet', 'app'],
    ['docker', 'inspect', '--format', '{{json .}}', 'abc123'],
  ]);
  expect(container.Config.User).toBe('10001:10001');
  expect(container.State.Health?.Status).toBe('healthy');
  expect(container.NetworkSettings.Ports['3000/tcp']).toEqual([{ HostIp: '127.0.0.1', HostPort: '41000' }]);
});

test('a container without a health check has no Health in the state', async () => {
  const state = { Status: 'exited', ExitCode: 0 };
  const probe = stub(ok('abc123\n'), ok(JSON.stringify({ ...CONTAINER, State: state })));
  expect((await inspectService(probe, 'migrate')).State.Health).toBeUndefined();
});

test('the first container is used when compose lists several', async () => {
  const probe = stub(ok('first\nsecond\n'), ok(JSON.stringify(CONTAINER)));
  await inspectService(probe, 'app');
  expect(probe.calls[1]?.at(-1)).toBe('first');
});

test.each([
  [
    'compose fails',
    fail('no configuration file provided'),
    'service app has no container: no configuration file provided',
  ],
  ['compose lists nothing', ok(''), 'service app has no container: '],
])('a service with no container is an error naming it when %s', async (_label, listed, message) => {
  await expect(inspectService(stub(listed), 'app')).rejects.toThrow(message);
});

test('a failing docker inspect is an error with its output', async () => {
  await expect(inspectService(stub(ok('abc\n'), fail('Error: No such object: abc')), 'app')).rejects.toThrow(
    'docker inspect app failed: Error: No such object: abc',
  );
});

test('an answer that is not what docker inspect prints is refused', async () => {
  await expect(inspectService(stub(ok('abc\n'), ok(JSON.stringify({ Id: 'abc' }))), 'app')).rejects.toThrow();
});

test('execIn runs the command in the service without a terminal', async () => {
  const probe = stub(ok('hello\n'));
  expect(await execIn(probe, 'app', ['id', '-u'])).toEqual(ok('hello\n'));
  expect(probe.calls).toEqual([['compose', 'exec', '-T', 'app', 'id', '-u']]);
});

test('sqlAs reads the password of the role inside the container and passes the statement as an argument, never in the shell text', async () => {
  const probe = stub(ok('1\n'));
  const statement = 'select 1; -- "quoted" $(x)';
  await sqlAs(probe, 'cla_app', statement);
  expect(probe.calls).toEqual([
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'sh',
      '-c',
      expect.any(String),
      'sh',
      '/run/secrets/db_app_password',
      'cla_app',
      statement,
    ],
  ]);
  const script = String(probe.calls[0]?.[6]);
  expect(script).toContain('PGPASSWORD=$(cat "$1")');
  expect(script).toContain('--host 127.0.0.1 --username "$2" --dbname cla');
  expect(script).toContain('--command "$3"');
  expect(script).not.toContain('select 1');
});

test.each([
  ['cla_app', '/run/secrets/db_app_password'],
  ['cla_owner', '/run/secrets/db_owner_password'],
] as const)('%s reads its own password file', async (role, file) => {
  const probe = stub(ok('1\n'));
  await sqlAs(probe, role, 'select 1');
  expect(probe.calls[0]?.slice(-3)).toEqual([file, role, 'select 1']);
});

test('output joins what a command printed on both streams', () => {
  expect(output({ code: 1, stdout: 'a\n', stderr: 'b\n' })).toBe('a\nb');
});
