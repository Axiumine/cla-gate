// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { errorResponseSchema } from '../shared/errors.ts';
import { PUBLIC_ROUTE, testApp } from './test-support.ts';

test('the HTTP server sets every timeout and limit explicitly, so no client can hold a connection open forever', async () => {
  const { app } = await testApp();
  expect({
    socketInactivity: app.server.timeout,
    wholeRequest: app.server.requestTimeout,
    headers: app.server.headersTimeout,
    keepAlive: app.server.keepAliveTimeout,
    requestsPerSocket: app.server.maxRequestsPerSocket,
  }).toEqual({
    socketInactivity: 30_000,
    wholeRequest: 30_000,
    headers: 10_000,
    keepAlive: 65_000,
    requestsPerSocket: 1000,
  });
  expect(app.initialConfig.bodyLimit).toBe(1_048_576);
});

test('a body over the limit is refused with the standard error body', async () => {
  const { app } = await testApp();
  app.post('/echo', { ...PUBLIC_ROUTE, schema: { body: z.object({ text: z.string() }) } }, (request) => request.body);
  const big = JSON.stringify({ text: 'a'.repeat(1_048_576) });
  const response = await app.inject({
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' },
    payload: big,
  });
  expect(response.statusCode).toBe(413);
  expect(errorResponseSchema.parse(response.json()).error).toMatchObject({
    code: 'payload_too_large',
    message: 'Payload Too Large',
  });
});
