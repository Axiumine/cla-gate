// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createVerify } from 'node:crypto';
import { expect, test } from 'vitest';
import { parseGitHubPrivateKey } from '../../config/github-key.ts';
import { type TestRsaKey, testGitHubKey, testRsaKey } from '../../config/test-support.ts';
import { signAppJwt } from './app-jwt.ts';
import { decodeJwt, jwtSignedBy } from './test-support.ts';

/** 2026-11-02T10:00:00Z in whole seconds. */
const NOW = 1_793_613_600;

const KEY = testGitHubKey();

test('the header is exactly {"alg":"RS256","typ":"JWT"}', () => {
  expect(decodeJwt(signAppJwt('4242', KEY.key, NOW)).header).toBe('{"alg":"RS256","typ":"JWT"}');
});

test('the claims are the App id, now minus 60 s and now plus 540 s, pinned for a fixed clock', () => {
  expect(decodeJwt(signAppJwt('4242', KEY.key, NOW)).claims).toEqual({
    iat: 1_793_613_540,
    exp: 1_793_614_140,
    iss: '4242',
  });
});

test('iat and exp are integers and exp - iat is 600 s, GitHub’s ceiling of ten minutes', () => {
  const { iat, exp } = decodeJwt(signAppJwt('4242', KEY.key, NOW)).claims;
  expect(Number.isInteger(iat)).toBe(true);
  expect(Number.isInteger(exp)).toBe(true);
  expect(Number(exp) - Number(iat)).toBe(600);
});

test('the iss claim follows the App id it is given', () => {
  expect(decodeJwt(signAppJwt('77', KEY.key, NOW)).claims['iss']).toBe('77');
});

test('the token verifies against the public half of the key, with crypto.verify and with an RS256 verifier', () => {
  const token = signAppJwt('4242', KEY.key, NOW);
  expect(jwtSignedBy(token, KEY.publicKey)).toBe(true);
  const { signingInput, signature } = decodeJwt(token);
  expect(createVerify('RSA-SHA256').update(signingInput).verify(KEY.publicKey, signature)).toBe(true);
});

test.each([
  ['PKCS#1', (pair: TestRsaKey) => pair.pkcs1],
  ['PKCS#8', (pair: TestRsaKey) => pair.pkcs8],
])('a %s key signs a token that verifies', (_name, pemOf) => {
  const pair = testRsaKey();
  const key = parseGitHubPrivateKey(pemOf(pair));
  expect(key).toBeDefined();
  expect(jwtSignedBy(signAppJwt('4242', key ?? KEY.key, NOW), pair.publicKey)).toBe(true);
});

test('another key does not verify the token, and neither does a token whose claims were changed', () => {
  const token = signAppJwt('4242', KEY.key, NOW);
  expect(jwtSignedBy(token, testGitHubKey().publicKey)).toBe(false);
  const [header = '', , signature = ''] = token.split('.');
  const forged = `${header}.${Buffer.from('{"iat":1,"exp":2,"iss":"1"}').toString('base64url')}.${signature}`;
  expect(jwtSignedBy(forged, KEY.publicKey)).toBe(false);
});

test('the token is three base64url segments without padding', () => {
  expect(signAppJwt('4242', KEY.key, NOW)).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
});

test('signing again at the same second gives the same token: RS256 is deterministic', () => {
  expect(signAppJwt('4242', KEY.key, NOW)).toBe(signAppJwt('4242', KEY.key, NOW));
  expect(signAppJwt('4242', KEY.key, NOW + 1)).not.toBe(signAppJwt('4242', KEY.key, NOW));
});
