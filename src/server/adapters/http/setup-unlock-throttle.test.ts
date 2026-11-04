// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { TEST_SETUP_TOKEN } from '../../config/test-support.ts';
import { FakeClock } from '../../services/test-support.ts';
import { postManifest, postUnlock, setupApp, unlockSetup } from './setup-fixture/test-support.ts';

// E19-S06: wrong tokens are limited to 5 per minute per client address and 30 per ten minutes for the server; past the limit
// the answer is 429 with Retry-After, the right token included, until the oldest failure has left the window. The clock is
// moved by hand.

const SECOND = 1000;
const ME = '203.0.113.7';
const OTHER = '203.0.113.8';

async function clockedApp() {
  const clock = new FakeClock('2026-11-03T09:00:00.000Z');
  const { app } = await setupApp({ clock });
  return { clock, app };
}

test('five wrong tokens are 401, the sixth attempt is 429 with Retry-After, and so is the right token', async () => {
  const { app } = await clockedApp();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    expect((await postUnlock(app, 'wrong', ME)).statusCode).toBe(401);
  }
  const held = await postUnlock(app, 'wrong', ME);
  expect(held.statusCode).toBe(429);
  expect(held.headers['retry-after']).toBe('60');
  expect(errorResponseSchema.parse(held.json()).error.code).toBe('too_many_requests');
  const right = await postUnlock(app, TEST_SETUP_TOKEN, ME);
  expect(right.statusCode).toBe(429);
  expect(right.headers['set-cookie']).toBeUndefined();
});

test('Retry-After counts down, and the address may try again when the oldest failure has left the minute', async () => {
  const { clock, app } = await clockedApp();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await postUnlock(app, 'wrong', ME);
  }
  clock.advance(45 * SECOND);
  expect((await postUnlock(app, TEST_SETUP_TOKEN, ME)).headers['retry-after']).toBe('15');
  clock.advance(15 * SECOND);
  expect((await postUnlock(app, TEST_SETUP_TOKEN, ME)).statusCode).toBe(200);
});

test('another address is not held back by the failures of this one', async () => {
  const { app } = await clockedApp();
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await postUnlock(app, 'wrong', ME);
  }
  expect((await postUnlock(app, TEST_SETUP_TOKEN, OTHER)).statusCode).toBe(200);
});

test('a held-back address cannot use a session it already has: that is not an unlock', async () => {
  const { app } = await clockedApp();
  const unlocked = await unlockSetup(app, ME);
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await postUnlock(app, 'wrong', ME);
  }
  expect((await postManifest(app, unlocked)).statusCode).toBe(200);
});

test('thirty failures from thirty addresses hold the whole server back for ten minutes', async () => {
  const { clock, app } = await clockedApp();
  for (let address = 1; address <= 30; address += 1) {
    expect((await postUnlock(app, 'wrong', `198.51.100.${address}`)).statusCode).toBe(401);
  }
  const held = await postUnlock(app, TEST_SETUP_TOKEN, '192.0.2.50');
  expect(held.statusCode).toBe(429);
  expect(held.headers['retry-after']).toBe('600');
  clock.advance(600 * SECOND);
  expect((await postUnlock(app, TEST_SETUP_TOKEN, '192.0.2.50')).statusCode).toBe(200);
});

test('a request that is not a guess is not counted: bad bodies and right tokens leave the budget alone', async () => {
  const { app } = await clockedApp();
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    expect(
      (await app.inject({ method: 'POST', url: '/api/setup/unlock', payload: {}, remoteAddress: ME })).statusCode,
    ).toBe(400);
    expect((await postUnlock(app, TEST_SETUP_TOKEN, ME)).statusCode).toBe(200);
  }
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    expect((await postUnlock(app, 'wrong', ME)).statusCode).toBe(401);
  }
});

test('a held-back attempt is not counted again: waiting out the minute is enough', async () => {
  const { clock, app } = await clockedApp();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await postUnlock(app, 'wrong', ME);
  }
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    expect((await postUnlock(app, 'wrong', ME)).statusCode).toBe(429);
  }
  clock.advance(60 * SECOND);
  expect((await postUnlock(app, TEST_SETUP_TOKEN, ME)).statusCode).toBe(200);
});
