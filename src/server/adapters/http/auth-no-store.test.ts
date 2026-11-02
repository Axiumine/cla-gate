// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { freePort, sendRaw } from '../../test-support.ts';
import { authWorld } from './auth-fixture/test-support.ts';
import { isAuthUrl } from './auth-no-store.ts';

// The `no-store` header of `/api/auth` (E10-S02) for the targets that a client can spell in more ways than origin-form:
// absolute-form, percent escapes, a query string or a fragment. Over-inclusion is harmless, a missing header is not.

test.each([
  ['the path alone', '/api/auth'],
  ['a route below it', '/api/auth/session'],
  ['a query string', '/api/auth?next=/'],
  ['a fragment', '/api/auth#x'],
  ['a query string below a route', '/api/auth/session?x=1'],
  ['an absolute-form target', 'http://127.0.0.1/api/auth/nope'],
  [
    'an absolute-form target with a port, a query string and a fragment',
    'https://example.test:8443/api/auth/nope?x=1#y',
  ],
  ['an absolute-form target with an upper-case scheme', 'HTTP://example.test/api/auth/nope'],
  ['an escaped letter', '/api/%61uth/nope'],
  ['an escaped letter in lower case hex', '/api/%61uth'],
  ['an escaped slash', '/api%2Fauth/nope'],
  ['an escaped slash after the path, decoded on purpose', '/api/auth%2Fnope'],
  ['an escaped letter beside an invalid escape', '/api/%61uth/%zz'],
  ['an invalid escape below it', '/api/auth/%ZZ'],
  ['an absolute-form target with an escape', 'http://127.0.0.1/api/%61uth/nope'],
])('%s is under /api/auth', (_label, url) => {
  expect(isAuthUrl(url)).toBe(true);
});

test.each([
  ['the root', '/'],
  ['a sibling that shares the prefix', '/api/authors'],
  ['a sibling with a query string', '/api/authors?x=/api/auth'],
  ['the path only in a query string', '/healthz?next=/api/auth'],
  ['the path only in a fragment', '/healthz#/api/auth/session'],
  ['the path only in the authority of an absolute-form target', 'http://example.test/healthz?/api/auth'],
  ['an upper-case path, which no route answers', '/API/AUTH/session'],
  ['an escape that does not decode to the path', '/api/%62uth/nope'],
  ['an empty target', ''],
])('%s is not under /api/auth', (_label, url) => {
  expect(isAuthUrl(url)).toBe(false);
});

/** A request line as a raw client writes it: the target is sent exactly as given. */
const rawGet = (target: string) => `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`;

test.each([
  ['an absolute-form target no route answers', 'http://127.0.0.1/api/auth/nope', 404],
  ['an absolute-form target with an invalid escape', 'http://127.0.0.1/api/auth/%ZZ', 400],
  ['a route spelled with an escape that no route answers', '/api/%61uth/nope', 404],
  ['an absolute-form target with an escape that no route answers', 'http://127.0.0.1/api/%61uth/nope', 404],
  ['an absolute-form target with a fragment, which the router refuses', 'http://127.0.0.1/api/auth/session#frag', 400],
  ['an absolute-form target that a route answers', 'http://127.0.0.1/api/auth/session', 401],
])('%s carries Cache-Control: no-store on the wire', async (_label, target, status) => {
  const { app } = await authWorld();
  const address = await app.listen({ host: '127.0.0.1', port: await freePort() });
  const response = await sendRaw(address, rawGet(target));
  expect([response.statusLine, response.headers['cache-control']]).toEqual([
    expect.stringContaining(`${status} `),
    'no-store',
  ]);
});

test.each([
  ['an absolute-form target outside /api/auth', 'http://127.0.0.1/api/authors', 404],
  ['an absolute-form target with an invalid escape outside /api/auth', 'http://127.0.0.1/healthz/%ZZ', 400],
  ['the path only in the query string of an absolute-form target', 'http://127.0.0.1/healthz?/api/auth', 200],
])('%s is not marked no-store', async (_label, target, status) => {
  const { app } = await authWorld();
  const address = await app.listen({ host: '127.0.0.1', port: await freePort() });
  const response = await sendRaw(address, rawGet(target));
  expect(response.statusLine).toContain(`${status} `);
  expect(response.headers['cache-control']).toBeUndefined();
});
