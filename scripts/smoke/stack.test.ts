// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { exists, fail, ok, readText } from '../ci/lib/test-support.ts';
import { drawSubnets } from './bring-up.ts';
import { listNames } from './files.ts';
import { NETWORK_SUBNETS } from './override.ts';
import { COPIED } from './prepare.ts';
import { connect, startStack } from './stack.ts';
import type { StackDeps } from './stack-types.ts';
import {
  callsOf,
  DOTENV,
  FIRST_SUBNET,
  LAST_SUBNET,
  lifecycle,
  ROOT,
  SECOND_SUBNET,
  scripted,
  settingsOf,
  track,
  verbOf,
  WRAPPED_SUBNET,
} from './test-support.ts';

// E19-S08: the lifecycle of a smoke stack, with docker scripted and the real checkout, the real scripts/init-secrets.sh and
// real temporary directories.

const COMPOSE = readText(path.join(ROOT, 'docker-compose.yml'));
const PROJECT = 'cla-smoke-local-abcd1234-boot';
const TAKEN = 'Error response from daemon: driver failed programming external connectivity: port is already allocated';

test('the files a stack copies cover every bind mount of the compose file, the dotenv template and the secrets script', () => {
  const shape = z.object({ services: z.record(z.string(), z.object({ volumes: z.array(z.string()).optional() })) });
  const mounts = Object.values(shape.parse(parse(COMPOSE, { merge: true })).services)
    .flatMap((service) => service.volumes ?? [])
    .filter((volume) => volume.startsWith('./'))
    .map((volume) => volume.slice(2, volume.indexOf(':')));
  expect(mounts.length).toBeGreaterThanOrEqual(3);
  expect(COPIED).toEqual(
    expect.arrayContaining([...mounts, '.env.example', 'scripts/init-secrets.sh', 'docker-compose.yml']),
  );
  for (const file of COPIED) {
    expect(exists(path.join(ROOT, file)), file).toBe(true);
  }
});

test('the subnets are /24s of 172.16.0.0/12 drawn from the random source: the default network first, then one for each network of its own', () => {
  expect(drawSubnets((min) => min)).toEqual({ edge: FIRST_SUBNET, named: [['SMOKE_BACKEND_SUBNET', SECOND_SUBNET]] });
});

test('the /24 after the last one of a /16 is the first one of it', () => {
  expect(drawSubnets((_min, max) => max)).toEqual({
    edge: LAST_SUBNET,
    named: [['SMOKE_BACKEND_SUBNET', WRAPPED_SUBNET]],
  });
});

test('every network of the stack gets a subnet of its own, none of them the same, in the dotenv file and in the settings compose is run with', async () => {
  const { deps, calls } = scripted();
  const stack = track(await startStack(deps, { scenario: 'backup' }));
  const settings = settingsOf(stack.directory);
  const subnets = [settings.get('EDGE_SUBNET'), ...Object.values(NETWORK_SUBNETS).map((name) => settings.get(name))];
  expect(subnets).toEqual([FIRST_SUBNET, SECOND_SUBNET]);
  expect(new Set(subnets).size).toBe(subnets.length);
  expect(stack.environment['SMOKE_BACKEND_SUBNET']).toBe(SECOND_SUBNET);
  expect(callsOf(calls, 'up')[0]?.env?.['SMOKE_BACKEND_SUBNET']).toBe(SECOND_SUBNET);
  const later = await stack.compose(['up', '--detach']);
  expect(later.code).toBe(0);
  expect(callsOf(calls, 'up').at(-1)?.env).toMatchObject({
    EDGE_SUBNET: FIRST_SUBNET,
    SMOKE_BACKEND_SUBNET: SECOND_SUBNET,
  });
});

test('a stack is made in a temporary directory: the copied files, the override, the secrets and the random port', async () => {
  const { deps, calls } = scripted();
  const stack = track(await startStack(deps, { scenario: 'boot' }));
  expect(stack.names).toEqual({
    run: 'cla-smoke-local-abcd1234',
    project: PROJECT,
    image: `cla-gate-smoke:${PROJECT}`,
  });
  expect(stack.url).toBe('http://127.0.0.1:40001');
  for (const file of [...COPIED, 'docker-compose.smoke.yml', DOTENV]) {
    expect(exists(path.join(stack.directory, file)), file).toBe(true);
  }
  expect(listNames(path.join(stack.directory, 'secrets'))).toContain('setup_token');
  const settings = settingsOf(stack.directory);
  expect(settings.get('PORT')).toBe('40001');
  expect(settings.get('PUBLIC_BASE_URL')).toBe('https://localhost');
  expect(settings.get('BIND_ADDRESS')).toBe('127.0.0.1');
  expect(settings.get('EDGE_SUBNET')).toBe(FIRST_SUBNET);
  expect(settings.get('TRUST_PROXY')).toBe(settings.get('EDGE_SUBNET'));
  expect(lifecycle(calls)).toEqual(['up']);
});

test('compose is told the project, the directory, both files, the profile and the settings, and builds before it waits', async () => {
  const { deps, calls } = scripted();
  const settings = { CADDY_HTTPS_PORT: '41443' };
  const stack = track(await startStack(deps, { scenario: 'tls', profiles: ['tls'], settings }));
  const [up] = callsOf(calls, 'up');
  expect(up?.file).toBe('docker');
  expect(up?.args).toEqual([
    'compose',
    '--project-name',
    stack.names.project,
    '--project-directory',
    stack.directory,
    '--file',
    path.join(stack.directory, 'docker-compose.yml'),
    '--file',
    path.join(stack.directory, 'docker-compose.smoke.yml'),
    'up',
    '--build',
    '--detach',
    '--wait',
    '--wait-timeout',
    '300',
  ]);
  expect(up?.env).toMatchObject({
    COMPOSE_PROFILES: 'tls',
    PORT: '40001',
    CADDY_HTTPS_PORT: '41443',
    PUBLIC_BASE_URL: 'https://localhost',
  });
  expect(settingsOf(stack.directory).get('CADDY_HTTPS_PORT')).toBe('41443');
  expect(stack.profiles).toBe('tls');
});

test('settings of the caller win over the ones the smoke test sets', async () => {
  const { deps } = scripted();
  const settings = { PUBLIC_BASE_URL: 'https://cla.example.com' };
  const stack = track(await startStack(deps, { scenario: 'boot', settings }));
  expect(settingsOf(stack.directory).get('PUBLIC_BASE_URL')).toBe('https://cla.example.com');
  expect(stack.environment['PUBLIC_BASE_URL']).toBe('https://cla.example.com');
});

test('the name of the run comes from CLA_SMOKE_RUN when the workflow set it', async () => {
  const { deps } = scripted({ env: { CLA_SMOKE_RUN: 'cla-smoke-55-2' } });
  const stack = track(await startStack(deps, { scenario: 'boot' }));
  expect(stack.names.project).toBe('cla-smoke-55-2-boot');
});

test('a port that was taken in between is drawn again, after the half-made stack was taken down', async () => {
  const { deps, calls } = scripted({ replies: { up: [fail(TAKEN), ok()] }, ports: [40_001, 40_002] });
  const stack = track(await startStack(deps, { scenario: 'boot' }));
  expect(stack.port).toBe(40_002);
  expect(settingsOf(stack.directory).get('PORT')).toBe('40002');
  expect(lifecycle(calls)).toEqual(['up', 'down', 'up']);
});

test('a subnet that overlaps another network counts as a conflict too', async () => {
  const { deps, calls } = scripted({
    replies: { up: [fail('Error: Pool overlaps with other one on this address space'), ok()] },
  });
  track(await startStack(deps, { scenario: 'boot' }));
  expect(lifecycle(calls)).toEqual(['up', 'down', 'up']);
});

test('five conflicts in a row end the attempts, and the stack is removed', async () => {
  const { deps, calls } = scripted({ replies: { up: [fail(TAKEN)] } });
  await expect(startStack(deps, { scenario: 'boot' })).rejects.toThrow('docker compose up failed (exit 1)');
  expect(callsOf(calls, 'up')).toHaveLength(5);
  expect(callsOf(calls, 'image')).toHaveLength(1);
});

test('any other failure of up is final at once: its output is in the error, the logs are kept and the stack is removed', async () => {
  const failure = fail('line 1\nservice "migrate" did not complete successfully: exit 1');
  const { deps, calls, logs } = scripted({ replies: { up: [failure] } });
  await expect(startStack(deps, { scenario: 'boot' })).rejects.toThrow(
    'service "migrate" did not complete successfully: exit 1',
  );
  expect(lifecycle(calls)).toEqual(['up', 'down']);
  expect(callsOf(calls, 'down')[0]?.env).toMatchObject({ COMPOSE_PROFILES: '*' });
  expect(callsOf(calls, 'image')[0]?.args).toEqual(['image', 'rm', '--force', `cla-gate-smoke:${PROJECT}`]);
  expect(listNames(logs)).toEqual([`${PROJECT}.log`]);
});

test('only the last 40 lines of a failed up are reported', async () => {
  const lines = Array.from({ length: 60 }, (_, index) => `output line ${index + 1}`);
  const { deps } = scripted({ replies: { up: [fail(lines.join('\n'))] } });
  const message = await startStack(deps, { scenario: 'boot' }).then(
    () => '',
    (error: unknown) => (error instanceof Error ? error.message : ''),
  );
  expect(message).toContain('output line 60');
  expect(message).toContain('output line 21');
  expect(message).not.toContain('output line 20');
});

test('a secrets script that fails stops the start before compose is called, and the removal still runs', async () => {
  const { deps, calls } = scripted();
  const broken: StackDeps = {
    ...deps,
    exec: (file, args, env) =>
      file === 'sh' ? Promise.resolve(fail('init-secrets: no source of randomness')) : deps.exec(file, args, env),
  };
  await expect(startStack(broken, { scenario: 'boot' })).rejects.toThrow(
    'scripts/init-secrets.sh failed (exit 1): init-secrets: no source of randomness',
  );
  expect(lifecycle(calls)).toEqual(['down']);
});

test('a failed start whose removal also fails reports both', async () => {
  const { deps } = scripted({ replies: { up: [fail('build failed')], down: [fail('cannot remove network')] } });
  await expect(startStack(deps, { scenario: 'boot' })).rejects.toThrow(
    /build failed\nthe smoke stack was not removed cleanly:\ndocker compose down: cannot remove network/,
  );
});

test('down saves the redacted logs first, then removes the stack, its image and its directory', async () => {
  let leak = '';
  const { deps, calls, logs } = scripted();
  const leaking: StackDeps = {
    ...deps,
    exec: async (file, args, env) => {
      const result = await deps.exec(file, args, env);
      return args.includes('logs') ? ok(`app | connected with ${leak}\n`) : result;
    },
  };
  const stack = await startStack(leaking, { scenario: 'boot' });
  leak = stack.secret('db_app_password');
  expect(leak).toMatch(/^[0-9a-f]{64}$/);
  await stack.down();
  const written = readText(path.join(logs, `${PROJECT}.log`));
  expect(written).toContain('app | connected with [redacted]');
  expect(written).not.toContain(leak);
  const verbs = calls.map((call) => verbOf(call));
  expect(verbs.indexOf('logs')).toBeLessThan(verbs.indexOf('down'));
  expect(verbs.indexOf('down')).toBeLessThan(verbs.indexOf('image'));
  expect(callsOf(calls, 'down')[0]?.args.slice(-3)).toEqual(['down', '--volumes', '--remove-orphans']);
  expect(callsOf(calls, 'image')[0]?.args).toEqual(['image', 'rm', '--force', stack.names.image]);
  expect(exists(stack.directory)).toBe(false);
});

test('down runs every step even when one fails, and reports what failed', async () => {
  const { deps, calls } = scripted({ replies: { down: [fail('network has active endpoints')] } });
  const stack = await startStack(deps, { scenario: 'boot' });
  await expect(stack.down()).rejects.toThrow('docker compose down: network has active endpoints');
  expect(callsOf(calls, 'image')).toHaveLength(1);
  expect(exists(stack.directory)).toBe(false);
});

test('connect makes the handle of a stack that is already up: the same files, profile, settings and secrets', async () => {
  const { deps, calls } = scripted();
  const started = track(await startStack(deps, { scenario: 'boot' }));
  const { names, directory, port, profiles, environment } = started;
  const attached = connect(deps, { names, directory, port, profiles, environment });
  await attached.compose(['ps']);
  const [ps] = callsOf(calls, 'ps');
  expect(ps?.args).toContain(path.join(directory, 'docker-compose.smoke.yml'));
  expect(ps?.env).toMatchObject({ COMPOSE_PROFILES: '', PORT: String(port) });
  expect(attached.url).toBe(started.url);
  expect(attached.secret('session_secret')).toBe(started.secret('session_secret'));
  await attached.docker(['inspect', 'x']);
  expect(calls.at(-1)?.args).toEqual(['inspect', 'x']);
});
