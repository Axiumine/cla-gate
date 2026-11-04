// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { unlockResponseSchema } from '../../../shared/setup.ts';
import { convertWorld, issueManifestState, postConvert, refusal } from './setup-convert-fixture/test-support.ts';
import { getSetupSession, postManifest, setupApp, unlockSetup } from './setup-fixture/test-support.ts';

// E19-S11: once the credentials were handed out the manifest and the conversion answer 409 setup_already_issued, for every
// session, until the process restarts, so that a second App is not created by accident.

/** The world after a conversion that succeeded: the credentials were issued to `unlocked`, and `state` is the used one. */
async function afterIssue() {
  const world = await convertWorld();
  const state = await issueManifestState(world.app, world.unlocked);
  expect((await postConvert(world.app, world.unlocked, state)).statusCode).toBe(200);
  return { ...world, state };
}

test('a second conversion with the same state is 409 setup_already_issued and GitHub is not asked again', async () => {
  const { app, unlocked, github, state } = await afterIssue();
  expect(await refusal(postConvert(app, unlocked, state))).toEqual([409, 'setup_already_issued']);
  expect(github.requests).toHaveLength(1);
});

test('the manifest is 409 setup_already_issued too, and nothing is built', async () => {
  const { app, unlocked, stateOf } = await afterIssue();
  const response = await postManifest(app, unlocked);
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ error: { code: 'setup_already_issued' } });
  expect(response.body).not.toContain('manifest');
  expect(stateOf()).toBeUndefined();
});

test('another browser that unlocks afterwards is held to it as well: the process has issued, not the session', async () => {
  const { app, github } = await afterIssue();
  const other = await unlockSetup(app);
  expect((await postManifest(app, other)).statusCode).toBe(409);
  expect(await refusal(postConvert(app, other, 'A'.repeat(43)))).toEqual([409, 'setup_already_issued']);
  expect(github.requests).toHaveLength(1);
});

test('the answer is 409 before the body is read: a hostile body is not a 400 once the credentials are out', async () => {
  const { app, unlocked } = await afterIssue();
  expect(await refusal(postConvert(app, unlocked, 'x', { body: { code: '../x' } }))).toEqual([
    409,
    'setup_already_issued',
  ]);
  expect((await postManifest(app, unlocked, { body: { ownerType: '<b>' } })).statusCode).toBe(409);
});

test('the 409 is after the checks of the session: a caller who fails one learns that, and not that credentials were issued', async () => {
  const { app, unlocked, state } = await afterIssue();
  expect(await refusal(postConvert(app, unlocked, state, { origin: 'https://evil.example' }))).toEqual([
    403,
    'origin_mismatch',
  ]);
  expect(await refusal(postConvert(app, unlocked, state, { cookie: undefined }))).toEqual([401, 'setup_locked']);
  expect(await refusal(postConvert(app, unlocked, state, { csrfToken: 'wrong' }))).toEqual([403, 'csrf_invalid']);
});

test('a refusal does not start the idle time of the session over: no cookie is set, and the answer is not cached', async () => {
  const { app, unlocked, state } = await afterIssue();
  const response = await postConvert(app, unlocked, state);
  expect(response.statusCode).toBe(409);
  expect(response.cookies).toEqual([]);
  expect(response.headers['cache-control']).toBe('no-store');
});

test('the status, the unlock and the read of the session still answer: the server stays in setup mode until it is restarted', async () => {
  const { app, unlocked } = await afterIssue();
  expect((await app.inject('/api/setup/status')).json()).toEqual({ mode: 'setup' });
  expect(unlockResponseSchema.parse((await getSetupSession(app, unlocked.cookie)).json())).toEqual({
    csrfToken: unlocked.csrfToken,
  });
  expect((await unlockSetup(app)).csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
});

test('a process that is restarted is free again: a new server offers the manifest', async () => {
  await afterIssue();
  const fresh = await setupApp();
  expect((await postManifest(fresh.app, await unlockSetup(fresh.app))).statusCode).toBe(200);
});
