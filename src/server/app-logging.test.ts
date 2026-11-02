// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { authWorld } from './adapters/http/auth-fixture/test-support.ts';
import { testRsaKey } from './config/test-support.ts';
import { testApp } from './test-support.ts';

test('request logs hold the method, path and status, and never the client address, headers, bodies, cookies or query strings', async () => {
  const { app, logs, login } = await authWorld();
  app.post('/session', (_request, reply) => reply.header('set-cookie', 'sid=sekrit-set-cookie').send({ ok: true }));
  const alice = await login(1001);
  await app.inject({
    method: 'POST',
    url: '/session?code=oauth-code-123&state=oauth-state-456',
    headers: { authorization: 'Bearer sekrit-token', ...alice.headers, 'content-type': 'application/json' },
    payload: { comment: 'sekrit-body' },
  });
  expect(logs.text()).not.toMatch(/sekrit|oauth-code|oauth-state/);
  expect(logs.text()).not.toContain(alice.id);
  expect(logs.text()).not.toContain(alice.token);
  const incoming = logs.lines().find((line) => line['msg'] === 'incoming request');
  expect(incoming?.['req']).toEqual({ method: 'POST', url: '/session' });
  const completed = logs.lines().find((line) => line['msg'] === 'request completed');
  expect(completed).toMatchObject({ res: { statusCode: 200 } });
});

test('configuration secrets never appear in the logs', async () => {
  const key = testRsaKey().pkcs8;
  const { app, logs } = await testApp({
    env: {
      SESSION_SECRET: 's3ssion-'.repeat(8),
      GITHUB_WEBHOOK_SECRET: 'whsec-value',
      GITHUB_APP_PRIVATE_KEY: key,
    },
  });
  await app.inject('/healthz');
  expect(logs.text()).not.toMatch(/s3ssion|whsec-value|user:pw|PRIVATE KEY/);
  expect(logs.text()).not.toContain(key.split('\n')[1] ?? 'missing');
});
