// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { manifestResponseSchema } from '../../../shared/setup.ts';
import { TEST_SETUP_TOKEN } from '../../config/test-support.ts';
import { fakeManifestGithub, issueManifestState, postConvert } from './setup-convert-fixture/test-support.ts';
import { MANIFEST_BODY, postManifest, postUnlock, setupApp, unlockSetup } from './setup-fixture/test-support.ts';

// E19-S11: the structured events of the setup: `setup.unlock.ok`, `setup.unlock.failed`, `setup.manifest.issued` and
// `setup.credentials.issued`. Each carries the request id and nothing else, so a log tells that a step happened and when, and
// never by whom, with what or to what end.

/** What pino adds to every line by itself, and the id of the request that Fastify binds to it. */
const COMMON = ['level', 'time', 'pid', 'hostname', 'reqId', 'msg'];

type Line = Record<string, unknown>;

/** The events of the setup in `lines`, in order. */
const setupEvents = (lines: readonly Line[]): Line[] =>
  lines.filter((line) => String(line['msg']).startsWith('setup.'));

test('the four events are logged in the order the steps happen, each with the id of its own request and nothing else', async () => {
  const { app, logs } = await setupApp();
  fakeManifestGithub();
  const wrong = await postUnlock(app, 'a wrong token');
  const right = await postUnlock(app, TEST_SETUP_TOKEN);
  expect([wrong.statusCode, right.statusCode]).toEqual([401, 200]);
  const unlocked = await unlockSetup(app);
  const manifest = await postManifest(app, unlocked, { body: MANIFEST_BODY });
  const state = manifestResponseSchema.parse(manifest.json()).state;
  const converted = await postConvert(app, unlocked, state);
  expect(converted.statusCode).toBe(200);
  const events = setupEvents(logs.lines());
  expect(events.map((line) => line['msg'])).toEqual([
    'setup.unlock.failed',
    'setup.unlock.ok',
    'setup.unlock.ok',
    'setup.manifest.issued',
    'setup.credentials.issued',
  ]);
  expect(events.map((line) => line['level'])).toEqual([40, 30, 30, 30, 30]);
  expect(events[0]?.['reqId']).toBe(wrong.headers['x-request-id']);
  expect(events[1]?.['reqId']).toBe(right.headers['x-request-id']);
  expect(events[3]?.['reqId']).toBe(manifest.headers['x-request-id']);
  expect(events[4]?.['reqId']).toBe(converted.headers['x-request-id']);
  for (const event of events) {
    expect(Object.keys(event).filter((key) => !COMMON.includes(key))).toEqual([]);
    expect(event['reqId']).toEqual(expect.any(String));
  }
});

test('a step that failed logs no event of success: no manifest.issued for a refused manifest, no credentials.issued for a failed conversion', async () => {
  const { app, logs } = await setupApp();
  const github = fakeManifestGithub();
  const unlocked = await unlockSetup(app);
  expect((await postManifest(app, unlocked, { csrfToken: 'wrong' })).statusCode).toBe(403);
  const state = await issueManifestState(app, unlocked);
  github.answerNext(() => Response.json({ message: 'nope' }, { status: 503 }));
  expect((await postConvert(app, unlocked, state)).statusCode).toBe(502);
  expect(setupEvents(logs.lines()).map((line) => line['msg'])).toEqual(['setup.unlock.ok', 'setup.manifest.issued']);
});

test('a conversion refused because the credentials are out already logs no event of the setup either', async () => {
  const { app, logs } = await setupApp();
  fakeManifestGithub();
  const unlocked = await unlockSetup(app);
  const state = await issueManifestState(app, unlocked);
  await postConvert(app, unlocked, state);
  expect((await postConvert(app, unlocked, state)).statusCode).toBe(409);
  expect((await postManifest(app, unlocked)).statusCode).toBe(409);
  expect(setupEvents(logs.lines()).map((line) => line['msg'])).toEqual([
    'setup.unlock.ok',
    'setup.manifest.issued',
    'setup.credentials.issued',
  ]);
});
