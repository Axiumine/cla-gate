// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  type CallInput,
  defineRoute,
  fillPath,
  pathParamNames,
  responseSchemaFor,
  type SuccessOf,
} from './contract.ts';

const thing = z.object({ id: z.string(), size: z.number() });

test('a route keeps its spec and gets a name made of the method and the path template', () => {
  const route = defineRoute({
    method: 'GET',
    path: '/api/things/:thingId',
    params: z.object({ thingId: z.string() }),
    responses: { 200: thing },
  });
  expect(route.name).toBe('GET /api/things/:thingId');
  expect(route.method).toBe('GET');
  expect(route.path).toBe('/api/things/:thingId');
  expect(responseSchemaFor(route, 200)).toBe(thing);
  expectTypeOf(route.name).toEqualTypeOf<'GET /api/things/:thingId'>();
});

test('a descriptor is frozen, so no module can change a route that others call', () => {
  const route = defineRoute({ method: 'GET', path: '/api/things', responses: { 200: thing } });
  expect(Object.isFrozen(route)).toBe(true);
});

test.each([
  ['a path with no leading slash', 'api/things'],
  ['the root path', '/'],
  ['a trailing slash', '/api/things/'],
  ['an empty segment', '/api//things'],
  ['a query string', '/api/things?x=1'],
  ['a fragment', '/api/things#top'],
  ['a dot segment', '/api/./things'],
  ['a double dot segment', '/api/../things'],
  ['a space', '/api/my things'],
  ['a percent escape', '/api/%2e%2e/things'],
  ['a placeholder that starts with a digit', '/api/things/:1id'],
  ['a wildcard', '/api/things/*'],
  ['an absolute URL', 'https://evil.example/api'],
])('a path with %s is refused when the route is defined', (_what, path) => {
  expect(() => defineRoute({ method: 'GET', path, responses: { 200: thing } })).toThrow(RangeError);
});

test.each([
  ['plain segments', '/api/things'],
  ['one placeholder', '/api/things/:thingId'],
  ['two placeholders', '/api/orgs/:orgId/repos/:repoId'],
  ['a segment with dots, dashes and a tilde', '/api/v1.2/my-things_x~y'],
])('a path with %s is accepted', (_what, path) => {
  const params = pathParamNames(path);
  const shape = Object.fromEntries(params.map((name) => [name, z.string()]));
  expect(() =>
    defineRoute({
      method: 'GET',
      path,
      ...(params.length === 0 ? {} : { params: z.object(shape) }),
      responses: { 200: thing },
    }),
  ).not.toThrow();
});

test.each([
  ['params missing for a placeholder', '/api/things/:thingId', undefined],
  ['params for a path with no placeholder', '/api/things', z.object({ thingId: z.string() })],
  ['params that name another placeholder', '/api/things/:thingId', z.object({ id: z.string() })],
  [
    'params that name more than the placeholders',
    '/api/things/:thingId',
    z.object({ thingId: z.string(), extra: z.string() }),
  ],
])('%s is refused: the params are exactly the placeholders', (_what, path, params) => {
  const spec = { method: 'GET', path, responses: { 200: thing } } as const;
  expect(() => defineRoute(params === undefined ? spec : { ...spec, params })).toThrow(
    /params must name exactly the placeholders/,
  );
});

test.each([
  ['no response at all', {}],
  ['only an error response', { 404: thing }],
  ['a status below 200', { 100: thing, 404: thing }],
  ['a status above 599', { 200: thing, 600: thing }],
  ['a status that is not an integer', { 200: thing, '201.5': thing }],
  ['a status that is not a number', { 200: thing, ok: thing }],
])('responses with %s are refused', (_what, responses) => {
  expect(() => defineRoute({ method: 'GET', path: '/api/things', responses })).toThrow(RangeError);
});

test.each([['GET'], ['HEAD']] as const)('a %s route with a body is refused: fetch cannot send one', (method) => {
  expect(() => defineRoute({ method, path: '/api/things', body: z.object({}), responses: { 200: thing } })).toThrow(
    /carries no body/,
  );
});

test('several success statuses and error statuses can be declared together', () => {
  const route = defineRoute({
    method: 'POST',
    path: '/api/things',
    body: z.object({ size: z.number() }),
    responses: { 200: thing, 201: thing, 409: z.object({}) },
  });
  expect(responseSchemaFor(route, 201)).toBe(thing);
  expect(responseSchemaFor(route, 409)).toBeDefined();
  expect(responseSchemaFor(route, 404)).toBeUndefined();
});

test('pathParamNames lists the placeholders in order, and fillPath replaces each one by the segment it is given', () => {
  expect(pathParamNames('/api/orgs/:orgId/repos/:repoId/signers')).toEqual(['orgId', 'repoId']);
  expect(pathParamNames('/api/things')).toEqual([]);
  expect(fillPath('/api/orgs/:orgId/repos/:repoId', (name) => name.toUpperCase())).toBe('/api/orgs/ORGID/repos/REPOID');
  expect(fillPath('/api/things', () => 'never')).toBe('/api/things');
});

test('the input and the result of a call are typed from the schemas of the route', () => {
  const route = defineRoute({
    method: 'POST',
    path: '/api/things/:thingId',
    params: z.object({ thingId: z.string() }),
    query: z.object({ dry: z.boolean().optional() }),
    body: z.object({ size: z.number() }),
    responses: { 200: thing, 204: z.undefined() },
  });
  expect(route.method).toBe('POST');
  const full: CallInput<typeof route> = { params: { thingId: 'x' }, query: { dry: true }, body: { size: 1 } };
  // @ts-expect-error -- the test: a body that the schema does not accept is a type error
  const wrongBody: CallInput<typeof route> = { params: { thingId: 'x' }, query: {}, body: { size: 'big' } };
  // @ts-expect-error -- the test: a missing path parameter is a type error
  const noParams: CallInput<typeof route> = { query: {}, body: { size: 1 } };
  expect([full, wrongBody, noParams]).toHaveLength(3);
  expectTypeOf<SuccessOf<typeof route>>().toEqualTypeOf<{ id: string; size: number } | undefined>();
});

test('a route with nothing to send takes an empty input, and an optional body is an optional key', () => {
  const bare = defineRoute({ method: 'GET', path: '/api/things', responses: { 200: thing } });
  const optional = defineRoute({
    method: 'POST',
    path: '/api/things',
    body: z.object({ a: z.string() }).optional(),
    responses: { 204: z.undefined() },
  });
  expect([bare.method, optional.method]).toEqual(['GET', 'POST']);
  const nothing: CallInput<typeof bare> = {};
  // @ts-expect-error -- the test: a route that declares no body takes none
  const stray: CallInput<typeof bare> = { body: {} };
  const withBody: CallInput<typeof optional> = { body: { a: 'x' } };
  const withoutBody: CallInput<typeof optional> = {};
  expect([nothing, stray, withBody, withoutBody]).toHaveLength(4);
  expectTypeOf<SuccessOf<typeof optional>>().toEqualTypeOf<undefined>();
});
