// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { createLogger } from '../adapters/http/logger.ts';
import { captureLogs } from '../test-support.ts';
import { createAdmissionPolicies } from './admission-policies.ts';

const id = parseGithubId;

function policiesOf(configured: number[], ownerAccountId: () => Promise<ReturnType<typeof id>>) {
  const logs = captureLogs();
  const logger = createLogger({ logLevel: 'info' }, logs.destination);
  return {
    policies: createAdmissionPolicies({ configured: configured.map((account) => id(account)), ownerAccountId, logger }),
    logs,
  };
}

const policyLines = (lines: Record<string, unknown>[]) =>
  lines.filter((line) => line['msg'] === 'github.admission_policy');

test('the effective policy is the configured ids plus the App owner', async () => {
  const { policies } = policiesOf([42, 77], () => Promise.resolve(id(9001)));
  expect([...(await policies.current()).accountIds].sort((a, b) => a - b)).toEqual([42, 77, 9001]);
});

test('with nothing configured the owner account alone is served', async () => {
  const { policies } = policiesOf([], () => Promise.resolve(id(9001)));
  expect([...(await policies.current()).accountIds]).toEqual([9001]);
});

test('the effective ids are logged once, ascending, however often the policy is read', async () => {
  const { policies, logs } = policiesOf([77, 42], () => Promise.resolve(id(9001)));
  await Promise.all([policies.current(), policies.current(), policies.current()]);
  await policies.current();
  const lines = policyLines(logs.lines());
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ level: 30, accountIds: [42, 77, 9001] });
});

test('the owner is asked for once: concurrent and later callers share the answer', async () => {
  let asked = 0;
  const { policies } = policiesOf([], async () => {
    asked += 1;
    await Promise.resolve();
    return id(9001);
  });
  const [first, second] = await Promise.all([policies.current(), policies.current()]);
  expect(first).toBe(second);
  expect(await policies.current()).toBe(first);
  expect(asked).toBe(1);
});

test('a failure to learn the owner is passed on and not kept: the next call asks again and nothing is logged before', async () => {
  let attempts = 0;
  const { policies, logs } = policiesOf([42], () => {
    attempts += 1;
    return attempts === 1 ? Promise.reject(new Error('GitHub is down')) : Promise.resolve(id(9001));
  });
  await expect(policies.current()).rejects.toThrow('GitHub is down');
  expect(policyLines(logs.lines())).toEqual([]);
  expect([...(await policies.current()).accountIds].sort((a, b) => a - b)).toEqual([42, 9001]);
  expect(attempts).toBe(2);
  expect(policyLines(logs.lines())).toHaveLength(1);
});
