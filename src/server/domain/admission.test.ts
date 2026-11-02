// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { createAdmissionPolicy, decideAdmission, effectiveAccountIds } from './admission.ts';

const id = parseGithubId;
const OWNER = id(9001);
const policy = createAdmissionPolicy([id(42), id(77)], OWNER);
const REFUSED = { admitted: false, reason: 'account_not_allowed' };

test.each([
  ['the App owner', 9001, { admitted: true }],
  ['a listed id', 42, { admitted: true }],
  ['another listed id', 77, { admitted: true }],
  ['an unlisted id', 43, REFUSED],
  ['the id next to the owner', 9002, REFUSED],
  ['zero', 0, REFUSED],
  ['minus one', -1, REFUSED],
  ['minus a listed id', -42, REFUSED],
  ['NaN', Number.NaN, REFUSED],
  ['Infinity', Number.POSITIVE_INFINITY, REFUSED],
  ['a float', 42.5, REFUSED],
  ['a float that rounds to a listed id', 42.000_000_000_000_01, REFUSED],
  ['a number above Number.MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER + 1, REFUSED],
  ['the owner id as a string', '9001', REFUSED],
  ['a listed id as a string', '42', REFUSED],
  ['a listed id with spaces', ' 42 ', REFUSED],
  ['a login', 'octocat', REFUSED],
  ['the owner id as a bigint', 9001n, REFUSED],
  ['null', null, REFUSED],
  ['undefined', undefined, REFUSED],
  ['an array holding the owner id', [9001], REFUSED],
  ['an object holding the owner id', { id: 9001 }, REFUSED],
])('the decision for %s is as expected', (_label, accountId, verdict) => {
  expect(decideAdmission(accountId, policy)).toEqual(verdict);
});

test('with no configured ids the owner account is the only one served', () => {
  const ownerOnly = createAdmissionPolicy([], OWNER);
  expect(decideAdmission(9001, ownerOnly)).toEqual({ admitted: true });
  expect(decideAdmission(42, ownerOnly)).toEqual(REFUSED);
});

test('a policy has no wildcard: nothing but the listed numbers is served', () => {
  expect(decideAdmission('*', policy)).toEqual(REFUSED);
  expect(decideAdmission(Number.MAX_SAFE_INTEGER, policy)).toEqual(REFUSED);
});

test('the owner listed again in the configuration is one entry, and the effective ids are ascending', () => {
  const listed = createAdmissionPolicy([id(77), OWNER, id(42), id(42)], OWNER);
  expect(effectiveAccountIds(listed)).toEqual([42, 77, 9001]);
  expect(effectiveAccountIds(createAdmissionPolicy([], OWNER))).toEqual([9001]);
});

test('a refusal carries the reason code and nothing else', () => {
  expect(Object.keys(decideAdmission(43, policy))).toEqual(['admitted', 'reason']);
  expect(Object.keys(decideAdmission(42, policy))).toEqual(['admitted']);
});
