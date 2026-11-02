// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { errorResponseSchema } from '../src/shared/errors.ts';
import { expect, getJson, test } from './support/test.ts';

// E20-S06: the built server answers on a real socket, with the database up, and every response carries the CSP header.
test('GET /healthz answers 200 {"status":"ok"} and sends a content-security-policy header', async ({ request }) => {
  const reply = await getJson(request, '/healthz');
  expect(reply.status).toBe(200);
  expect(reply.body).toEqual({ status: 'ok' });
  expect(reply.headers['content-security-policy']).toContain("default-src 'self'");
});

test('GET /readyz answers 200 {"status":"ready"} with the database up and sends a content-security-policy header', async ({
  request,
}) => {
  const reply = await getJson(request, '/readyz');
  expect(reply.status).toBe(200);
  expect(reply.body).toEqual({ status: 'ready' });
  expect(reply.headers['content-security-policy']).toContain("default-src 'self'");
});

test('an unknown path answers 404 with the standard error body, its request id, and a content-security-policy header', async ({
  request,
}) => {
  const reply = await getJson(request, '/no-such-path');
  expect(reply.status).toBe(404);
  const { error } = errorResponseSchema.parse(reply.body);
  expect(error.code).toBe('not_found');
  expect(error.requestId).toBe(reply.headers['x-request-id']);
  expect(reply.headers['content-security-policy']).toContain("default-src 'self'");
});
