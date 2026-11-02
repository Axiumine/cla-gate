// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { Secret } from '../../config/secret.ts';
import {
  GITHUB_EXAMPLE,
  SECRET_CURRENT,
  SECRET_PREVIOUS,
  sign,
  signLegacy,
  watchCreateHmac,
  watchTimingSafeEqual,
} from './test-support.ts';
import { matchWebhookSignature, sameDigest } from './webhook-signature.ts';

const BODY = Buffer.from('{"action":"opened","number":7}');
const BOTH = { current: new Secret(SECRET_CURRENT), previous: new Secret(SECRET_PREVIOUS) };
const ONLY_CURRENT = { current: new Secret(SECRET_CURRENT), previous: undefined };

test('GitHub documented example: the known secret, body and header match', () => {
  const secrets = { current: new Secret(GITHUB_EXAMPLE.secret), previous: undefined };
  expect(matchWebhookSignature(Buffer.from(GITHUB_EXAMPLE.body), GITHUB_EXAMPLE.signature, secrets)).toBe('current');
});

test('the signature that matches the current secret says current, and the previous one says previous', () => {
  expect(matchWebhookSignature(BODY, sign(SECRET_CURRENT, BODY), BOTH)).toBe('current');
  expect(matchWebhookSignature(BODY, sign(SECRET_PREVIOUS, BODY), BOTH)).toBe('previous');
});

test('a body signed by the previous secret is refused once that secret is removed', () => {
  expect(matchWebhookSignature(BODY, sign(SECRET_PREVIOUS, BODY), ONLY_CURRENT)).toBe('none');
});

test('a body signed by neither secret is refused', () => {
  expect(matchWebhookSignature(BODY, sign('some-other-secret-value', BODY), BOTH)).toBe('none');
});

test('the previous secret alone, with no current one, still matches', () => {
  const secrets = { current: undefined, previous: new Secret(SECRET_PREVIOUS) };
  expect(matchWebhookSignature(BODY, sign(SECRET_PREVIOUS, BODY), secrets)).toBe('previous');
});

test('with no secret configured nothing matches, not even a signature made with the empty key', () => {
  const none = { current: undefined, previous: undefined };
  expect(matchWebhookSignature(BODY, sign(SECRET_CURRENT, BODY), none)).toBe('none');
  expect(matchWebhookSignature(BODY, sign('', BODY), none)).toBe('none');
});

test('a signature is over the exact bytes: one flipped byte or different whitespace is refused', () => {
  const signature = sign(SECRET_CURRENT, BODY);
  const flipped = Buffer.from(BODY);
  flipped[3] = (flipped[3] ?? 0) ^ 0x01;
  const reserialised = Buffer.from(JSON.stringify(JSON.parse(BODY.toString()), null, 2));
  expect(matchWebhookSignature(flipped, signature, BOTH)).toBe('none');
  expect(matchWebhookSignature(reserialised, signature, BOTH)).toBe('none');
  expect(matchWebhookSignature(Buffer.concat([BODY, Buffer.from('\n')]), signature, BOTH)).toBe('none');
  expect(matchWebhookSignature(BODY.subarray(1), signature, BOTH)).toBe('none');
});

test('the signature of the empty body is the one HMAC of the empty string, and matches the empty body only', () => {
  const signature = sign(SECRET_CURRENT, '');
  expect(matchWebhookSignature(Buffer.alloc(0), signature, BOTH)).toBe('current');
  expect(matchWebhookSignature(BODY, signature, BOTH)).toBe('none');
});

const GOOD = sign(SECRET_CURRENT, BODY);

test.each([
  ['missing', undefined],
  ['an empty string', ''],
  ['upper-case hex', `sha256=${GOOD.slice(7).toUpperCase()}`],
  ['one upper-case digit', GITHUB_EXAMPLE.signature.replace('ea', 'Ea')],
  ['a prefix in capitals', `SHA256=${GOOD.slice(7)}`],
  ['a trailing space', `${GOOD} `],
  ['a leading space', ` ${GOOD}`],
  ['a trailing newline', `${GOOD}\n`],
  ['a trailing carriage return', `${GOOD}\r`],
  ['a NUL at the end', `${GOOD}\0`],
  ['the digits without the prefix', GOOD.slice(7)],
  ['the legacy sha1 prefix', `sha1=${GOOD.slice(7)}`],
  ['a doubled prefix', `sha256=sha256=${GOOD.slice(7)}`],
  ['63 digits', GOOD.slice(0, -1)],
  ['65 digits', `${GOOD}0`],
  ['a non-hex digit', `${GOOD.slice(0, -1)}g`],
  ['a sha1 HMAC of 40 digits', signLegacy(SECRET_CURRENT, BODY)],
  ['two values joined', `${GOOD}, ${GOOD}`],
  ['an array of the right value', [GOOD]],
  ['a number', 7],
  ['null', null],
  ['an object', { toString: () => GOOD }],
])('a header that is %s is refused even for a body it would otherwise match', (_label, header) => {
  expect(matchWebhookSignature(BODY, header, BOTH)).toBe('none');
});

test('both secrets are always computed and compared, whichever matches', () => {
  const hmac = watchCreateHmac();
  const compare = watchTimingSafeEqual();
  expect(matchWebhookSignature(BODY, sign(SECRET_CURRENT, BODY), BOTH)).toBe('current');
  expect(hmac).toHaveBeenCalledTimes(3);
  expect(compare).toHaveBeenCalledTimes(2);
});

test('a refusal compares both secrets as well, and a missing secret costs no comparison', () => {
  const compare = watchTimingSafeEqual();
  expect(matchWebhookSignature(BODY, sign('x'.repeat(16), BODY), BOTH)).toBe('none');
  expect(compare).toHaveBeenCalledTimes(2);
  compare.mockClear();
  expect(matchWebhookSignature(BODY, sign('x'.repeat(16), BODY), ONLY_CURRENT)).toBe('none');
  expect(compare).toHaveBeenCalledTimes(1);
});

test('a header that is not the right shape is refused before any secret is touched', () => {
  const compare = watchTimingSafeEqual();
  expect(matchWebhookSignature(BODY, `${GOOD} `, BOTH)).toBe('none');
  expect(compare).not.toHaveBeenCalled();
});

test('the digests are compared with crypto.timingSafeEqual on buffers of the same length', () => {
  const compare = watchTimingSafeEqual();
  matchWebhookSignature(BODY, GOOD, ONLY_CURRENT);
  const [expected, claimed] = compare.mock.calls[0] ?? [];
  expect(expected).toBeInstanceOf(Buffer);
  expect(claimed).toBeInstanceOf(Buffer);
  expect(expected).toHaveLength(32);
  expect(claimed).toHaveLength(32);
  expect(claimed).toEqual(Buffer.from(GOOD.slice(7), 'hex'));
});

test.each([
  ['equal bytes', Buffer.from('abcd'), Buffer.from('abcd'), true],
  ['one byte different', Buffer.from('abcd'), Buffer.from('abce'), false],
  ['a shorter claim, which timingSafeEqual itself would throw on', Buffer.from('abcd'), Buffer.from('abc'), false],
  ['a longer claim', Buffer.from('abc'), Buffer.from('abcd'), false],
  ['two empty buffers', Buffer.alloc(0), Buffer.alloc(0), true],
])('sameDigest of %s', (_label, expected, claimed, equal) => {
  expect(sameDigest(expected, claimed)).toBe(equal);
});

test('an unequal length never reaches timingSafeEqual', () => {
  const compare = watchTimingSafeEqual();
  expect(sameDigest(Buffer.alloc(32), Buffer.alloc(31))).toBe(false);
  expect(compare).not.toHaveBeenCalled();
});
