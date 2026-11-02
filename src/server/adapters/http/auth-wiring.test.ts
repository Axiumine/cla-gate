// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { AUTH_ENV, TEST_SESSION_SECRET } from '../../config/auth-fixture/test-support.ts';
import { testApp } from '../../test-support.ts';
import { authWorld, COOKIE_NAME } from './auth-fixture/test-support.ts';

// How the session cookie is wired into the app (E10-S02): only when login is configured, and read in one place.

const SERVER = path.resolve(import.meta.dirname, '../..');

test.each([
  ['no login setting at all', {}],
  ['only the session secret', { SESSION_SECRET: AUTH_ENV['SESSION_SECRET'] ?? '' }],
  ['the client id and secret but no session secret', { ...AUTH_ENV, SESSION_SECRET: '' }],
])('with %s there is no /api/auth/session route, whatever cookie arrives', async (_label, env) => {
  const { app } = await testApp({ env });
  const response = await app.inject({
    url: '/api/auth/session',
    headers: { cookie: `${COOKIE_NAME}=${'B'.repeat(43)}` },
  });
  expect(response.statusCode).toBe(404);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('not_found');
  expect(response.headers['set-cookie']).toBeUndefined();
});

test('the cookie plugin signs with the session secret, and no secret or session id reaches the log', async () => {
  const { app, logs, login } = await authWorld();
  const alice = await login(1001);
  expect(app.unsignCookie(app.signCookie('value')).valid).toBe(true);
  await app.inject({ url: '/api/auth/session', headers: { cookie: alice.cookie } });
  await app.inject({ url: '/api/auth/session', headers: { cookie: `${COOKIE_NAME}=${'B'.repeat(43)}` } });
  expect(logs.text()).not.toContain(alice.id);
  expect(logs.text()).not.toContain(alice.csrfSecret);
  expect(logs.text()).not.toContain('B'.repeat(43));
  expect(logs.text()).not.toContain(TEST_SESSION_SECRET);
});

/** Every non-test source file below `directory`, as a path relative to the server folder. */
function sourceFiles(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: walks the server source folder, a directory derived from this file's own location
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && entry.name !== 'test-support.ts'
      ? [path.relative(SERVER, full)]
      : [];
  });
}

test('only session-cookie.ts names the session cookie, so only setSessionCookie and clearSessionCookie write it', () => {
  const naming = sourceFiles(SERVER).filter((file) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: a file just listed from the server folder
    return /__Host-cla_session|cla_session/.test(readFileSync(path.join(SERVER, file), 'utf8'));
  });
  expect(naming).toEqual([path.join('adapters', 'http', 'session-cookie.ts')]);
});
