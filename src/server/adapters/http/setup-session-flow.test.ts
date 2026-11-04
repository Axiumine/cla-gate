// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { FakeClock } from '../../services/test-support.ts';
import { postManifest, setupApp, unlockSetup } from './setup-fixture/test-support.ts';

// E19-S06: the setup session lives in memory, for 30 minutes of idle time, and at most three are alive at once. A request
// that passes the checks starts the idle time over; one that fails them does not.

const MINUTE = 60_000;
const IDLE = 30 * MINUTE;

/** The app in setup mode on a clock that stands still until the test moves it. */
async function clockedApp() {
  const clock = new FakeClock('2026-11-03T09:00:00.000Z');
  const { app } = await setupApp({ clock });
  return { clock, app };
}

/** The status and code of a refused request. */
async function outcome(response: ReturnType<typeof postManifest>): Promise<[number, string | undefined]> {
  const settled = await response;
  return [
    settled.statusCode,
    settled.statusCode === 200 ? undefined : errorResponseSchema.parse(settled.json()).error.code,
  ];
}

test('a session is alive for exactly 30 minutes without a request, and gone one millisecond later', async () => {
  const { clock, app: server } = await clockedApp();
  const unlocked = await unlockSetup(server);
  clock.advance(IDLE);
  expect((await postManifest(server, unlocked)).statusCode).toBe(200);
  clock.advance(IDLE + 1);
  expect(await outcome(postManifest(server, unlocked))).toEqual([401, 'setup_locked']);
});

test('a session that was idle for more than 30 minutes since the unlock answers 401 setup_locked', async () => {
  const { clock, app: server } = await clockedApp();
  const unlocked = await unlockSetup(server);
  clock.advance(IDLE + 1);
  expect(await outcome(postManifest(server, unlocked))).toEqual([401, 'setup_locked']);
});

test('every request that passes starts the idle time over, so a session that is used stays alive', async () => {
  const { clock, app: server } = await clockedApp();
  const unlocked = await unlockSetup(server);
  for (let round = 0; round < 3; round += 1) {
    clock.advance(29 * MINUTE);
    expect((await postManifest(server, unlocked)).statusCode).toBe(200);
  }
});

test('a request that fails the CSRF or Origin check does not start the idle time over', async () => {
  const { clock, app: server } = await clockedApp();
  const unlocked = await unlockSetup(server);
  clock.advance(20 * MINUTE);
  expect((await postManifest(server, unlocked, { csrfToken: 'wrong' })).statusCode).toBe(403);
  expect((await postManifest(server, unlocked, { origin: 'https://evil.example' })).statusCode).toBe(403);
  clock.advance(11 * MINUTE);
  expect(await outcome(postManifest(server, unlocked))).toEqual([401, 'setup_locked']);
});

test('a passing request sets the cookie again, so the browser keeps it as long as the server does', async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const response = await postManifest(app, unlocked);
  const [cookie] = response.cookies;
  expect(`${cookie?.name}=${cookie?.value}`).toBe(unlocked.cookie);
  expect(cookie?.maxAge).toBe(1800);
});

test('at most three sessions are alive: the fourth unlock ends the one that was used longest ago', async () => {
  const { app } = await setupApp();
  const [first, second, third] = [await unlockSetup(app), await unlockSetup(app), await unlockSetup(app)];
  expect((await postManifest(app, first)).statusCode).toBe(200);
  const fourth = await unlockSetup(app);
  // The first was used after the others were opened, so the second is the one that went.
  expect(await outcome(postManifest(app, second))).toEqual([401, 'setup_locked']);
  for (const alive of [first, third, fourth]) {
    expect((await postManifest(app, alive)).statusCode).toBe(200);
  }
});

test('without a request in between, the fourth unlock ends the first session', async () => {
  const { app } = await setupApp();
  const [first, second, third, fourth] = [
    await unlockSetup(app),
    await unlockSetup(app),
    await unlockSetup(app),
    await unlockSetup(app),
  ];
  expect(await outcome(postManifest(app, first))).toEqual([401, 'setup_locked']);
  for (const alive of [second, third, fourth]) {
    expect((await postManifest(app, alive)).statusCode).toBe(200);
  }
});

test('sessions that went idle make room: three idle ones do not count against a new unlock', async () => {
  const { clock, app: server } = await clockedApp();
  const old = [await unlockSetup(server), await unlockSetup(server), await unlockSetup(server)];
  clock.advance(IDLE + 1);
  const fresh = await unlockSetup(server);
  expect((await postManifest(server, fresh)).statusCode).toBe(200);
  for (const stale of old) {
    expect(await outcome(postManifest(server, stale))).toEqual([401, 'setup_locked']);
  }
});

test('the sessions are in memory: another server process does not know the cookie of this one', async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const { app: restarted } = await setupApp();
  expect(await outcome(postManifest(restarted, unlocked))).toEqual([401, 'setup_locked']);
});
