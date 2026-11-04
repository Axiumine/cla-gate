// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { fail, ok, readText } from '../ci/lib/test-support.ts';
import { OVERRIDE_FILE } from './compose.ts';
import { connect, startStack } from './stack.ts';
import { callsOf, lifecycle, scripted, settingsOf, track } from './test-support.ts';

// E19-S12: what the scenarios that change the state of a stack need from the harness: ports of their own, a start of some
// services only, keys in the compose override, and a shell for the lines of the operator guides.

const TAKEN = 'Error response from daemon: driver failed programming external connectivity: port is already allocated';
const PORTS = ['CADDY_HTTP_PORT', 'CADDY_HTTPS_PORT'];

test('every name in ports gets a random free port of its own, apart from the application and from each other', async () => {
  const { deps, calls } = scripted({ ports: [40_001, 40_001, 40_002, 40_002, 40_002, 40_003] });
  const stack = track(await startStack(deps, { scenario: 'tls', profiles: ['tls'], ports: PORTS }));
  expect(stack.port).toBe(40_001);
  expect(stack.environment).toMatchObject({ PORT: '40001', CADDY_HTTP_PORT: '40002', CADDY_HTTPS_PORT: '40003' });
  const settings = settingsOf(stack.directory);
  expect([settings.get('PORT'), settings.get('CADDY_HTTP_PORT'), settings.get('CADDY_HTTPS_PORT')]).toEqual([
    '40001',
    '40002',
    '40003',
  ]);
  expect(callsOf(calls, 'up')[0]?.env).toMatchObject({ CADDY_HTTP_PORT: '40002', CADDY_HTTPS_PORT: '40003' });
});

test('a stack without ports draws one port, the application', async () => {
  const { deps } = scripted();
  const stack = track(await startStack(deps, { scenario: 'boot' }));
  expect(Object.keys(stack.environment).filter((name) => name.endsWith('_PORT'))).toEqual([]);
});

test('a setting of the caller wins over a port drawn for the same name', async () => {
  const { deps } = scripted();
  const settings = { CADDY_HTTPS_PORT: '44300' };
  const stack = track(await startStack(deps, { scenario: 'tls', ports: PORTS, settings }));
  expect(stack.environment['CADDY_HTTPS_PORT']).toBe('44300');
  expect(stack.environment['CADDY_HTTP_PORT']).toBe('40002');
});

test('when a port was taken in between, the application and the other ports are all drawn again', async () => {
  const { deps } = scripted({
    replies: { up: [fail(TAKEN), ok()] },
    ports: [40_001, 40_002, 40_003, 40_004, 40_005, 40_006],
  });
  const stack = track(await startStack(deps, { scenario: 'tls', ports: PORTS }));
  expect(stack.environment).toMatchObject({ PORT: '40004', CADDY_HTTP_PORT: '40005', CADDY_HTTPS_PORT: '40006' });
});

test('a random source that keeps returning the same port ends the attempt, and the stack is removed', async () => {
  const { deps, calls } = scripted({ ports: [40_001] });
  await expect(startStack(deps, { scenario: 'tls', ports: PORTS })).rejects.toThrow(
    'no free port that differs from the 2 already drawn after 20 draws',
  );
  expect(lifecycle(calls)).toEqual(['down']);
});

test('with services named, everything is created and built first, and then only those services are started and waited for', async () => {
  const { deps, calls } = scripted();
  const stack = track(await startStack(deps, { scenario: 'failure', services: ['postgres'] }));
  const [create, start] = callsOf(calls, 'up');
  expect(callsOf(calls, 'up')).toHaveLength(2);
  expect(create?.args.slice(-3)).toEqual(['up', '--build', '--no-start']);
  expect(start?.args.slice(-6)).toEqual(['up', '--detach', '--wait', '--wait-timeout', '300', 'postgres']);
  expect(stack.port).toBe(40_001);
});

test('without services named there is one up, which builds and waits for everything', async () => {
  const { deps, calls } = scripted();
  track(await startStack(deps, { scenario: 'boot' }));
  const [only] = callsOf(calls, 'up');
  expect(callsOf(calls, 'up')).toHaveLength(1);
  expect(only?.args.slice(-6)).toEqual(['up', '--build', '--detach', '--wait', '--wait-timeout', '300']);
});

test('a creation that fails is final unless it is a conflict: its output is in the error, the start is not tried, and the stack is removed', async () => {
  const { deps, calls } = scripted({ replies: { up: [fail('failed to solve: no space left on device')] } });
  await expect(startStack(deps, { scenario: 'failure', services: ['postgres'] })).rejects.toThrow(
    'docker compose up failed (exit 1):\nfailed to solve: no space left on device',
  );
  expect(lifecycle(calls)).toEqual(['up', 'down']);
});

test('a subnet that overlaps another network is found while everything is created, and drawn again before any service starts', async () => {
  const overlap = fail('failed to create network: Pool overlaps with other one on this address space');
  const { deps, calls } = scripted({ replies: { up: [overlap, ok(), ok()] }, ports: [40_001, 40_002] });
  const stack = track(await startStack(deps, { scenario: 'failure', services: ['postgres'] }));
  expect(stack.port).toBe(40_002);
  expect(lifecycle(calls)).toEqual(['up', 'down', 'up', 'up']);
});

const overrideShape = z.object({
  services: z.record(z.string(), z.object({ extra_hosts: z.array(z.string()).optional() })),
});

test('overrides add keys to a service of the compose override', async () => {
  const { deps } = scripted();
  const overrides = { app: { extra_hosts: ['api.github.com:127.0.0.1'] } };
  const stack = track(await startStack(deps, { scenario: 'configured', overrides }));
  const file = overrideShape.parse(parse(readText(path.join(stack.directory, OVERRIDE_FILE))));
  expect(file.services['app']?.extra_hosts).toEqual(['api.github.com:127.0.0.1']);
  expect(file.services['migrate']?.extra_hosts).toBeUndefined();
});

test('overrides for a service the compose file does not have are refused, and the stack is removed', async () => {
  const { deps, calls } = scripted();
  await expect(startStack(deps, { scenario: 'configured', overrides: { nope: { init: true } } })).rejects.toThrow(
    'the compose file has no service nope',
  );
  expect(lifecycle(calls)).toEqual(['down']);
});

test('the shell of a stack is a script for sh -c, with the project, the directory, the checkout, the profile and the settings', async () => {
  const { deps, calls } = scripted();
  const stack = track(await startStack(deps, { scenario: 'backup' }));
  await stack.shell('docker compose down -v');
  const [shell] = callsOf(calls, 'shell');
  expect(shell?.file).toBe('sh');
  expect(shell?.args.slice(0, 1)).toEqual(['-c']);
  expect(shell?.args[1]).toMatch(/\ndocker compose down -v$/);
  expect(shell?.env).toMatchObject({
    COMPOSE_PROFILES: '',
    PORT: '40001',
    CLA_SMOKE_PROJECT: stack.names.project,
    CLA_SMOKE_DIRECTORY: stack.directory,
    CLA_SMOKE_ROOT: deps.root,
  });
});

test('a stack that is connected to has the shell too', async () => {
  const { deps, calls } = scripted();
  const started = track(await startStack(deps, { scenario: 'backup' }));
  const { names, directory, port, profiles, environment } = started;
  await connect(deps, { names, directory, port, profiles, environment }).shell('true');
  expect(callsOf(calls, 'shell')).toHaveLength(1);
});
