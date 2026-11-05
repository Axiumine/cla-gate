// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import { isAppPage } from './spa.ts';
import { INDEX_HTML, INDEX_MARKER, webApp } from './spa-fixture/test-support.ts';

// E17-S03: which requests that no route answers get index.html (a page of the app) and which get the 404 body.

const HTML = { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' };

test.each([
  ['a route of the app', '/signatures'],
  ['a deep route', '/orgs/42/repositories/7/documents'],
  ['a route with a query', '/signatures?page=2&q=a.b'],
  ['a route with a trailing slash', '/signatures/'],
  ['the sign page of a corporate CLA (E21-S02)', '/corporate/sign/9000'],
  ['the list of corporate agreements (E21-S02)', '/corporate/agreements?cursor=abc'],
  ['a route with a dot in a folder name... of the query only', '/search?file=a.json'],
  ['a route with an encoded character', '/orgs/ac%20me'],
  ['a path that only starts like a server path', '/apix/status'],
  ['another that does', '/healthzz'],
  ['the assets folder itself', '/assets'],
])('GET %s (%s) is answered with index.html and 200 to a browser', async (_what, url) => {
  const { app } = await webApp();
  const response = await app.inject({ url, headers: HTML });
  expect([response.statusCode, response.body]).toEqual([200, INDEX_HTML]);
  expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
  expect(response.headers['cache-control']).toBe('no-cache');
  expect(response.headers.etag).toBeDefined();
});

test('HEAD of a route of the app is the headers of index.html and no body', async () => {
  const { app } = await webApp();
  const response = await app.inject({ method: 'HEAD', url: '/signatures', headers: HTML });
  expect([response.statusCode, response.body]).toEqual([200, '']);
  expect(response.headers['content-length']).toBe(String(INDEX_HTML.length));
});

test('the fallback honours the ETag of index.html: a browser that has it gets 304', async () => {
  const { app } = await webApp();
  const first = await app.inject({ url: '/signatures', headers: HTML });
  const again = await app.inject({
    url: '/signatures',
    headers: { ...HTML, 'if-none-match': String(first.headers.etag) },
  });
  expect([again.statusCode, again.body]).toEqual([304, '']);
});

test.each([
  ['an unknown API path', '/api/nope', HTML],
  ['the API root', '/api', HTML],
  ['below the API root', '/api/auth/nope/deeper', HTML],
  ['the API in capitals', '/API/auth/session', HTML],
  ['the API spelled with an escape', '/%61pi/nope', HTML],
  ['the liveness probe with a trailing slash', '/healthz/', HTML],
  ['below the liveness probe', '/healthz/extra', HTML],
  ['the readiness probe with a trailing slash', '/readyz/', HTML],
  ['the webhook path', WEBHOOK_PATH, HTML],
  ['a missing script', '/assets/missing-1a2b3c.js', HTML],
  ['a missing file with an extension', '/no-such.png', HTML],
  ['a path with an extension in a folder', '/orgs/acme.json', HTML],
  ['a hidden file', '/.well-known', HTML],
  ['a file in a hidden folder', '/%2egit/HEAD', HTML],
  ['a client that does not ask for HTML', '/signatures', { accept: 'application/json' }],
  ['a client that sends no Accept header', '/signatures', {}],
  ['a client that accepts anything', '/signatures', { accept: '*/*' }],
])('GET %s (%s) is the standard 404 body, never HTML', async (_what, url, headers) => {
  const { app } = await webApp();
  const response = await app.inject({ url, headers });
  expect(response.statusCode).toBe(404);
  expect(response.headers['content-type']).toMatch(/^application\/json/);
  expect(response.body).not.toContain(INDEX_MARKER);
  expect(errorResponseSchema.parse(response.json()).error).toEqual({
    code: 'not_found',
    message: 'Not Found',
    requestId: response.headers['x-request-id'],
  });
});

test.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const)(
  '%s of a route of the app is the standard 404 body, not index.html',
  async (method) => {
    const { app } = await webApp();
    const response = await app.inject({ method, url: '/signatures', headers: HTML });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(INDEX_MARKER);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('not_found');
  },
);

test('a POST to an unknown API path is the 404 body too, with a JSON body and no session', async () => {
  const { app } = await webApp();
  const response = await app.inject({ method: 'POST', url: '/api/nope', payload: { a: 1 }, headers: HTML });
  expect(response.statusCode).toBe(404);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('not_found');
});

test.each([
  ['a page', { url: '/a', method: 'GET', headers: HTML }, true],
  ['a HEAD page', { url: '/a', method: 'HEAD', headers: HTML }, true],
  ['a page asked for in capitals', { url: '/a', method: 'GET', headers: { accept: 'TEXT/HTML' } }, true],
  ['a POST', { url: '/a', method: 'POST', headers: HTML }, false],
  ['no Accept', { url: '/a', method: 'GET', headers: {} }, false],
  ['an escape that cannot be decoded', { url: '/%E0%A4%A', method: 'GET', headers: HTML }, false],
])('isAppPage says of %s: %j', (_what, request, page) => {
  expect(isAppPage(request)).toBe(page);
});
