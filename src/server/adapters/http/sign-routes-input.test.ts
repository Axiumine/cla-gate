// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { SIGN_PATH } from '../../../shared/sign.ts';
import { errorCodeOf } from './sign-context-fixture/test-support.ts';
import { NOTHING_WRITTEN, postSign, signingWorld, writtenRows } from './sign-fixture/test-support.ts';

// What reaches the sign request before the repository is looked up (E13-S04): a body that is not the schema, a request without
// a session, from another site or without the token, and a body that is too large. None of them writes a row.

const SHA = 'a'.repeat(64);

test.each([
  ['a key the schema does not know', { extra: 1 }],
  ['a name that is not text', { name: 5 }],
  ['a name that is missing', { name: undefined }],
  ['an address that is null', { email: null }],
  ['a repository id that is zero', { githubRepoId: 0 }],
  ['a repository id that is not a whole number', { githubRepoId: 9000.5 }],
  ['a version id that is text', { versionId: '31' }],
  ['a version id that is negative', { versionId: -1 }],
  ['a hash in capitals', { contentSha256: SHA.toUpperCase() }],
  ['a hash of 63 characters', { contentSha256: SHA.slice(1) }],
  ['a hash with a character that is not hexadecimal', { contentSha256: `${SHA.slice(1)}g` }],
  ['a consent id that is empty', { consentTextId: '' }],
  ['a consent id of 65 characters', { consentTextId: 'c'.repeat(65) }],
  ['a pull request number of zero', { prNumber: 0 }],
  ['a pull request number above the range', { prNumber: 2_147_483_648 }],
  ['a pull request number that is null', { prNumber: null }],
])('%s is a 400 bad_request and writes nothing', async (_label, overrides) => {
  const { world, ada, body } = await signingWorld();
  const response = await postSign(world, ada, body(overrides));
  expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
  expect(await writtenRows(world.db)).toEqual(NOTHING_WRITTEN);
});

test.each([
  ['an array', '[]'],
  ['null', 'null'],
  ['a string', '"Ada"'],
  ['text that is not JSON', 'not json'],
  ['an empty body', ''],
])('%s as the body is a 400 bad_request and writes nothing', async (_label, payload) => {
  const { world, ada } = await signingWorld();
  const response = await world.app.inject({
    method: 'POST',
    url: SIGN_PATH,
    headers: { ...ada.headers, 'content-type': 'application/json' },
    payload,
  });
  expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
  expect(await writtenRows(world.db)).toEqual(NOTHING_WRITTEN);
});

test('a body that is not JSON is refused with a 415 and a body above 16 KiB with a 413, before anything is read', async () => {
  const { world, ada, body } = await signingWorld();
  const form = await world.app.inject({
    method: 'POST',
    url: SIGN_PATH,
    headers: { ...ada.headers, 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'name=Ada',
  });
  expect(form.statusCode).toBe(415);
  const large = await postSign(world, ada, body({ name: 'x'.repeat(17_000) }));
  expect([large.statusCode, errorCodeOf(large)]).toEqual([413, 'payload_too_large']);
  expect(await writtenRows(world.db)).toEqual(NOTHING_WRITTEN);
});

test('a request with no session is a 401 and never a redirect', async () => {
  const { world, ada, body } = await signingWorld();
  const response = await world.app.inject({
    method: 'POST',
    url: SIGN_PATH,
    headers: { origin: world.origin, 'content-type': 'application/json', 'x-csrf-token': ada.token },
    payload: JSON.stringify(body()),
  });
  expect([response.statusCode, errorCodeOf(response)]).toEqual([401, 'unauthorized']);
  expect(response.headers.location).toBeUndefined();
  expect(await writtenRows(world.db)).toEqual(NOTHING_WRITTEN);
});

type Headers = Readonly<Record<string, string>>;

/** The headers without the one called `name`. */
function without(headers: Headers, name: string): Headers {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => key !== name));
}

test.each([
  ['no Origin header', (headers: Headers) => without(headers, 'origin'), 'origin_not_allowed'],
  [
    'the Origin of another site',
    (headers: Headers) => ({ ...headers, origin: 'https://evil.example' }),
    'origin_not_allowed',
  ],
  ['no CSRF token', (headers: Headers) => without(headers, 'x-csrf-token'), 'csrf_invalid'],
  [
    'the CSRF token of another session',
    (headers: Headers) => ({ ...headers, 'x-csrf-token': 'x'.repeat(43) }),
    'csrf_invalid',
  ],
])('%s is a 403 and writes nothing', async (_label, change, code) => {
  const { world, ada, body } = await signingWorld();
  const response = await world.app.inject({
    method: 'POST',
    url: SIGN_PATH,
    headers: { ...change(ada.headers), 'content-type': 'application/json' },
    payload: JSON.stringify(body()),
  });
  expect([response.statusCode, errorCodeOf(response)]).toEqual([403, code]);
  expect(await writtenRows(world.db)).toEqual(NOTHING_WRITTEN);
});
