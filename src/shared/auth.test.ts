// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { loginFailedPath, loginFailureReasonSchema, logoutRequestSchema, sessionResponseSchema } from './auth.ts';

const BODY = {
  user: { githubId: 1001, login: 'alice', name: 'Alice', avatarUrl: null },
  expiresAt: '2026-11-02T18:00:00.000Z',
  csrfToken: 'A'.repeat(43),
};

test('a session response carries the user, the end of the session and the CSRF token', () => {
  expect(sessionResponseSchema.parse(BODY)).toEqual(BODY);
});

test.each([
  ['missing', undefined],
  ['empty', ''],
  ['42 characters', 'A'.repeat(42)],
  ['44 characters', 'A'.repeat(44)],
  ['outside base64url', `${'A'.repeat(42)}+`],
  ['a number', 7],
])('a CSRF token that is %s is rejected', (_label, csrfToken) => {
  expect(sessionResponseSchema.safeParse({ ...BODY, csrfToken }).success).toBe(false);
});

test.each([
  ['state_mismatch', '/login/failed?reason=state_mismatch'],
  ['access_denied', '/login/failed?reason=access_denied'],
  ['exchange_failed', '/login/failed?reason=exchange_failed'],
  ['github_unavailable', '/login/failed?reason=github_unavailable'],
  ['unsupported_account', '/login/failed?reason=unsupported_account'],
  ['bad_request', '/login/failed?reason=bad_request'],
] as const)('the failure reason %s leads to %s', (reason, path) => {
  expect(loginFailureReasonSchema.parse(reason)).toBe(reason);
  expect(loginFailedPath(reason)).toBe(path);
});

test.each(['', 'unknown', 'STATE_MISMATCH', 'state_mismatch ', 7])('%j is not a login failure reason', (reason) => {
  expect(loginFailureReasonSchema.safeParse(reason).success).toBe(false);
});

test.each([
  ['an absent body', undefined, undefined],
  ['an empty object', {}, {}],
  ['everywhere false', { everywhere: false }, { everywhere: false }],
  ['everywhere true', { everywhere: true }, { everywhere: true }],
])('a logout body of %s is accepted', (_label, body, parsed) => {
  expect(logoutRequestSchema.parse(body)).toEqual(parsed);
});

test.each([
  ['an unknown key', { userId: 2 }],
  ['an unknown key beside a known one', { everywhere: true, githubId: 2002 }],
  ['a string for the flag', { everywhere: 'true' }],
  ['a number for the flag', { everywhere: 1 }],
  ['null for the flag', { everywhere: null }],
  ['null as the body', null],
  ['an array as the body', [true]],
  ['a string as the body', 'everywhere'],
])('a logout body of %s is rejected', (_label, body) => {
  expect(logoutRequestSchema.safeParse(body).success).toBe(false);
});
