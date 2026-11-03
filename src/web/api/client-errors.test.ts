// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse, http } from 'msw';
import { expect, test } from 'vitest';
import { sessionRoute } from '../../shared/auth-contract.ts';
import { server } from '../test-support/server.ts';
import { createApiClient } from './client.ts';
import { ApiError, ContractError, NetworkError } from './errors.ts';
import {
  answer,
  asApiError,
  asNetworkError,
  createThing,
  envelope,
  fakeCsrf,
  getThing,
  json,
  listThings,
  rejection,
  THING,
  testClient,
} from './test-support.ts';

// How an answer or its absence becomes an error (E17-S04): the contract, the error envelope, the network and the abort.

const leak = 'ghu_notARealToken1234567890';

test('a 2xx body that fails the schema is a ContractError with the route and the paths, never the data', async () => {
  answer('/api/things/:thingId', json({ id: leak, size: leak, extra: [leak] }));
  const { client } = testClient();
  const error = await rejection(client.call(getThing, { params: { thingId: 'abc' }, query: {} }));
  expect(error).toBeInstanceOf(ContractError);
  expect(error).toMatchObject({ routeName: 'GET /api/things/:thingId', part: 'response', paths: ['size'] });
  expect(String(error)).not.toContain(leak);
  expect(JSON.stringify(error)).not.toContain(leak);
});

test('a missing field and a body of the wrong shape both name their path', async () => {
  answer('/api/things', json([THING, { id: 1 }]));
  const { client } = testClient();
  expect(await rejection(client.call(listThings))).toMatchObject({ paths: ['1.id', '1.size'] });
});

test.each([
  ['not JSON', new Response('<html>Gateway</html>', { status: 200 }), []],
  ['empty', new Response(null, { status: 200 }), ['$']],
])('a 200 whose body is %s is a ContractError, since the route promises JSON', async (_what, response, paths) => {
  answer('/api/things', response);
  const { client } = testClient();
  expect(await rejection(client.call(listThings))).toMatchObject({ name: 'ContractError', part: 'response', paths });
});

test('a 400 with the standard envelope is an ApiError with its status, code and request id', async () => {
  answer('/api/things', envelope(400, 'bad_request'));
  const { client } = testClient();
  const error = await rejection(client.call(createThing, { body: { size: 1 } }));
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({
    status: 400,
    code: 'bad_request',
    requestId: 'req-00000001',
    retryAfterSeconds: undefined,
  });
});

test('a domain code of the envelope is kept as it is', async () => {
  answer('/api/things', envelope(409, 'cla_version_conflict'));
  const { client } = testClient();
  expect(await rejection(client.call(createThing, { body: { size: 1 } }))).toMatchObject({
    status: 409,
    code: 'cla_version_conflict',
  });
});

test('the message of an ApiError is the status alone: nothing the server wrote reaches it', async () => {
  answer('/api/things', json({ error: { code: 'bad_request', message: leak, requestId: 'req-00000001' } }, 400));
  const { client } = testClient();
  const error = await rejection(client.call(createThing, { body: { size: 1 } }));
  expect(error).toMatchObject({ message: 'The request failed with status 400' });
  expect(JSON.stringify(error)).not.toContain(leak);
});

test.each([
  ['an envelope whose code is unauthorized, as the server sends it', envelope(401, 'unauthorized')],
  ['an envelope with another code', envelope(401, 'session_expired')],
  ['an HTML page from a proxy', new Response('<html>Login</html>', { status: 401 })],
  ['no body', new Response(null, { status: 401 })],
])('a 401 with %s is an ApiError with code unauthenticated', async (_what, response) => {
  answer('/api/auth/session', response);
  const { client } = testClient();
  expect(await rejection(client.call(sessionRoute))).toMatchObject({
    name: 'ApiError',
    status: 401,
    code: 'unauthenticated',
  });
});

test.each([
  ['an HTML page', new Response('<html>Bad gateway</html>', { status: 502 })],
  ['no body', new Response(null, { status: 503 })],
  ['JSON that is not the envelope', json({ message: 'nope' }, 500)],
  ['an envelope without a request id', json({ error: { code: 'x', message: 'y' } }, 500)],
  ['a JSON string', json('boom', 500)],
])('an error with %s is an ApiError with code unexpected_response', async (_what, response) => {
  answer('/api/things', response);
  const { client } = testClient();
  const error = await rejection(client.call(listThings));
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ code: 'unexpected_response', requestId: undefined });
});

test('when the body is not the envelope the request id comes from the X-Request-Id header, if it looks like one', async () => {
  answer(
    '/api/things',
    new Response('<html>Bad gateway</html>', { status: 502, headers: { 'x-request-id': 'req-from-header' } }),
  );
  const { client } = testClient();
  expect(await rejection(client.call(listThings))).toMatchObject({
    code: 'unexpected_response',
    requestId: 'req-from-header',
  });
});

test.each([
  ['spaces', 'not an id'],
  ['markup', '<script>alert(1)</script>'],
  ['65 characters', 'a'.repeat(65)],
])('a request id header with %s is not trusted', async (_what, header) => {
  answer('/api/things', new Response('x', { status: 502, headers: { 'x-request-id': header } }));
  const { client } = testClient();
  expect(asApiError(await rejection(client.call(listThings))).requestId).toBeUndefined();
});

test('a 429 with Retry-After in seconds exposes retryAfterSeconds', async () => {
  answer('/api/things', envelope(429, 'too_many_requests', { 'retry-after': '17' }));
  const { client } = testClient();
  expect(await rejection(client.call(listThings))).toMatchObject({
    status: 429,
    code: 'too_many_requests',
    retryAfterSeconds: 17,
  });
});

test('a 429 with Retry-After as an HTTP date counts from the clock of the client', async () => {
  answer('/api/things', envelope(429, 'too_many_requests', { 'retry-after': 'Sun, 06 Nov 1994 08:50:37 GMT' }));
  const { client } = testClient(undefined, () => Date.parse('Sun, 06 Nov 1994 08:49:37 GMT'));
  expect(await rejection(client.call(listThings))).toMatchObject({ status: 429, retryAfterSeconds: 60 });
});

test('a 429 without Retry-After, or with a header that means nothing, has no retryAfterSeconds', async () => {
  answer('/api/things', envelope(429, 'too_many_requests', { 'retry-after': 'soon' }));
  const { client } = testClient();
  expect(asApiError(await rejection(client.call(listThings))).retryAfterSeconds).toBeUndefined();
});

test('the real clock is used when the client is given none', async () => {
  const date = new Date(Date.now() + 120_000).toUTCString();
  answer('/api/things', envelope(503, 'unavailable', { 'retry-after': date }));
  const { client } = testClient();
  const wait = asApiError(await rejection(client.call(listThings))).retryAfterSeconds;
  expect(wait).toBeGreaterThanOrEqual(118);
  expect(wait).toBeLessThanOrEqual(121);
});

test('a failed fetch is a NetworkError that keeps the cause', async () => {
  server.use(http.get('/api/things', () => HttpResponse.error()));
  const { client } = testClient();
  expect(asNetworkError(await rejection(client.call(listThings))).cause).toBeInstanceOf(TypeError);
});

test.each([
  ['a success', 200],
  ['an error', 500],
])('a body that breaks off while it is read is a NetworkError, for %s', async (_what, status) => {
  const broken = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new TypeError('terminated'));
    },
  });
  server.use(http.get('/api/things', () => new HttpResponse(broken, { status })));
  const { client } = testClient();
  expect(await rejection(client.call(listThings))).toBeInstanceOf(NetworkError);
});

test('an aborted call rejects with the original AbortError, not a NetworkError', async () => {
  server.use(http.get('/api/things', () => new Promise<Response>(() => undefined)));
  const controller = new AbortController();
  const { client } = testClient();
  const pending = rejection(client.call(listThings, undefined, { signal: controller.signal }));
  controller.abort();
  const error = await pending;
  expect(error).not.toBeInstanceOf(NetworkError);
  expect(error).toMatchObject({ name: 'AbortError' });
});

test('an AbortError the caller did not ask for (the browser cancelled the fetch) passes through as it is, since no signal of the call is aborted', async () => {
  const cancelled = new DOMException('The operation was aborted.', 'AbortError');
  const client = createApiClient({ fetch: () => Promise.reject(cancelled), csrf: fakeCsrf('csrf-token') });
  const error = await rejection(client.call(listThings));
  expect(error).toBe(cancelled);
  expect(error).not.toBeInstanceOf(NetworkError);
});

test('any other rejection of fetch is a NetworkError, whatever its name', async () => {
  const refused = new DOMException('The network connection was lost.', 'NetworkError');
  const client = createApiClient({ fetch: () => Promise.reject(refused), csrf: fakeCsrf('csrf-token') });
  expect(asNetworkError(await rejection(client.call(listThings))).cause).toBe(refused);
});

test('a signal that is already aborted rejects at once with its own reason', async () => {
  const reason = new Error('the user left the page');
  const { client, sent } = testClient();
  const error = await rejection(client.call(listThings, undefined, { signal: AbortSignal.abort(reason) }));
  expect(error).toBe(reason);
  expect(sent).toHaveLength(1);
});

test('the signal is handed to fetch, and a call without one hands none', async () => {
  answer('/api/things', json([THING]));
  const { client, sent } = testClient();
  const controller = new AbortController();
  await client.call(listThings, undefined, { signal: controller.signal });
  await client.call(listThings);
  expect(sent[0]?.init.signal).toBe(controller.signal);
  expect(sent[1]?.init).not.toHaveProperty('signal');
});

test('an abort while the body is read is also the original error', async () => {
  const controller = new AbortController();
  const unfinished = new ReadableStream<Uint8Array>({
    start(stream) {
      stream.enqueue(new TextEncoder().encode('['));
    },
  });
  server.use(http.get('/api/things', () => new HttpResponse(unfinished, { status: 200 })));
  const { client } = testClient();
  const pending = rejection(client.call(listThings, undefined, { signal: controller.signal }));
  await new Promise((resolve) => setTimeout(resolve, 25));
  controller.abort();
  const error = await pending;
  expect(error).not.toBeInstanceOf(NetworkError);
  expect(error).toMatchObject({ name: 'AbortError' });
});
