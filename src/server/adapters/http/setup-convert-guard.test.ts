// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import {
  convertWorld,
  FAKE_CODE,
  issueManifestState,
  postConvert,
  refusal,
} from './setup-convert-fixture/test-support.ts';

// E19-S11: the conversion is a setup POST like the manifest: Origin, then the cookie, then the CSRF token, all before the body
// is read; and its body is read by a schema that refuses anything but a code and a state, before GitHub is asked.

test.each([
  ['no Origin header', undefined],
  ['another origin', 'https://evil.example'],
  ['the same host over http', 'http://cla.example.org'],
  ['the literal null', 'null'],
])('%s is 403 origin_mismatch, GitHub is not asked and the flow can go on', async (_what, origin) => {
  const { app, unlocked, github } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  expect(await refusal(postConvert(app, unlocked, state, { origin }))).toEqual([403, 'origin_mismatch']);
  expect(github.requests).toEqual([]);
  expect((await postConvert(app, unlocked, state)).statusCode).toBe(200);
});

test.each([
  ['no cookie', undefined],
  ['a cookie with the id of no session', `__Host-cla_setup=${'a'.repeat(43)}`],
  ['an empty cookie', '__Host-cla_setup='],
])('%s is 401 setup_locked and GitHub is not asked', async (_what, cookie) => {
  const { app, unlocked, github } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  expect(await refusal(postConvert(app, unlocked, state, { cookie }))).toEqual([401, 'setup_locked']);
  expect(github.requests).toEqual([]);
});

test.each([
  ['no token', undefined],
  ['an empty token', ''],
  ['a wrong token', 'wrong'],
])('%s is 403 csrf_invalid and GitHub is not asked', async (_what, csrfToken) => {
  const { app, unlocked, github, stateOf } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  expect(await refusal(postConvert(app, unlocked, state, { csrfToken }))).toEqual([403, 'csrf_invalid']);
  expect(github.requests).toEqual([]);
  expect(stateOf()).toBe(state);
});

test('the token of the manifest session is not the token of another session', async () => {
  const { app, unlocked, github } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  const call = { csrfToken: 'x'.repeat(43) };
  expect(await refusal(postConvert(app, unlocked, state, call))).toEqual([403, 'csrf_invalid']);
  expect(github.requests).toEqual([]);
});

test('the checks come in order, and before the body: a hostile body from a caller who is not unlocked learns nothing about it', async () => {
  const { app, unlocked } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  const hostile = { code: '../x', state: '<b>', extra: true };
  expect(await refusal(postConvert(app, unlocked, state, { body: hostile, cookie: undefined }))).toEqual([
    401,
    'setup_locked',
  ]);
  expect(
    await refusal(postConvert(app, unlocked, state, { body: hostile, origin: undefined, cookie: undefined })),
  ).toEqual([403, 'origin_mismatch']);
  expect(await refusal(postConvert(app, unlocked, state, { body: hostile, csrfToken: 'wrong' }))).toEqual([
    403,
    'csrf_invalid',
  ]);
});

test.each([
  ['an empty code', ''],
  ['a code of 65 characters', 'a'.repeat(65)],
  ['a path', '../../x'],
  ['a slash', 'abc/def'],
  ['a dash', 'abc-def'],
  ['a space', 'abc def'],
  ['a query', 'abc?x=1'],
  ['a fragment', 'abc#x'],
  ['an encoded slash', 'abc%2Fdef'],
  ['unicode', 'abcé'],
  ['HTML', '<script>1</script>'],
  ['a line break', 'abc\ndef'],
  ['a number', 12_345],
  ['null', null],
  ['a list', ['abc']],
  ['an object', { toString: 'abc' }],
])('a code that is %s is 400 bad_request, GitHub is not asked and the state is not used up', async (_what, code) => {
  const { app, unlocked, github, stateOf } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  expect(await refusal(postConvert(app, unlocked, state, { body: { code, state } }))).toEqual([400, 'bad_request']);
  expect(github.requests).toEqual([]);
  expect(stateOf()).toBe(state);
});

test('a code of 64 characters, the longest there is, is let through', async () => {
  const { app, unlocked, github } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  const code = 'aB3'.repeat(21).concat('z');
  expect(code).toHaveLength(64);
  github.answerNext(() => Response.json({ message: 'Not Found' }, { status: 404 }));
  expect(await refusal(postConvert(app, unlocked, state, { body: { code, state } }))).toEqual([
    400,
    'setup_code_invalid',
  ]);
  expect(github.requests.map((request) => request.url)).toEqual([
    `https://api.github.com/app-manifests/${code}/conversions`,
  ]);
});

test.each([
  ['an empty state', ''],
  ['a state of 42 characters', 'A'.repeat(42)],
  ['a state of 44 characters', 'A'.repeat(44)],
  ['a state with a plus', `${'A'.repeat(42)}+`],
  ['a state with padding', `${'A'.repeat(42)}=`],
  ['a state that is a number', 7],
  ['no state at all', undefined],
])('%s is 400 bad_request and GitHub is not asked', async (_what, state) => {
  const { app, unlocked, github } = await convertWorld();
  await issueManifestState(app, unlocked);
  expect(await refusal(postConvert(app, unlocked, 'unused', { body: { code: FAKE_CODE, state } }))).toEqual([
    400,
    'bad_request',
  ]);
  expect(github.requests).toEqual([]);
});

test.each([
  ['an extra key', (state: string) => ({ code: FAKE_CODE, state, installationId: 1 })],
  ['no code', (state: string) => ({ state })],
  ['an empty object', () => ({})],
  ['a list', () => [FAKE_CODE]],
  ['nothing', () => ''],
])('a body with %s is 400 bad_request and GitHub is not asked', async (_what, body) => {
  const { app, unlocked, github, stateOf } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  expect(await refusal(postConvert(app, unlocked, state, { body: body(state) }))).toEqual([400, 'bad_request']);
  expect(github.requests).toEqual([]);
  expect(stateOf()).toBe(state);
});

/** A JSON body of exactly `bytes` bytes whose only content is a state-shaped string of 'A's inside a valid envelope. */
function bodyOfSize(bytes: number): string {
  const envelope = `{"code":"${FAKE_CODE}","state":""}`;
  return `{"code":"${FAKE_CODE}","state":"${'A'.repeat(bytes - envelope.length)}"}`;
}

test('the body limit is 4 KiB: 4096 bytes are read (and refused as a state of the wrong length), one more is 413', async () => {
  const { app, unlocked, github } = await convertWorld();
  const send = (payload: string) =>
    app.inject({
      method: 'POST',
      url: '/api/setup/convert',
      headers: {
        origin: 'https://cla.example.org',
        cookie: unlocked.cookie,
        'x-csrf-token': unlocked.csrfToken,
        'content-type': 'application/json',
      },
      payload,
    });
  const within = await send(bodyOfSize(4096));
  expect(Buffer.byteLength(bodyOfSize(4096))).toBe(4096);
  expect(within.statusCode).toBe(400);
  expect(errorResponseSchema.parse(within.json()).error.code).toBe('bad_request');
  const over = await send(bodyOfSize(4097));
  expect(over.statusCode).toBe(413);
  expect(errorResponseSchema.parse(over.json()).error.code).toBe('payload_too_large');
  expect(github.requests).toEqual([]);
});

test('the conversion answers a POST only: a link to it is 404 and asks nothing of GitHub', async () => {
  const { app, unlocked, github } = await convertWorld();
  const response = await app.inject({ url: '/api/setup/convert', headers: { cookie: unlocked.cookie } });
  expect(response.statusCode).toBe(404);
  expect(github.requests).toEqual([]);
});
