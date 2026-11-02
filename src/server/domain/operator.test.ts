// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { createOperatorPolicy, effectiveOperatorIds, isOperator } from './operator.ts';

// Who operates the instance (E11-S08): the policy from the configuration and the owner of the App, and the pure decision
// on the numeric id of the session.

const id = parseGithubId;
const OWNER = id(9001);
const USER_OWNER = { id: OWNER, type: 'User' };
const ORG_OWNER = { id: OWNER, type: 'Organization' };

test.each([
  ['an owner that is a user, the variable unset', undefined, USER_OWNER, [9001]],
  ['an owner that is an organisation, the variable unset', undefined, ORG_OWNER, []],
  ['an owner of a kind that is neither, the variable unset', undefined, { id: OWNER, type: 'Other' }, []],
  ['an owner in capitals, which is not the kind GitHub sends', undefined, { id: OWNER, type: 'USER' }, []],
  ['no owner (no GitHub App), the variable unset', undefined, undefined, []],
  ['an owner that is an organisation and the variable set', [id(7), id(5)], ORG_OWNER, [5, 7]],
  ['an owner that is a user and the variable set: the owner is not added', [id(7), id(5)], USER_OWNER, [5, 7]],
  ['no owner and the variable set', [id(7)], undefined, [7]],
])('%s gives the operators %j', (_label, configured, owner, ids) => {
  expect(effectiveOperatorIds(createOperatorPolicy(configured, owner))).toEqual(ids);
});

test('the effective ids are ascending and a repeated id is one', () => {
  expect(effectiveOperatorIds(createOperatorPolicy([id(30), id(4), id(30), id(12)], undefined))).toEqual([4, 12, 30]);
});

const policy = createOperatorPolicy([id(42), id(77)], USER_OWNER);

test.each([
  ['a listed id', 42, true],
  ['another listed id', 77, true],
  ['an unlisted id', 43, false],
  ['the owner that is a user, when the variable names others', 9001, false],
  ['zero', 0, false],
  ['minus one', -1, false],
  ['minus a listed id', -42, false],
  ['NaN', Number.NaN, false],
  ['a float', 42.5, false],
  ['a number above Number.MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER + 1, false],
  ['a listed id as a string', '42', false],
  ['a listed id as a string with spaces', ' 42 ', false],
  ['a login', 'octocat', false],
  ['a listed id as a bigint', 42n, false],
  ['null', null, false],
  ['undefined', undefined, false],
  ['an array holding a listed id', [42], false],
  ['an object holding a listed id', { githubId: 42 }, false],
])('the id %s is operator: %s', (_label, githubId, operator) => {
  expect(isOperator(githubId, policy)).toBe(operator);
});

test('the owner that is a user operates the instance when the variable is unset, and nobody else does', () => {
  const byDefault = createOperatorPolicy(undefined, USER_OWNER);
  expect([isOperator(9001, byDefault), isOperator(42, byDefault), isOperator('9001', byDefault)]).toEqual([
    true,
    false,
    false,
  ]);
});

test('an instance with no operator refuses every id, a numeric one and a string one alike', () => {
  const nobody = createOperatorPolicy(undefined, ORG_OWNER);
  expect([isOperator(9001, nobody), isOperator(1, nobody), isOperator('*', nobody)]).toEqual([false, false, false]);
});
