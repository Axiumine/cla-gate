// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { logoutRoute, sessionRoute } from '../../shared/auth-contract.ts';
import { createApiClient } from './client.ts';
import { ApiError } from './errors.ts';
import {
  answer,
  asApiError,
  createThing,
  envelope,
  fakeCsrf,
  json,
  listThings,
  rejection,
  THING,
  testClient,
} from './test-support.ts';

// The CSRF refresh and the 401 callback of the client (E17-S04), and what it never retries.

const create = { body: { size: 1 } };

test('a 403 csrf_invalid refreshes the session once and sends the request once more with the new token', async () => {
  const seen = answer('/api/things', envelope(403, 'csrf_invalid'), json(THING, 201));
  const csrf = fakeCsrf('old-token', 'new-token');
  const { client } = testClient(csrf);
  expect(await client.call(createThing, create)).toEqual(THING);
  expect(csrf.refreshes()).toBe(1);
  expect(seen.map((request) => request.headers['x-csrf-token'])).toEqual(['old-token', 'new-token']);
  expect(seen.map((request) => request.text)).toEqual(['{"size":1}', '{"size":1}']);
});

test('a second csrf_invalid is the answer: one refresh, two requests, an ApiError', async () => {
  const seen = answer('/api/things', envelope(403, 'csrf_invalid'));
  const csrf = fakeCsrf('old-token', 'new-token');
  const { client } = testClient(csrf);
  const error = asApiError(await rejection(client.call(createThing, create)));
  expect(error).toMatchObject({ status: 403, code: 'csrf_invalid' });
  expect(csrf.refreshes()).toBe(1);
  expect(seen).toHaveLength(2);
});

test('a request sent with no token at all is retried too, once the refresh brings one', async () => {
  const seen = answer('/api/things', envelope(403, 'csrf_invalid'), json(THING, 201));
  const csrf = fakeCsrf(undefined, 'fresh-token');
  const { client } = testClient(csrf);
  expect(await client.call(createThing, create)).toEqual(THING);
  expect(seen.map((request) => request.headers['x-csrf-token'])).toEqual([undefined, 'fresh-token']);
});

test('when the refresh finds no session there is nothing new to send: the first error is the answer', async () => {
  const seen = answer('/api/things', envelope(403, 'csrf_invalid'));
  const csrf = fakeCsrf('old-token', undefined);
  const { client } = testClient(csrf);
  expect(asApiError(await rejection(client.call(createThing, create)))).toMatchObject({ code: 'csrf_invalid' });
  expect(csrf.refreshes()).toBe(1);
  expect(seen).toHaveLength(1);
});

test('when the refresh itself fails, that failure is what the caller sees and the request is not sent again', async () => {
  const seen = answer('/api/things', envelope(403, 'csrf_invalid'));
  const failure = new ApiError({ status: 500, code: 'internal_server_error' });
  const csrf = { current: () => 'old-token', refresh: () => Promise.reject(failure) };
  const { client } = testClient(csrf);
  expect(await rejection(client.call(createThing, create))).toBe(failure);
  expect(seen).toHaveLength(1);
});

test.each([
  ['a 403 with another code', envelope(403, 'origin_not_allowed')],
  ['a 403 without a code the client knows', envelope(403, 'forbidden')],
  ['a 400 with the csrf code', envelope(400, 'csrf_invalid')],
  ['a 403 that is no envelope', new Response('Forbidden', { status: 403 })],
])('%s does not refresh the session or send the request again', async (_what, response) => {
  const seen = answer('/api/things', response);
  const csrf = fakeCsrf('old-token', 'new-token');
  const { client } = testClient(csrf);
  await rejection(client.call(createThing, create));
  expect(csrf.refreshes()).toBe(0);
  expect(seen).toHaveLength(1);
});

test('a GET that is refused for a CSRF token is not retried: it never carried one', async () => {
  const seen = answer('/api/things', envelope(403, 'csrf_invalid'));
  const csrf = fakeCsrf('old-token', 'new-token');
  const { client } = testClient(csrf);
  expect(asApiError(await rejection(client.call(listThings))).code).toBe('csrf_invalid');
  expect(csrf.refreshes()).toBe(0);
  expect(seen).toHaveLength(1);
});

test('a retried request carries the same body and the same abort signal', async () => {
  const seen = answer('/api/auth/logout', envelope(403, 'csrf_invalid'), new Response(null, { status: 204 }));
  const { client, sent } = testClient(fakeCsrf('old-token', 'new-token'));
  const controller = new AbortController();
  await client.call(logoutRoute, { body: { everywhere: true } }, { signal: controller.signal });
  expect(seen.map((request) => request.text)).toEqual(['{"everywhere":true}', '{"everywhere":true}']);
  expect(sent.map((request) => request.init.signal)).toEqual([controller.signal, controller.signal]);
});

test.each([
  ['a 500', envelope(500, 'internal_server_error')],
  ['a 502 page', new Response('<html>Bad gateway</html>', { status: 502 })],
  ['a 429', envelope(429, 'too_many_requests', { 'retry-after': '1' })],
  ['a 401', envelope(401, 'unauthorized')],
  ['a 409', envelope(409, 'conflict')],
])('a POST that gets %s is sent once and never again', async (_what, response) => {
  const seen = answer('/api/things', response);
  const csrf = fakeCsrf('token');
  const { client } = testClient(csrf);
  await rejection(client.call(createThing, create));
  expect(seen).toHaveLength(1);
  expect(csrf.refreshes()).toBe(0);
});

test('a POST whose connection fails is sent once and never again', async () => {
  const fetchStub = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
  const client = createApiClient({ fetch: fetchStub, csrf: fakeCsrf('token') });
  expect(await rejection(client.call(createThing, create))).toMatchObject({ name: 'NetworkError' });
  expect(fetchStub).toHaveBeenCalledTimes(1);
});

test("a GET that gets a 500 is not retried by the client either: retrying a read is the query cache's business", async () => {
  const seen = answer('/api/things', envelope(500, 'internal_server_error'), json([THING]));
  const { client } = testClient();
  await rejection(client.call(listThings));
  expect(seen).toHaveLength(1);
});

test('a 401 is an unauthenticated ApiError, and the registered callback hears about it once, with the route', async () => {
  answer('/api/auth/session', envelope(401, 'unauthorized'));
  const { client } = testClient();
  const heard: string[] = [];
  client.onUnauthenticated((routeName) => heard.push(routeName));
  expect(asApiError(await rejection(client.call(sessionRoute))).code).toBe('unauthenticated');
  expect(heard).toEqual(['GET /api/auth/session']);
});

test('every registered callback is called, and a removed one is not', async () => {
  answer('/api/things', envelope(401, 'unauthorized'));
  const { client } = testClient();
  const first: string[] = [];
  const second: string[] = [];
  const removeFirst = client.onUnauthenticated((routeName) => first.push(routeName));
  client.onUnauthenticated((routeName) => second.push(routeName));
  await rejection(client.call(listThings));
  removeFirst();
  await rejection(client.call(listThings));
  expect(first).toEqual(['GET /api/things']);
  expect(second).toEqual(['GET /api/things', 'GET /api/things']);
});

test.each([
  ['a 403', envelope(403, 'forbidden')],
  ['a 500', envelope(500, 'internal_server_error')],
  ['a 200', json([THING])],
])('%s does not call the unauthenticated callback', async (_what, response) => {
  answer('/api/things', response);
  const { client } = testClient();
  const heard: string[] = [];
  client.onUnauthenticated((routeName) => heard.push(routeName));
  await rejection(client.call(listThings));
  expect(heard).toEqual([]);
});

test('a 401 on the retry after a refresh is also unauthenticated', async () => {
  answer('/api/things', envelope(403, 'csrf_invalid'), envelope(401, 'unauthorized'));
  const { client } = testClient(fakeCsrf('old-token', 'new-token'));
  const heard: string[] = [];
  client.onUnauthenticated((routeName) => heard.push(routeName));
  expect(asApiError(await rejection(client.call(createThing, create))).code).toBe('unauthenticated');
  expect(heard).toEqual(['POST /api/things']);
});
