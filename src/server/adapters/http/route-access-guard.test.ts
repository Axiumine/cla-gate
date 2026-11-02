// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { authWorld, COOKIE_NAME } from './auth-fixture/test-support.ts';
import { tenantAccess } from './tenant-access.ts';

// What the access declaration does to a request (E11-S01): `public` and `webhook` routes are left alone, an `authenticated`
// route answers 401 without a live session (through requireAuth of E10) before anything else is looked up, a `tenant` route
// whose resolver names nothing and an `operator` route of an instance that has no operator let nobody through. The guard of
// a tenant route is tested in tenant-guard.test.ts and the one of an operator route in operator-guard.test.ts.

const CLEARED = `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;

/** The real app with one route of each kind, each recording that its handler ran. */
async function world() {
  const base = await authWorld();
  const { app } = base;
  const reached: string[] = [];
  const handler = (name: string) => () => {
    reached.push(name);
    return { name };
  };
  app.get('/t/public', { config: { access: 'public' } }, handler('public'));
  app.get('/t/authenticated', { config: { access: 'authenticated' } }, handler('authenticated'));
  app.post('/t/authenticated', { config: { access: 'authenticated' } }, handler('authenticated-post'));
  app.get('/t/operator', { config: { access: 'operator' } }, handler('operator'));
  const nothing = () => Promise.resolve(null);
  app.get(
    '/t/tenant/:installationId',
    { config: { access: tenantAccess({ mode: 'read', resolve: nothing }) } },
    handler('tenant'),
  );
  app.post(
    '/t/tenant/:installationId',
    { config: { access: tenantAccess({ mode: 'write', resolve: nothing }) } },
    handler('tenant-post'),
  );
  return { ...base, reached };
}

test('an authenticated route answers 401 unauthorized with the standard body to a request with no session, and no handler runs', async () => {
  const { app, reached, queries } = await world();
  await app.ready();
  const before = queries.length;
  const response = await app.inject('/t/authenticated');
  expect(response.statusCode).toBe(401);
  const { error } = errorResponseSchema.parse(response.json());
  expect([error.code, error.message, error.requestId]).toEqual([
    'unauthorized',
    'Unauthorized',
    response.headers['x-request-id'],
  ]);
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(reached).toEqual([]);
  expect(queries).toHaveLength(before);
});

test('an authenticated route answers a caller with a live session', async () => {
  const { app, login, reached } = await world();
  const alice = await login(1001);
  const response = await app.inject({ url: '/t/authenticated', headers: { cookie: alice.cookie } });
  expect([response.statusCode, response.json()]).toEqual([200, { name: 'authenticated' }]);
  expect(reached).toEqual(['authenticated']);
});

test('the HEAD request of an authenticated route needs the session too', async () => {
  const { app, login } = await world();
  const alice = await login(1001);
  expect((await app.inject({ method: 'HEAD', url: '/t/authenticated' })).statusCode).toBe(401);
  expect(
    (await app.inject({ method: 'HEAD', url: '/t/authenticated', headers: { cookie: alice.cookie } })).statusCode,
  ).toBe(200);
});

test.each([
  ['a cookie with a well-formed id that no session has', `${COOKIE_NAME}=${'A'.repeat(43)}`],
  ['a cookie that cannot be a session id', `${COOKIE_NAME}=short`],
])('%s gets 401 from an authenticated route and the dead cookie is cleared', async (_name, cookie) => {
  const { app, reached } = await world();
  const response = await app.inject({ url: '/t/authenticated', headers: { cookie } });
  expect(response.statusCode).toBe(401);
  expect(response.headers['set-cookie']).toBe(CLEARED);
  expect(reached).toEqual([]);
});

test('a session that expired gets 401 from an authenticated route and its cookie is cleared', async () => {
  const { app, advance, login, reached } = await world();
  const alice = await login(1001);
  advance(8 * 3600);
  const response = await app.inject({ url: '/t/authenticated', headers: { cookie: alice.cookie } });
  expect([response.statusCode, response.headers['set-cookie']]).toEqual([401, CLEARED]);
  expect(reached).toEqual([]);
});

test('a public route is left alone whatever the request carries, and never clears a cookie', async () => {
  const { app, login, reached } = await world();
  const alice = await login(1001);
  const dead = { cookie: `${COOKIE_NAME}=${'A'.repeat(43)}` };
  const answers = [
    await app.inject('/t/public'),
    await app.inject({ url: '/t/public', headers: { cookie: alice.cookie } }),
    await app.inject({ url: '/t/public', headers: dead }),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([200, 200, 200]);
  expect(answers.map((answer) => answer.headers['set-cookie'])).toEqual([undefined, undefined, undefined]);
  expect(reached).toEqual(['public', 'public', 'public']);
});

test('a state-changing request to an authenticated route meets Origin first, then the session, then the token, then the route', async () => {
  const { app, login, origin, reached } = await world();
  const alice = await login(1001);
  const post = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/t/authenticated', headers });
  const codes = (response: Awaited<ReturnType<typeof post>>) => errorResponseSchema.parse(response.json()).error.code;
  expect(codes(await post({}))).toBe('origin_not_allowed');
  expect(codes(await post({ origin }))).toBe('unauthorized');
  expect(codes(await post({ origin, cookie: alice.cookie }))).toBe('csrf_invalid');
  expect(reached).toEqual([]);
  const served = await post(alice.headers);
  expect([served.statusCode, served.json()]).toEqual([200, { name: 'authenticated-post' }]);
});

test('a request that no route answers is a 404, not a 401: the guard has nothing to act on', async () => {
  const { app } = await world();
  const response = await app.inject('/t/nothing-here');
  expect(response.statusCode).toBe(404);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('not_found');
});

/** A response without what is per request: its status, its content type and its body but for the request id. */
function shape(response: { statusCode: number; headers: Record<string, unknown>; json: () => unknown }) {
  const { error } = errorResponseSchema.parse(response.json());
  return { status: response.statusCode, type: response.headers['content-type'], error: { ...error, requestId: '' } };
}

test.each([
  ['a tenant read route whose resolver names nothing', 'GET', '/t/tenant/7'],
  ['a tenant write route whose resolver names nothing', 'POST', '/t/tenant/7'],
  ['an operator route of an instance with no operator', 'GET', '/t/operator'],
])(
  '%s refuses a caller with no session by 401, and one with a session by the 404 of a route that does not exist',
  async (_name, method, url) => {
    const { app, login, reached } = await world();
    const alice = await login(1001);
    const anonymous = await app.inject({ method, url });
    const signedIn = await app.inject({ method, url, headers: alice.headers });
    const unknown = await app.inject({ method, url: '/t/no-such-route', headers: alice.headers });
    // The POST without Origin is refused by the CSRF check first, as for every state-changing request.
    expect(anonymous.statusCode).toBe(method === 'POST' ? 403 : 401);
    expect(shape(signedIn)).toEqual(shape(unknown));
    expect(shape(signedIn).status).toBe(404);
    expect(reached).toEqual([]);
  },
);

test('an operator or tenant route answers a caller with no session 401, with the same body as an authenticated one', async () => {
  const { app } = await world();
  const bodies = await Promise.all(
    ['/t/authenticated', '/t/operator', '/t/tenant/7'].map(async (url) => shape(await app.inject(url))),
  );
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[2]).toEqual(bodies[0]);
  expect(bodies[0]?.error.code).toBe('unauthorized');
});
