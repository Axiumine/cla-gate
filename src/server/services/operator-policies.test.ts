// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { createLogger } from '../adapters/http/logger.ts';
import type { AppOwner } from '../domain/operator.ts';
import { effectiveOperatorIds } from '../domain/operator.ts';
import { captureLogs } from '../test-support.ts';
import { createOperatorPolicies } from './operator-policies.ts';

// The effective operator policy (E11-S08): `OPERATOR_GITHUB_IDS` when it is set, else the owner of the App when it is a user.

const id = parseGithubId;
const USER_OWNER: AppOwner = { id: id(9001), type: 'User' };
const ORG_OWNER: AppOwner = { id: id(9001), type: 'Organization' };

function policiesOf(configured: number[] | undefined, owner: (() => Promise<AppOwner>) | undefined) {
  const logs = captureLogs();
  const logger = createLogger({ logLevel: 'info' }, logs.destination);
  return {
    policies: createOperatorPolicies({ configured: configured?.map((operator) => id(operator)), owner, logger }),
    logs,
  };
}

const policyLines = (lines: Record<string, unknown>[]) =>
  lines.filter((line) => line['msg'] === 'github.operator_policy');

const idsOf = async (policies: ReturnType<typeof policiesOf>['policies']) =>
  effectiveOperatorIds(await policies.current());

test.each([
  ['an owner that is a user', USER_OWNER, [9001]],
  ['an owner that is an organisation', ORG_OWNER, []],
])('with the variable unset and %s the operators are %j', async (_label, owner, ids) => {
  const { policies } = policiesOf(undefined, () => Promise.resolve(owner));
  expect(await idsOf(policies)).toEqual(ids);
});

test('with no GitHub App the owner is not known: the variable unset leaves no operator', async () => {
  const { policies } = policiesOf(undefined, undefined);
  expect(await idsOf(policies)).toEqual([]);
});

test('with the variable set the owner is not asked at all, and is not added', async () => {
  let asked = 0;
  const { policies } = policiesOf([77, 42], () => {
    asked += 1;
    return Promise.resolve(USER_OWNER);
  });
  expect(await idsOf(policies)).toEqual([42, 77]);
  expect(asked).toBe(0);
});

test('the effective ids are logged once, ascending, however often the policy is read', async () => {
  const { policies, logs } = policiesOf([77, 42], undefined);
  await Promise.all([policies.current(), policies.current(), policies.current()]);
  await policies.current();
  const lines = policyLines(logs.lines());
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ level: 30, operatorIds: [42, 77] });
});

test('an instance with no operator logs an empty list, so the log says so', async () => {
  const { policies, logs } = policiesOf(undefined, () => Promise.resolve(ORG_OWNER));
  await policies.current();
  expect(policyLines(logs.lines())[0]).toMatchObject({ level: 30, operatorIds: [] });
});

test('the owner is asked for once: concurrent and later callers share the answer', async () => {
  let asked = 0;
  const { policies } = policiesOf(undefined, async () => {
    asked += 1;
    await Promise.resolve();
    return USER_OWNER;
  });
  const [first, second] = await Promise.all([policies.current(), policies.current()]);
  expect(first).toBe(second);
  expect(await policies.current()).toBe(first);
  expect(asked).toBe(1);
});

test('a failure to learn the owner is passed on and not kept: the next call asks again and nothing is logged before', async () => {
  let attempts = 0;
  const { policies, logs } = policiesOf(undefined, () => {
    attempts += 1;
    return attempts === 1 ? Promise.reject(new Error('GitHub is down')) : Promise.resolve(USER_OWNER);
  });
  await expect(policies.current()).rejects.toThrow('GitHub is down');
  expect(policyLines(logs.lines())).toEqual([]);
  expect(await idsOf(policies)).toEqual([9001]);
  expect(attempts).toBe(2);
  expect(policyLines(logs.lines())).toHaveLength(1);
});
