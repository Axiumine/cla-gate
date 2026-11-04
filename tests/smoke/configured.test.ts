// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { dummyApp } from '../../scripts/smoke/dummy-app.ts';
import { inspectService, output } from '../../scripts/smoke/probe.ts';
import { reconfigure } from '../../scripts/smoke/reconfigure.ts';
import { stackDeps } from '../../scripts/smoke/system.ts';
import { ownStack } from './scenario.ts';
import { getFrom } from './support.ts';

// E19-S12, configured mode: the stack of E19-S08 after the operator has saved the credentials of the App (E19-S09, install.md):
// the GitHub values go into the secret files and the dotenv file, `docker compose up -d` starts the application again, and it
// serves as an instance with an App: the first-run setup is gone. The App is made up. Its start-up self-check would send a
// request signed with a made-up key to GitHub, so inside the application's container api.github.com is the loopback address
// (`extra_hosts`): the check meets an outage, defers itself (`github.app_check_deferred`) and the instance starts.

const stack = ownStack({ scenario: 'configured', overrides: { app: { extra_hosts: ['api.github.com:127.0.0.1'] } } });
const HTML = { accept: 'text/html' };
const app = dummyApp(stackDeps.randomHex);
let before = '';

test('before the credentials are saved the instance is in setup mode, and /setup is there', async () => {
  const status = await getFrom(stack(), '/api/setup/status');
  expect([status.status, await status.json()]).toEqual([200, { mode: 'setup' }]);
  expect((await getFrom(stack(), '/setup', HTML)).status).toBe(200);
  before = (await inspectService(stack(), 'app')).Id;
});

test('with the made-up key and ids in the files, docker compose up -d starts the application again, healthy', async () => {
  reconfigure(stack(), app);
  const up = await stack().compose(['up', '--detach', '--wait', '--wait-timeout', '120']);
  expect(up.code, output(up)).toBe(0);
  const container = await inspectService(stack(), 'app');
  expect(container.Id).not.toBe(before);
  expect([container.State.Status, container.State.Health?.Status]).toEqual(['running', 'healthy']);
});

test('GET /api/setup/status is {"mode":"configured"}', async () => {
  const response = await getFrom(stack(), '/api/setup/status');
  expect([response.status, await response.json()]).toEqual([200, { mode: 'configured' }]);
});

test.each([['/setup'], ['/setup/callback'], ['/setup/anything']])('GET %s is 404 now', async (pathname) => {
  const response = await getFrom(stack(), pathname, HTML);
  expect(response.status).toBe(404);
});

test('the application serves: /healthz and /readyz are 200 and the single-page app is at /', async () => {
  expect((await getFrom(stack(), '/healthz')).status).toBe(200);
  expect((await getFrom(stack(), '/readyz')).status).toBe(200);
  expect((await getFrom(stack(), '/', HTML)).status).toBe(200);
});

test('the log says normal mode and a deferred self-check, and holds none of the made-up credentials', async () => {
  const logs = await stack().compose(['logs', '--no-color', 'app']);
  expect(logs.code, output(logs)).toBe(0);
  const text = `${logs.stdout}${logs.stderr}`;
  expect(text).toMatch(/"msg":"config\.mode"[^\n]*"mode":"normal"|"mode":"normal"[^\n]*"msg":"config\.mode"/);
  expect(text).toContain('github.app_check_deferred');
  for (const name of Object.keys(app.secrets)) {
    expect(text.includes(stack().secret(name)), `secrets/${name} appears in the log`).toBe(false);
  }
});
