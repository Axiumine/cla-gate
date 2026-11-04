// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { PortError } from '../../ci/lib/ports.ts';
import { exists, fail, fakeDocker, ok, readText } from '../../ci/lib/test-support.ts';
import { makeRepo, tempDir } from '../../code-caps/test-support.ts';
import { connectionUrl, DevDbError, databaseDown, databaseUp, requireUrl, roleVariable } from './dev-db.ts';
import { readPort } from './dev-db-state.ts';

const STATE = '.local/db.json';

/** A repository root, optionally with a remembered port. */
function repository(port?: number): string {
  const root = tempDir();
  makeRepo(root, port === undefined ? {} : { [STATE]: `{"port":${port}}\n` });
  return root;
}

function compose(root: string, ...tail: string[]): string[] {
  return ['compose', '--file', path.join(root, 'docker-compose.dev.yml'), '--project-directory', root, ...tail];
}

function stateOf(root: string): string | undefined {
  const file = path.join(root, STATE);
  return exists(file) ? readText(file) : undefined;
}

function ports(...list: number[]): () => Promise<number> {
  return () => Promise.resolve(list.shift() ?? 0);
}

test('the URLs name the loopback address, the remembered port, the database and the role', () => {
  expect(connectionUrl('app', 41_000)).toBe('postgres://cla_app:cla_app_dev_only@127.0.0.1:41000/cla');
  expect(connectionUrl('owner', 41_000)).toBe('postgres://cla_owner:cla_owner_dev_only@127.0.0.1:41000/cla');
});

test('the runtime role is DATABASE_URL and the owner is MIGRATION_DATABASE_URL', () => {
  expect([roleVariable('app'), roleVariable('owner')]).toEqual(['DATABASE_URL', 'MIGRATION_DATABASE_URL']);
});

test.each([
  ['nothing remembered', undefined, undefined],
  ['a valid port', '{"port":41000}', 41_000],
  ['a port below the range', '{"port":5432}', undefined],
  ['a port above the range', '{"port":61000}', undefined],
  ['a fractional port', '{"port":41000.5}', undefined],
  ['a port that is a string', '{"port":"41000"}', undefined],
  ['no port', '{}', undefined],
  ['a list', '[41000]', undefined],
  ['text that is not JSON', 'port=41000', undefined],
  ['an empty file', '', undefined],
])('the remembered port with %s', (_what, text, expected) => {
  const root = tempDir();
  makeRepo(root, text === undefined ? {} : { [STATE]: text });
  expect(readPort(root)).toBe(expected);
});

test('requireUrl without a remembered database says what to run', () => {
  expect(() => requireUrl(repository(), 'app')).toThrow(
    new DevDbError('no development database is recorded: run "yarn db:up" first, or set the URL variable yourself'),
  );
});

test('requireUrl builds the URL from the remembered port', () => {
  expect(requireUrl(repository(41_234), 'owner')).toBe(connectionUrl('owner', 41_234));
});

test('up on a fresh checkout picks a port, remembers it and starts compose with it', async () => {
  const root = repository();
  const docker = fakeDocker();
  expect(await databaseUp({ exec: docker.exec, pickPort: ports(41_000) }, root)).toBe(41_000);
  expect(stateOf(root)).toBe('{"port":41000}\n');
  expect(docker.calls).toEqual([
    { file: 'docker', args: compose(root, 'up', '--detach', '--wait', 'postgres'), env: { POSTGRES_PORT: '41000' } },
  ]);
});

test('up keeps the port of a database that is already running and starts nothing', async () => {
  const root = repository(41_111);
  const docker = fakeDocker([['compose', [ok('abc123\n')]]]);
  expect(await databaseUp({ exec: docker.exec, pickPort: ports(41_000) }, root)).toBe(41_111);
  expect(docker.calls).toEqual([
    {
      file: 'docker',
      args: compose(root, 'ps', '--status', 'running', '--quiet', 'postgres'),
      env: { POSTGRES_PORT: '41111' },
    },
  ]);
  expect(stateOf(root)).toBe('{"port":41111}\n');
});

test.each([
  ['nothing is running', ok('')],
  ['compose cannot tell', fail('no configuration file provided')],
])('up chooses a new port when the remembered one is stale (%s)', async (_what, ps) => {
  const root = repository(41_111);
  const docker = fakeDocker([['compose', [ps, ok()]]]);
  expect(await databaseUp({ exec: docker.exec, pickPort: ports(42_000) }, root)).toBe(42_000);
  expect(stateOf(root)).toBe('{"port":42000}\n');
  expect(docker.calls.at(-1)?.env).toEqual({ POSTGRES_PORT: '42000' });
});

test('up retries with another port when the first one is taken in the meantime', async () => {
  const root = repository();
  const taken = fail(
    'Error response from daemon: Ports are not available: listen tcp 127.0.0.1:41000: bind: address already in use',
    1,
  );
  const docker = fakeDocker([['compose', [taken, ok()]]]);
  expect(await databaseUp({ exec: docker.exec, pickPort: ports(41_000, 41_001) }, root)).toBe(41_001);
  expect(stateOf(root)).toBe('{"port":41001}\n');
});

test('up that keeps losing the port gives up with a PortError and forgets the port', async () => {
  const root = repository();
  const docker = fakeDocker([['compose', [fail('port is already allocated')]]]);
  await expect(
    databaseUp({ exec: docker.exec, pickPort: ports(41_000, 41_001, 41_002, 41_003, 41_004) }, root),
  ).rejects.toThrow(PortError);
  expect(stateOf(root)).toBeUndefined();
});

test('another compose failure is reported by its last line and the remembered port is dropped', async () => {
  const root = repository();
  const docker = fakeDocker([['compose', [fail('pulling postgres\nError response from daemon: manifest unknown\n')]]]);
  await expect(databaseUp({ exec: docker.exec, pickPort: ports(41_000) }, root)).rejects.toThrow(
    new DevDbError('docker compose up failed: Error response from daemon: manifest unknown'),
  );
  expect(stateOf(root)).toBeUndefined();
});

test.each([
  ['keeps the data volume', false, ['down']],
  ['removes the data volume too', true, ['down', '--volumes']],
])('down %s and forgets the port', async (_what, volumes, tail) => {
  const root = repository(41_000);
  const docker = fakeDocker();
  await databaseDown({ exec: docker.exec, pickPort: ports() }, root, volumes);
  expect(docker.calls).toEqual([{ file: 'docker', args: compose(root, ...tail), env: { POSTGRES_PORT: '41000' } }]);
  expect(stateOf(root)).toBeUndefined();
});

test('down without a remembered port still works: compose only needs some valid value', async () => {
  const docker = fakeDocker();
  await databaseDown({ exec: docker.exec, pickPort: ports() }, repository(), false);
  expect(docker.calls[0]?.env).toEqual({ POSTGRES_PORT: '1' });
});

test('a failing down is reported and keeps the remembered port', async () => {
  const root = repository(41_000);
  const docker = fakeDocker([['compose', [fail('Cannot connect to the Docker daemon\nis it running?')]]]);
  await expect(databaseDown({ exec: docker.exec, pickPort: ports() }, root, false)).rejects.toThrow(
    new DevDbError('docker compose down failed: is it running?'),
  );
  expect(stateOf(root)).toBe('{"port":41000}\n');
});
