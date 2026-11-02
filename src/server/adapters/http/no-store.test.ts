// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import Fastify from 'fastify';
import { expect, test } from 'vitest';
import { setNoStore } from './no-store.ts';

test('an answer that sets no-store carries the header and still sends its body', async () => {
  const app = Fastify();
  app.get('/stored', (_request, reply) => {
    setNoStore(reply);
    return { ok: true };
  });
  const response = await app.inject({ method: 'GET', url: '/stored' });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toEqual({ ok: true });
  await app.close();
});

test('an answer that does not call it has no cache-control header', async () => {
  const app = Fastify();
  app.get('/plain', () => ({ ok: true }));
  const response = await app.inject({ method: 'GET', url: '/plain' });
  expect(response.headers['cache-control']).toBeUndefined();
  await app.close();
});
