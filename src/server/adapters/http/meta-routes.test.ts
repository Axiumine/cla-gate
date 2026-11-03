// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { DEFAULT_SOURCE_URL, META_CACHE_CONTROL, metaResponseSchema } from '../../../shared/meta.ts';
import { AUTH_ENV } from '../../config/auth-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';
import { createPgDatabase } from '../db/pg.ts';

// E17-S09: GET /api/meta, public, no session: where the source of the running version is and where the App is installed.

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const unreachable = () => createPgDatabase({ connectionString: 'postgres://user:pw@127.0.0.1:1/db', onError: vi.fn() });

test('by default it names the default repository, no commit and no install address', async () => {
  const { app } = await testApp();
  const response = await app.inject('/api/meta');
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toContain('application/json');
  expect(metaResponseSchema.parse(response.json())).toEqual({
    sourceUrl: DEFAULT_SOURCE_URL,
    commit: null,
    installUrl: null,
  });
});

test('it carries the repository and the commit the instance was configured with', async () => {
  const { app } = await testApp({ env: { SOURCE_URL: 'https://git.example.test/org/cla', SOURCE_COMMIT: COMMIT } });
  const response = await app.inject('/api/meta');
  expect(response.json()).toEqual({ sourceUrl: 'https://git.example.test/org/cla', commit: COMMIT, installUrl: null });
});

test('the answer may be kept for five minutes by anyone, and the standard security headers are on it', async () => {
  const { app } = await testApp();
  const { headers } = await app.inject('/api/meta');
  expect(headers['cache-control']).toBe(META_CACHE_CONTROL);
  expect(headers['cache-control']).toBe('public, max-age=300');
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['access-control-allow-origin']).toBeUndefined();
});

test('it needs no session and does not look for one: it answers while the database is down, with or without a cookie', async () => {
  const { app } = await testApp({ db: unreachable(), env: AUTH_ENV });
  const cookie = `__Host-cla_session=${'B'.repeat(43)}`;
  for (const headers of [{}, { cookie }, { cookie: 'garbage' }]) {
    const response = await app.inject({ url: '/api/meta', headers });
    expect([response.statusCode, response.headers['set-cookie']]).toEqual([200, undefined]);
  }
});

test('the install address is built from the slug of the verified App, and null before there is one', async () => {
  // The slug is known after the server is up: the check of the App can succeed later than the listen.
  const verified: { slug: string }[] = [];
  const { app } = await testApp({ appIdentity: { current: () => verified.at(-1) } });
  expect((await app.inject('/api/meta')).json()).toMatchObject({ installUrl: null });
  verified.push({ slug: 'cla-gate-test' });
  expect((await app.inject('/api/meta')).json()).toMatchObject({
    installUrl: 'https://github.com/apps/cla-gate-test/installations/new',
  });
});

test.each([[''], ['Not_A_Slug'], ['a/b'], ['x?y=1']])('a slug of %j makes no install address', async (slug) => {
  const { app } = await testApp({ appIdentity: { current: () => ({ slug }) } });
  expect((await app.inject('/api/meta')).json()).toMatchObject({ installUrl: null });
});

test('it only reads: a POST is not a route, and a HEAD has the headers and no body', async () => {
  const { app } = await testApp();
  expect((await app.inject({ method: 'POST', url: '/api/meta' })).statusCode).toBe(404);
  const head = await app.inject({ method: 'HEAD', url: '/api/meta' });
  expect([head.statusCode, head.body, head.headers['cache-control']]).toEqual([200, '', META_CACHE_CONTROL]);
});
