// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { logoutRoute, sessionRoute } from '../../shared/auth-contract.ts';
import { ContractError } from './errors.ts';
import {
  answer,
  createThing,
  fakeCsrf,
  getThing,
  json,
  listThings,
  resetThings,
  THING,
  testClient,
} from './test-support.ts';

// The request side of the typed client (E17-S04) against an MSW server: what is sent for each kind of route, and what a
// success returns.

test('a GET resolves to the body parsed with the schema of the route', async () => {
  answer('/api/things/abc', json(THING));
  const { client } = testClient();
  expect(await client.call(getThing, { params: { thingId: 'abc' }, query: {} })).toEqual(THING);
});

test('a route with nothing to send takes no input at all', async () => {
  const seen = answer('/api/things', json([THING]));
  const { client } = testClient();
  expect(await client.call(listThings)).toEqual([THING]);
  expect(seen.map((request) => request.method)).toEqual(['GET']);
});

test('a path parameter is encoded as one segment: a/b?c#d cannot reach another path or a query', async () => {
  const seen = answer('/api/things/:thingId', json(THING));
  const { client } = testClient();
  await client.call(getThing, { params: { thingId: 'a/b?c#d' }, query: {} });
  expect(new URL(seen[0]?.url ?? '').pathname).toBe('/api/things/a%2Fb%3Fc%23d');
  expect(new URL(seen[0]?.url ?? '').search).toBe('');
});

test('undefined query values are omitted and the others are sent, a list as a repeated key', async () => {
  const seen = answer('/api/things/:thingId', json(THING));
  const { client } = testClient();
  await client.call(getThing, {
    params: { thingId: 'abc' },
    query: { limit: undefined, tag: ['a b', 'c&d'], flag: false },
  });
  expect(new URL(seen[0]?.url ?? '').search).toBe('?tag=a+b&tag=c%26d&flag=false');
});

test('a query that is entirely undefined adds no question mark', async () => {
  const seen = answer('/api/things/:thingId', json(THING));
  const { client } = testClient();
  await client.call(getThing, { params: { thingId: 'abc' }, query: { limit: undefined } });
  expect(new URL(seen[0]?.url ?? '').search).toBe('');
});

test('a body is JSON with content-type application/json, and the success status the route declares is parsed', async () => {
  const seen = answer('/api/things', json(THING, 201));
  const { client } = testClient();
  expect(await client.call(createThing, { body: { size: 3 } })).toEqual(THING);
  expect(seen[0]).toMatchObject({ method: 'POST', text: '{"size":3}' });
  expect(seen[0]?.headers['content-type']).toBe('application/json');
});

test('a call with no body sends no body and no content-type: an empty body labelled JSON is a 400 at the server', async () => {
  const seen = answer('/api/auth/logout', new Response(null, { status: 204 }));
  const { client } = testClient();
  await expect(client.call(logoutRoute)).resolves.toBeUndefined();
  expect(seen[0]?.text).toBe('');
  expect(seen[0]?.headers['content-type']).toBeUndefined();
});

test('the logout body of E10 is sent as JSON when it is given', async () => {
  const seen = answer('/api/auth/logout', new Response(null, { status: 204 }));
  const { client } = testClient();
  await client.call(logoutRoute, { body: { everywhere: true } });
  expect(seen[0]?.text).toBe('{"everywhere":true}');
});

test('a route with nothing to send and nothing back resolves to undefined', async () => {
  answer('/api/things/reset', new Response(null, { status: 204 }));
  const { client } = testClient();
  await expect(client.call(resetThings)).resolves.toBeUndefined();
});

test('the request is exactly: the method, same-origin credentials, and the three headers, never an Authorization or a Cookie', async () => {
  const seen = answer('/api/things', json(THING, 201));
  const { client, sent } = testClient(fakeCsrf('token-one'));
  await client.call(createThing, { body: { size: 1 } });
  const init: RequestInit = sent[0]?.init ?? {};
  expect(init.method).toBe('POST');
  expect(init.credentials).toBe('same-origin');
  expect(Object.keys(init.headers ?? {}).sort((a, b) => a.localeCompare(b))).toEqual([
    'accept',
    'content-type',
    'x-csrf-token',
  ]);
  expect(seen[0]?.headers['authorization']).toBeUndefined();
  expect(seen[0]?.headers['cookie']).toBeUndefined();
});

test.each([
  ['a GET', 'GET'],
  ['a POST', 'POST'],
])('%s never carries an Authorization or a Cookie header', async (_what, method) => {
  const seen = answer('/api/things', method === 'GET' ? json([THING]) : json(THING, 201));
  const { client, sent } = testClient();
  await (method === 'GET' ? client.call(listThings) : client.call(createThing, { body: { size: 1 } }));
  const names = Object.keys(sent[0]?.init.headers ?? {}).map((name) => name.toLowerCase());
  expect(names).not.toContain('authorization');
  expect(names).not.toContain('cookie');
  expect(seen[0]?.headers['authorization']).toBeUndefined();
  expect(seen[0]?.headers['cookie']).toBeUndefined();
});

test('a GET carries no CSRF token even when one is held, and a state-changing call carries the current one', async () => {
  answer('/api/auth/session', json({}));
  const csrf = fakeCsrf('held-token');
  const { client, sent } = testClient(csrf);
  await expect(client.call(sessionRoute)).rejects.toBeInstanceOf(ContractError);
  expect(sent[0]?.init.headers).toEqual({ accept: 'application/json' });
  answer('/api/things', json(THING, 201));
  await client.call(createThing, { body: { size: 1 } });
  csrf.set('later-token');
  await client.call(createThing, { body: { size: 1 } });
  expect(sent.slice(1).map((request) => new Headers(request.init.headers).get('x-csrf-token'))).toEqual([
    'held-token',
    'later-token',
  ]);
});

test('a state-changing call with no token held sends none, rather than an empty one', async () => {
  answer('/api/things', json(THING, 201));
  const { client, sent } = testClient(fakeCsrf(undefined));
  await client.call(createThing, { body: { size: 1 } });
  expect(Object.keys(sent[0]?.init.headers ?? {})).not.toContain('x-csrf-token');
});

test('an input the schema refuses is a ContractError of the request, and nothing is sent', async () => {
  const seen = answer('/api/things', json(THING, 201));
  const { client, sent } = testClient();
  const failure = await client.call(createThing, { body: { size: 5000 } }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ContractError);
  expect(failure).toMatchObject({ routeName: 'POST /api/things', part: 'body', paths: ['size'] });
  expect(sent).toEqual([]);
  expect(seen).toEqual([]);
});

test('a success status the route does not declare is a ContractError, and it names no data', async () => {
  answer('/api/things', json(THING, 200));
  const { client } = testClient();
  await expect(client.call(createThing, { body: { size: 1 } })).rejects.toMatchObject({
    name: 'ContractError',
    part: 'response',
    paths: [],
  });
});
