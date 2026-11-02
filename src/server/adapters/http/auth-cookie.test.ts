// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { authWorld } from './auth-fixture/test-support.ts';

// The raw Set-Cookie header of the session cookie (E10-S02): the attributes are the security of the login, so the test
// reads the header itself and not a parsed view of it.

const SET_COOKIE = `__Host-cla_session=${'A'.repeat(43)}`;

test('setSessionCookie writes exactly the cookie of the story, with Max-Age the default absolute lifetime in seconds', async () => {
  const { app } = await authWorld();
  const response = await app.inject('/probe/set-cookie');
  expect(response.headers['set-cookie']).toBe(`${SET_COOKIE}; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax`);
});

test('Max-Age is the configured absolute lifetime, not the idle one', async () => {
  const { app } = await authWorld({ SESSION_IDLE_SECONDS: '600', SESSION_ABSOLUTE_SECONDS: '1234' });
  const response = await app.inject('/probe/set-cookie');
  expect(response.headers['set-cookie']).toBe(`${SET_COOKIE}; Max-Age=1234; Path=/; HttpOnly; Secure; SameSite=Lax`);
});

test('the cookie has no Domain, no Expires and no other attribute, and Secure and the prefix hold on plain http too', async () => {
  const { app } = await authWorld({ PUBLIC_BASE_URL: 'http://localhost:3000' });
  const header = (await app.inject('/probe/set-cookie')).headers['set-cookie'];
  const attributes = String(header)
    .split('; ')
    .map((part) => part.split('=')[0]);
  expect(attributes).toEqual(['__Host-cla_session', 'Max-Age', 'Path', 'HttpOnly', 'Secure', 'SameSite']);
});
