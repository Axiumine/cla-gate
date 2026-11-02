// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { webhookFixture, withValue } from '../github/webhook-fixture/test-support.ts';
import { deliveryHeaders, postDelivery, SECRET_CURRENT, webhookTestApp } from './test-support.ts';

// Failure injection for the routing table (E06-S04): a router that throws is a 500 through the error handler of the app,
// and nothing of the delivery is logged.

vi.mock('../../domain/webhook-routing.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../domain/webhook-routing.ts')>();
  return { ...original, routeWebhook: vi.fn(original.routeWebhook) };
});

const { routeWebhook } = await import('../../domain/webhook-routing.ts');

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT };
const CANARY = 'canary-value-8e1f5b2a';

test('a router that throws is a 500 in the standard error body, the log holds no body, and the next delivery is served', async () => {
  const { app, logs } = await webhookTestApp({ env: ENV });
  vi.mocked(routeWebhook).mockImplementationOnce(() => {
    throw new Error('the router is broken');
  });
  const body = JSON.stringify(withValue(webhookFixture('pull_request'), 'pull_request.title', CANARY));
  const failed = await postDelivery(
    app,
    body,
    deliveryHeaders(body, { headers: { 'x-github-event': 'pull_request' } }),
  );
  expect(failed.statusCode).toBe(500);
  expect(errorResponseSchema.parse(failed.json())).toEqual({
    error: {
      code: 'internal_server_error',
      message: 'Internal Server Error',
      requestId: failed.headers['x-request-id'],
    },
  });
  expect(logs.lines().find((line) => line['msg'] === 'unhandled error')).toBeDefined();
  expect(logs.text()).not.toContain(CANARY);
  expect(logs.text()).not.toContain('fixture-');
  const next = await postDelivery(app, body, deliveryHeaders(body, { headers: { 'x-github-event': 'ping' } }));
  expect(next.statusCode).toBe(200);
  expect(next.json()).toEqual({ status: 'pong' });
});
