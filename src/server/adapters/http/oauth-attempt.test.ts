// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { authorizeUrl, newLoginAttempt, pkceChallenge } from './oauth-attempt.ts';

// The pieces of one login attempt (E10-S04): state, PKCE verifier and challenge, and the GitHub authorize URL.

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

test('the challenge is the one RFC 7636 (Appendix B) gives for its example verifier', () => {
  expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});

test('state and verifier are 43 base64url characters each, independent, and the challenge is the verifier hashed', () => {
  const attempt = newLoginAttempt();
  expect(attempt.state).toMatch(BASE64URL_43);
  expect(attempt.verifier).toMatch(BASE64URL_43);
  expect(attempt.challenge).toMatch(BASE64URL_43);
  expect(attempt.state).not.toBe(attempt.verifier);
  expect(attempt.challenge).toBe(pkceChallenge(attempt.verifier));
  expect(attempt.challenge).not.toBe(attempt.verifier);
});

test('every attempt is new: a thousand give a thousand different states and verifiers', () => {
  const attempts = Array.from({ length: 1000 }, () => newLoginAttempt());
  expect(new Set(attempts.map((attempt) => attempt.state)).size).toBe(1000);
  expect(new Set(attempts.map((attempt) => attempt.verifier)).size).toBe(1000);
});

test('the authorize URL is GitHub with exactly five parameters and no scope', () => {
  const url = new URL(
    authorizeUrl({
      clientId: 'Iv1.abc',
      redirectUri: 'https://app.example.com/api/auth/callback',
      state: 'STATE',
      challenge: 'CHALLENGE',
    }),
  );
  expect(`${url.origin}${url.pathname}`).toBe('https://github.com/login/oauth/authorize');
  expect([...url.searchParams.entries()]).toEqual([
    ['client_id', 'Iv1.abc'],
    ['redirect_uri', 'https://app.example.com/api/auth/callback'],
    ['state', 'STATE'],
    ['code_challenge', 'CHALLENGE'],
    ['code_challenge_method', 'S256'],
  ]);
});

test('a client id with URL syntax in it stays one parameter', () => {
  const url = new URL(
    authorizeUrl({ clientId: 'a&scope=repo', redirectUri: 'https://x.test/cb', state: 's', challenge: 'c' }),
  );
  expect(url.searchParams.get('client_id')).toBe('a&scope=repo');
  expect(url.searchParams.has('scope')).toBe(false);
});
