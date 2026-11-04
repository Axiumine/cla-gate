// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { convertResponseSchema } from '../../../shared/setup.ts';
import {
  convertWorld,
  FAKE_CODE,
  idOf,
  issueManifestState,
  MADE_UP_APP,
  postConvert,
  refusal,
} from './setup-convert-fixture/test-support.ts';
import { unlockSetup } from './setup-fixture/test-support.ts';

// E19-S11: `POST /api/setup/convert {code, state}` trades GitHub's one-time code for the credentials of the App, once, for the
// browser whose manifest the `state` belongs to.

test('after the unlock and a manifest, the conversion answers 200 with the App and its credentials, and no cache may keep them', async () => {
  const { app, unlocked } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  const response = await postConvert(app, unlocked, state);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['content-type']).toMatch(/^application\/json/u);
  expect(convertResponseSchema.parse(response.json())).toEqual({
    appId: MADE_UP_APP.id,
    slug: MADE_UP_APP.slug,
    htmlUrl: MADE_UP_APP.htmlUrl,
    installUrl: `https://github.com/apps/${MADE_UP_APP.slug}/installations/new`,
    clientId: MADE_UP_APP.clientId,
    clientSecret: MADE_UP_APP.clientSecret,
    webhookSecret: MADE_UP_APP.webhookSecret,
    privateKeyPem: MADE_UP_APP.pem,
  });
  expect(Object.keys(response.json()).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'appId',
    'clientId',
    'clientSecret',
    'htmlUrl',
    'installUrl',
    'privateKeyPem',
    'slug',
    'webhookSecret',
  ]);
});

test('GitHub is asked once, with a POST for the code of the request, the media type and API version, and no Authorization', async () => {
  const { app, unlocked, github } = await convertWorld();
  await postConvert(app, unlocked, await issueManifestState(app, unlocked));
  expect(github.requests).toHaveLength(1);
  const [sent] = github.requests;
  expect(sent?.method).toBe('POST');
  expect(sent?.url).toBe(`https://api.github.com/app-manifests/${FAKE_CODE}/conversions`);
  expect(sent?.headers['accept']).toBe('application/vnd.github+json');
  expect(sent?.headers['x-github-api-version']).toBe('2022-11-28');
  expect(sent?.headers).not.toHaveProperty('authorization');
  expect(sent?.headers).not.toHaveProperty('cookie');
  expect(github.converted).toEqual([FAKE_CODE]);
});

test('the setup cookie is set again with its 30 minutes, as every setup call that passes does', async () => {
  const { app, unlocked } = await convertWorld();
  const response = await postConvert(app, unlocked, await issueManifestState(app, unlocked));
  const [cookie] = response.cookies;
  expect(`${cookie?.name}=${cookie?.value}`).toBe(unlocked.cookie);
  expect(cookie?.maxAge).toBe(1800);
});

test('a success uses the state up and the process records that credentials were handed out', async () => {
  const { app, unlocked, sessions, stateOf } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  expect(stateOf()).toBe(state);
  expect(sessions.credentialsIssued).toBe(false);
  await postConvert(app, unlocked, state);
  expect(stateOf()).toBeUndefined();
  expect(sessions.credentialsIssued).toBe(true);
});

test('a conversion with no manifest issued first is setup_code_invalid, and GitHub is not asked', async () => {
  const { app, unlocked, github } = await convertWorld();
  const state = 'A'.repeat(43);
  expect(await refusal(postConvert(app, unlocked, state))).toEqual([400, 'setup_code_invalid']);
  expect(github.requests).toEqual([]);
});

test.each([
  ['the last character changed', (state: string) => `${state.slice(0, -1)}${state.endsWith('A') ? 'B' : 'A'}`],
  ['the first character changed', (state: string) => `${state.startsWith('A') ? 'B' : 'A'}${state.slice(1)}`],
  ['a state of 43 other characters', () => 'z'.repeat(43)],
])('a state with %s is setup_code_invalid and the real one still works afterwards', async (_what, change) => {
  const { app, unlocked, github, stateOf } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  expect(await refusal(postConvert(app, unlocked, change(state)))).toEqual([400, 'setup_code_invalid']);
  expect(github.requests).toEqual([]);
  expect(stateOf()).toBe(state);
  expect((await postConvert(app, unlocked, state)).statusCode).toBe(200);
});

test('only the last manifest issued can be completed: the state of an earlier one is refused', async () => {
  const { app, unlocked, github } = await convertWorld();
  const first = await issueManifestState(app, unlocked);
  const second = await issueManifestState(app, unlocked);
  expect(await refusal(postConvert(app, unlocked, first))).toEqual([400, 'setup_code_invalid']);
  expect(github.requests).toEqual([]);
  expect((await postConvert(app, unlocked, second)).statusCode).toBe(200);
});

test('a state is bound to the session it was issued to: another unlocked session cannot complete it', async () => {
  const { app, unlocked, github } = await convertWorld();
  const mine = await issueManifestState(app, unlocked);
  const other = await unlockSetup(app);
  expect(await refusal(postConvert(app, other, mine))).toEqual([400, 'setup_code_invalid']);
  expect(github.requests).toEqual([]);
  expect(idOf(other.cookie)).not.toBe(idOf(unlocked.cookie));
  expect((await postConvert(app, unlocked, mine)).statusCode).toBe(200);
});

test('a code GitHub does not know uses the state up: pressing the button again is refused before GitHub is asked', async () => {
  const { app, unlocked, github } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  github.answerNext(() => Response.json({ message: 'Not Found' }, { status: 404 }));
  expect((await postConvert(app, unlocked, state)).statusCode).toBe(400);
  expect(await refusal(postConvert(app, unlocked, state))).toEqual([400, 'setup_code_invalid']);
  expect(github.requests).toHaveLength(1);
});

test('a code that GitHub never issued is setup_code_invalid, and the state goes with it', async () => {
  const { app, unlocked, github, stateOf } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  const body = { code: 'neverissued1', state };
  expect(await refusal(postConvert(app, unlocked, state, { body }))).toEqual([400, 'setup_code_invalid']);
  expect(github.requests.map((request) => request.url)).toEqual([
    'https://api.github.com/app-manifests/neverissued1/conversions',
  ]);
  expect(stateOf()).toBeUndefined();
});
