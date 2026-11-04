// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { TEST_SETUP_TOKEN } from '../../config/test-support.ts';
import { FakeClock } from '../../services/test-support.ts';
import { postUnlock, SETUP_ORIGIN, setupApp } from './setup-fixture/test-support.ts';

// E19-S06: the unlock opens the session, so it asks for no cookie and no CSRF token, and a caller that sends no `Origin` (a
// script, `curl`) is let through. A browser always sends one on a cross-site `POST`, and one that is not this instance's own
// is refused before anything else: a page of another site must not be able to submit unlock attempts from visitors'
// browsers, which would spread the guesses over many addresses and past the limit per address.

test('an unlock from the origin of the instance is the unlock', async () => {
  const { app } = await setupApp();
  const response = await postUnlock(app, TEST_SETUP_TOKEN, undefined, { origin: SETUP_ORIGIN });
  expect(response.statusCode).toBe(200);
  expect(response.cookies).toHaveLength(1);
});

test.each([
  ['another site', 'https://evil.example'],
  ['the host of the instance over http', 'http://cla.example.org'],
  ['the host of the instance on another port', 'https://cla.example.org:8443'],
  ['a sub-domain of the host', 'https://evil.cla.example.org'],
  ['the origin with a slash after it', `${SETUP_ORIGIN}/`],
  ['the origin in upper case', SETUP_ORIGIN.toUpperCase()],
  ['null, as a sandboxed page sends it', 'null'],
  ['an empty value', ''],
])(
  'an unlock from %s is 403 origin_mismatch, with the right token as well, and opens nothing',
  async (_what, origin) => {
    const { app } = await setupApp();
    const response = await postUnlock(app, TEST_SETUP_TOKEN, undefined, { origin });
    expect(response.statusCode).toBe(403);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('origin_mismatch');
    expect(response.headers['set-cookie']).toBeUndefined();
  },
);

test('the Origin is checked before the body is read: a body that is not {token} from another site is 403, from our own page 400', async () => {
  const { app } = await setupApp();
  const post = (origin: string) =>
    app.inject({ method: 'POST', url: '/api/setup/unlock', headers: { origin }, payload: { token: 7 } });
  expect((await post('https://evil.example')).statusCode).toBe(403);
  expect((await post(SETUP_ORIGIN)).statusCode).toBe(400);
});

test('a refused Origin counts for nothing: a hundred of them leave the address free to unlock, and no wrong token is counted', async () => {
  const clock = new FakeClock('2026-11-03T09:00:00.000Z');
  const { app } = await setupApp({ clock });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    expect((await postUnlock(app, 'wrong', '203.0.113.7', { origin: 'https://evil.example' })).statusCode).toBe(403);
  }
  expect((await postUnlock(app, TEST_SETUP_TOKEN, '203.0.113.7')).statusCode).toBe(200);
});

test('a refused Origin does not tell a held-back address from any other: it is 403 and not 429', async () => {
  const { app } = await setupApp();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await postUnlock(app, 'wrong', '203.0.113.7');
  }
  expect((await postUnlock(app, 'wrong', '203.0.113.7')).statusCode).toBe(429);
  expect((await postUnlock(app, 'wrong', '203.0.113.7', { origin: 'https://evil.example' })).statusCode).toBe(403);
});
