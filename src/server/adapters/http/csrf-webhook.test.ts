// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import { freePort, sendRaw } from '../../test-support.ts';
import { authWorld } from './auth-fixture/test-support.ts';
import { deliveryHeaders, SECRET_CURRENT, signUnconfigured, webhookTestApp } from './test-support.ts';

// The webhook route against the login's checks (E10-S03, E10-S08 with E06): a delivery is authenticated by its HMAC
// alone, so it is served with no `Origin`, no session and no CSRF token, and a bad signature is the route's own 401,
// never the CSRF layer's 403. The exemption is matched on the routed path, so no spelling of the target moves a request
// in or out of it. Each case runs with the login configured (a person can be logged in) and without it.

const ENV = { GITHUB_WEBHOOK_SECRET: SECRET_CURRENT };
const BODY = '{"zen":"Keep it logically awesome."}';
const ORIGIN_NOT_ALLOWED = 'origin_not_allowed';

/** The real application with the login configured: a PGlite in which people can be logged in. */
async function withLogin(): Promise<FastifyInstance> {
  return (await authWorld(ENV)).app;
}

/** The real application with no login settings: the guards are registered all the same. */
async function withoutLogin(): Promise<FastifyInstance> {
  return (await webhookTestApp({ env: ENV })).app;
}

const WORLDS = [
  ['with the login configured', withLogin],
  ['without the login settings', withoutLogin],
] as const;

/** Spellings of the path that reach the route through `inject`: with a query string, percent-escaped. */
const INJECTED_TARGETS = [
  WEBHOOK_PATH,
  `${WEBHOOK_PATH}?next=/api/auth/logout`,
  '/webhooks/%67ithub',
  '/%77ebhooks/github',
];

/** Spellings that only a raw request line can carry: a fragment and the absolute form of the target. */
const RAW_TARGETS = [`${WEBHOOK_PATH}#fragment`, `http://127.0.0.1${WEBHOOK_PATH}`, '/webhooks/%67ithub#fragment'];

function codeOf(response: { json: () => unknown }): string {
  return errorResponseSchema.parse(response.json()).error.code;
}

/** A whole HTTP/1.1 `POST` as text for {@link sendRaw}, with no `Origin`, no cookie and no CSRF token. */
function rawPostTo(target: string, headers: Record<string, string>): string {
  return [
    `POST ${target} HTTP/1.1`,
    'Host: 127.0.0.1',
    `Content-Length: ${BODY.length}`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    'Connection: close',
    '',
    BODY,
  ].join('\r\n');
}

const SIGNED = deliveryHeaders(BODY);
const FORGED = deliveryHeaders(BODY, { signature: signUnconfigured(BODY) });

test.each(WORLDS.flatMap(([label, world]) => INJECTED_TARGETS.map((target) => [label, target, world] as const)))(
  'a signed delivery %s to %s needs no Origin, session or token: it is the 200 pong of the route',
  async (_label, target, world) => {
    const app = await world();
    const response = await app.inject({ method: 'POST', url: target, headers: SIGNED, payload: BODY });
    expect([response.statusCode, response.json()]).toEqual([200, { status: 'pong' }]);
  },
);

test.each(WORLDS.flatMap(([label, world]) => INJECTED_TARGETS.map((target) => [label, target, world] as const)))(
  'a delivery %s to %s with a bad signature is 401 webhook_signature_invalid, never a 403 of the CSRF layer',
  async (_label, target, world) => {
    const app = await world();
    const response = await app.inject({ method: 'POST', url: target, headers: FORGED, payload: BODY });
    expect([response.statusCode, codeOf(response)]).toEqual([401, 'webhook_signature_invalid']);
  },
);

test.each(WORLDS.flatMap(([label, world]) => RAW_TARGETS.map((target) => [label, target, world] as const)))(
  'a delivery %s written to the socket as %s is served when signed and is 401 when not',
  async (_label, target, world) => {
    const app = await world();
    const address = await app.listen({ host: '127.0.0.1', port: await freePort() });
    const served = await sendRaw(address, rawPostTo(target, SIGNED));
    const refused = await sendRaw(address, rawPostTo(target, FORGED));
    expect([served.statusLine, refused.statusLine]).toEqual(['HTTP/1.1 200 OK', 'HTTP/1.1 401 Unauthorized']);
    expect(JSON.parse(refused.body)).toMatchObject({ error: { code: 'webhook_signature_invalid' } });
  },
);

test('a signed delivery still passes with a hostile Origin, a forged session cookie and a wrong token, which are ignored', async () => {
  const { app, queries } = await authWorld(ENV);
  const before = queries.length;
  const headers = {
    ...SIGNED,
    origin: 'https://evil.example',
    cookie: `__Host-cla_session=${'B'.repeat(43)}`,
    'x-csrf-token': 'A'.repeat(43),
  };
  const response = await app.inject({ method: 'POST', url: WEBHOOK_PATH, headers, payload: BODY });
  expect([response.statusCode, response.json()]).toEqual([200, { status: 'pong' }]);
  expect(queries, 'no session lookup runs on the webhook scope').toHaveLength(before);
});

test('a route is exempt by what the router resolved, not by what the URL says: the webhook path in a query string or fragment guards nothing', async () => {
  const { app } = await authWorld(ENV);
  const address = await app.listen({ host: '127.0.0.1', port: await freePort() });
  const targets = [
    `/probe/mutate?next=${WEBHOOK_PATH}`,
    `/probe/mutate?${WEBHOOK_PATH}`,
    `/api/auth/logout?next=${WEBHOOK_PATH}`,
  ];
  for (const url of targets) {
    const response = await app.inject({ method: 'POST', url, headers: SIGNED, payload: BODY });
    expect([url, response.statusCode, codeOf(response)]).toEqual([url, 403, ORIGIN_NOT_ALLOWED]);
  }
  const raw = await sendRaw(address, rawPostTo(`/probe/mutate#${WEBHOOK_PATH}`, SIGNED));
  expect(raw.statusLine).toBe('HTTP/1.1 403 Forbidden');
  expect(JSON.parse(raw.body)).toMatchObject({ error: { code: ORIGIN_NOT_ALLOWED } });
});

test('a path the router does not resolve to the webhook is no webhook: a trailing slash and another case are 404, not exempt', async () => {
  const { app } = await authWorld(ENV);
  for (const url of [`${WEBHOOK_PATH}/`, '/Webhooks/github', `${WEBHOOK_PATH}x`]) {
    const response = await app.inject({ method: 'POST', url, headers: SIGNED, payload: BODY });
    expect([url, response.statusCode, codeOf(response)]).toEqual([url, 404, 'not_found']);
  }
});

test('the login and the webhook throttles do not touch each other: no rate-limit header, no no-store, and the 31st failure is the webhook 429', async () => {
  const { app } = await authWorld(ENV);
  const post = (headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: WEBHOOK_PATH, headers, payload: BODY, remoteAddress: '203.0.113.7' });
  const served = await post(SIGNED);
  expect(served.headers['x-ratelimit-limit']).toBeUndefined();
  expect(served.headers['cache-control']).toBeUndefined();
  const failures: Awaited<ReturnType<typeof post>>[] = [];
  for (let sent = 0; sent < 30; sent++) {
    failures.push(await post(FORGED));
  }
  expect(failures.map((response) => response.statusCode)).toEqual(Array.from({ length: 30 }, () => 401));
  expect(failures.every((response) => response.headers['x-ratelimit-limit'] === undefined)).toBe(true);
  const held = await post(FORGED);
  expect([held.statusCode, codeOf(held), held.headers['x-ratelimit-limit']]).toEqual([
    429,
    'webhook_throttled',
    undefined,
  ]);
  expect(held.headers['retry-after']).toBe('60');
});

test('the failed-signature throttle counts a failure once: it is not also a hit on the login budget of the address', async () => {
  const { app } = await authWorld(ENV);
  for (let sent = 0; sent < 31; sent++) {
    await app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      headers: FORGED,
      payload: BODY,
      remoteAddress: '203.0.113.9',
    });
  }
  const session = await app.inject({ method: 'GET', url: '/api/auth/session', remoteAddress: '203.0.113.9' });
  expect(session.headers['x-ratelimit-remaining']).toBe(String(120 - 1));
});
