// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { defineRoute } from '../../shared/contract.ts';
import { ContractError } from './errors.ts';
import { changesState, prepareRequest, requestHeaders } from './request.ts';
import { thrown } from './test-support.ts';

const byId = defineRoute({
  method: 'GET',
  path: '/api/things/:thingId',
  params: z.object({ thingId: z.union([z.string(), z.number()]) }),
  responses: { 200: z.object({}) },
});

const nested = defineRoute({
  method: 'GET',
  path: '/api/orgs/:orgId/repos/:repoId',
  params: z.object({ orgId: z.number(), repoId: z.number() }),
  query: z.object({ page: z.number().optional(), q: z.string().optional() }),
  responses: { 200: z.object({}) },
});

/** The URL the client would request for a path parameter, or the ContractError it would throw. */
function urlFor(thingId: string | number): string {
  return prepareRequest(byId, { params: { thingId } }).url;
}

test.each([
  ['a plain id', 'abc', '/api/things/abc'],
  ['a number', 42, '/api/things/42'],
  ['a slash, a question mark and a hash', 'a/b?c#d', '/api/things/a%2Fb%3Fc%23d'],
  ['a backslash', String.raw`a\b`, '/api/things/a%5Cb'],
  ['a percent escape that must stay text', '%2e%2e', '/api/things/%252e%252e'],
  ['a space and a plus', 'a b+c', '/api/things/a%20b%2Bc'],
  ['a NUL and a newline', 'a\u0000b\nc', '/api/things/a%00b%0Ac'],
  ['text with non-ASCII letters', 'Zoë 日本', '/api/things/Zo%C3%AB%20%E6%97%A5%E6%9C%AC'],
  ['dots that are not a whole segment', 'a..b', '/api/things/a..b'],
  ['three dots', '...', '/api/things/...'],
  ['a long hostile string', '../'.repeat(100), `/api/things/${'..%2F'.repeat(100)}`],
])('the path parameter %s is one encoded segment', (_what, value, expected) => {
  expect(urlFor(value)).toBe(expected);
});

test.each([
  ['an empty string', ''],
  ['a single dot', '.'],
  ['a double dot', '..'],
  ['not a number', Number.NaN],
  ['infinite', Number.POSITIVE_INFINITY],
])('the path parameter %s is refused: a URL parser would resolve it away from the route', (_what, value) => {
  const attempt = () => urlFor(value);
  expect(attempt).toThrow(ContractError);
  expect(attempt).toThrow(/params of GET \/api\/things\/:thingId/);
});

test('a path parameter the schema refuses is a ContractError that names the parameter and not the value', () => {
  const failure = thrown(() => prepareRequest(nested, { params: { orgId: 'secret-value', repoId: 1 } }));
  expect(failure).toBeInstanceOf(ContractError);
  expect(failure).toMatchObject({ part: 'params', paths: ['orgId'] });
  expect(String(failure)).not.toContain('secret-value');
});

test('several placeholders are all filled, and the query follows the path', () => {
  expect(prepareRequest(nested, { params: { orgId: 7, repoId: 9 }, query: { page: 2, q: 'a&b' } }).url).toBe(
    '/api/orgs/7/repos/9?page=2&q=a%26b',
  );
});

test('a route with no params keeps its path, and one with no body has no body', () => {
  const bare = defineRoute({ method: 'GET', path: '/api/things', responses: { 200: z.object({}) } });
  expect(prepareRequest(bare, {})).toEqual({ url: '/api/things', body: undefined });
});

test('a body is serialised after the schema has parsed it, so what the schema strips is not sent', () => {
  const route = defineRoute({
    method: 'POST',
    path: '/api/things',
    body: z.object({ name: z.string() }),
    responses: { 204: z.undefined() },
  });
  expect(prepareRequest(route, { body: { name: 'x', extra: 'dropped' } }).body).toBe('{"name":"x"}');
});

test.each([
  ['GET', false],
  ['HEAD', false],
  ['POST', true],
  ['PUT', true],
  ['PATCH', true],
  ['DELETE', true],
] as const)('%s changes state: %s', (method, expected) => {
  expect(changesState(method)).toBe(expected);
});

test('the headers are accept, a content type only with a body, and the token only for a call that changes state', () => {
  const post = defineRoute({ method: 'POST', path: '/api/a', body: z.object({}), responses: { 204: z.undefined() } });
  const withBody = { url: '/api/a', body: '{}' };
  const noBody = { url: '/api/a', body: undefined };
  expect(requestHeaders(post, withBody, 'tok')).toEqual({
    accept: 'application/json',
    'content-type': 'application/json',
    'x-csrf-token': 'tok',
  });
  expect(requestHeaders(post, noBody, 'tok')).toEqual({ accept: 'application/json', 'x-csrf-token': 'tok' });
  expect(requestHeaders(post, noBody, undefined)).toEqual({ accept: 'application/json' });
  expect(requestHeaders(byId, noBody, 'tok')).toEqual({ accept: 'application/json' });
});
