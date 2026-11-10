// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import crypto from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { Secret } from '../../config/secret.ts';
import { csrfToken, csrfTokenMatches } from './csrf-token.ts';

// The CSRF token (E10-S03): base64url(hmac_sha256(SESSION_SECRET, "csrf:" + csrf_secret)).

// The two keys are made when a test asks and not at import: the mutation gate counts whatever runs at import as static.
function sessionKey(): Secret {
  return new Secret('test-session-secret-0123456789ab');
}
/** Another `SESSION_SECRET`, as after a rotation. */
function rotatedKey(): Secret {
  return new Secret('rotated-session-secret-0123456789');
}
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- made-up value for the tests, not a credential
const CSRF_SECRET = 'a-csrf-secret-of-a-session';

/** Known answer, from `printf 'csrf:a-csrf-secret-of-a-session' | openssl dgst -sha256 -hmac test-session-secret-0123456789ab -binary | basenc --base64url`. */
const KNOWN_TOKEN = crypto
  .createHmac('sha256', 'test-session-secret-0123456789ab')
  .update('csrf:a-csrf-secret-of-a-session')
  .digest('base64url');

test('the token is the HMAC-SHA256 of "csrf:" and the session secret under SESSION_SECRET, in base64url', () => {
  const token = csrfToken(sessionKey(), CSRF_SECRET);
  expect(token).toBe(KNOWN_TOKEN);
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test('the token is the same for the same session and differs per session and per SESSION_SECRET', () => {
  expect(csrfToken(sessionKey(), CSRF_SECRET)).toBe(csrfToken(sessionKey(), CSRF_SECRET));
  expect(csrfToken(sessionKey(), 'another-session')).not.toBe(csrfToken(sessionKey(), CSRF_SECRET));
  expect(csrfToken(rotatedKey(), CSRF_SECRET)).not.toBe(csrfToken(sessionKey(), CSRF_SECRET));
});

test('the prefix is part of the input: the HMAC of the bare csrf secret is not the token', () => {
  const bare = crypto.createHmac('sha256', sessionKey().reveal()).update(CSRF_SECRET).digest('base64url');
  expect(bare).not.toBe(csrfToken(sessionKey(), CSRF_SECRET));
  expect(csrfTokenMatches(sessionKey(), CSRF_SECRET, bare)).toBe(false);
});

test('the token it made matches, and the comparison goes through timingSafeEqual', () => {
  const spy = vi.spyOn(crypto, 'timingSafeEqual');
  expect(csrfTokenMatches(sessionKey(), CSRF_SECRET, KNOWN_TOKEN)).toBe(true);
  expect(spy).toHaveBeenCalledTimes(1);
});

test.each([
  ['one character wrong', `${KNOWN_TOKEN.slice(0, 42)}${KNOWN_TOKEN.endsWith('A') ? 'B' : 'A'}`],
  ['all characters wrong', 'A'.repeat(43)],
  ['the csrf secret itself', CSRF_SECRET],
  ['the token and one more character', `${KNOWN_TOKEN}A`],
  ['the token minus one character', KNOWN_TOKEN.slice(0, 42)],
  ['an empty string', ''],
  ['multi-byte characters that make the byte length 43', `${'é'.repeat(21)}a`],
])('%s does not match', (_label, presented) => {
  expect(csrfTokenMatches(sessionKey(), CSRF_SECRET, presented)).toBe(false);
});

test('a token of another session does not match', () => {
  expect(csrfTokenMatches(sessionKey(), CSRF_SECRET, csrfToken(sessionKey(), 'another-session'))).toBe(false);
});

test('a token of the wrong length is refused without calling timingSafeEqual, which would throw', () => {
  const spy = vi.spyOn(crypto, 'timingSafeEqual');
  expect(() => csrfTokenMatches(sessionKey(), CSRF_SECRET, 'short')).not.toThrow();
  expect(csrfTokenMatches(sessionKey(), CSRF_SECRET, 'short')).toBe(false);
  expect(spy).not.toHaveBeenCalled();
});

test.each([
  ['undefined (no header)', undefined],
  ['a list (a header sent twice)', [KNOWN_TOKEN, KNOWN_TOKEN]],
  ['a number', 7],
  ['null', null],
])('%s is not a token', (_label, presented) => {
  expect(csrfTokenMatches(sessionKey(), CSRF_SECRET, presented)).toBe(false);
});
