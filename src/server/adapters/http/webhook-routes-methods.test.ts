// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterAll, expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import { deliveryRows, jobCount } from '../../services/jobs-fixture/test-support.ts';
import { FIXTURE_IDS, webhookFixture } from '../github/webhook-fixture/test-support.ts';
import {
  deliveryHeaders,
  SECRET_CURRENT,
  sharedTenantWebhookApp,
  watchCreateHmac,
  watchTimingSafeEqual,
} from './test-support.ts';

// Only POST is a route (E06-S07): any other method on the path is Fastify's own 404 for a method nobody registered, in
// the standard error body, and nothing of the webhook scope runs for it: no hook, no signature check, no handler.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT, GITHUB_APP_ID: String(FIXTURE_IDS.app) };
type Running = Awaited<ReturnType<typeof sharedTenantWebhookApp>>;

// One app and one database serve the file (a database costs seconds to build); no test here may record anything.
let started: Promise<Running> | undefined;
afterAll(async () => {
  await (await started)?.app.close();
});

function running(): Promise<Running> {
  started ??= sharedTenantWebhookApp(ENV);
  return started;
}

const BODY = JSON.stringify(webhookFixture('pull_request'));
const METHODS = [
  'GET',
  'HEAD',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'TRACE',
  'PROPFIND',
  'PURGE',
  'LOCK',
  'REPORT',
  'SEARCH',
] as const;

test.each(METHODS)(
  '%s on the webhook path is a 404 in the standard body, even carrying a valid signed delivery',
  async (method) => {
    const { app, logs, db, enqueuer } = await running();
    const headers = deliveryHeaders(BODY, { headers: { 'x-github-event': 'pull_request' } });
    const hmac = watchCreateHmac();
    const compare = watchTimingSafeEqual();
    const response = await app.inject({ method, url: WEBHOOK_PATH, headers, payload: BODY });
    expect(response.statusCode).toBe(404);
    if (method !== 'HEAD') {
      expect(errorResponseSchema.parse(response.json())).toEqual({
        error: { code: 'not_found', message: 'Not Found', requestId: response.headers['x-request-id'] },
      });
    }
    expect(hmac).not.toHaveBeenCalled();
    expect(compare).not.toHaveBeenCalled();
    expect(enqueuer.calls).toEqual([]);
    expect(await deliveryRows(db)).toEqual([]);
    expect(await jobCount(db)).toBe(0);
    expect(logs.lines().filter((line) => String(line['msg']).startsWith('webhook.'))).toEqual([]);
  },
);

test('a path next to the webhook path is a 404 too: a trailing slash and another case do not reach the route', async () => {
  const { app, logs } = await running();
  const headers = deliveryHeaders(BODY, { headers: { 'x-github-event': 'pull_request' } });
  for (const url of [`${WEBHOOK_PATH}/`, WEBHOOK_PATH.toUpperCase(), `${WEBHOOK_PATH}/extra`]) {
    const response = await app.inject({ method: 'POST', url, headers, payload: BODY });
    expect([url, response.statusCode]).toEqual([url, 404]);
  }
  expect(logs.lines().filter((line) => String(line['msg']).startsWith('webhook.'))).toEqual([]);
});
