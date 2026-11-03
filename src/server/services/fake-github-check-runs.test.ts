// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { foreignRun, PASSED, STARTED } from './github-check-contract/test-support.ts';
import { id, installation, repository } from './github-contract/test-support.ts';
import { commitSha } from './github-pull-contract/test-support.ts';
import { GitHubNotFoundError, GitHubUnavailableError } from './ports/github-errors.ts';
import { FakeGitHub } from './test-support.ts';

// The Check Run half of `FakeGitHub` (E09-S05) beyond the contract: what a test reads back of the writes, how the App that
// posts is chosen and how the scripted failures and hooks reach the new calls.

const ACME = 'acme/api';

function world(): FakeGitHub {
  const fake = new FakeGitHub();
  fake.addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
  return fake;
}

test('the runs of the world keep the last write each was given, and a seeded run has none', async () => {
  const fake = world();
  fake.addCheckRun(id(11), ACME, foreignRun(55));
  const run = await fake.createCheckRun(id(11), ACME, commitSha(2), STARTED);
  await fake.updateCheckRun(id(11), ACME, run.id, { ...PASSED, text: 'details', detailsUrl: 'https://example.org/x' });
  expect(fake.checkRuns.map((stored) => [stored.run.id, stored.installationId, stored.fullName, stored.write])).toEqual(
    [
      [55, 11, ACME, null],
      [run.id, 11, ACME, { ...PASSED, text: 'details', detailsUrl: 'https://example.org/x' }],
    ],
  );
});

test('every write is kept in order with the id of the run it reached, which the run itself forgets once the next write replaces it', async () => {
  const fake = world();
  const run = await fake.createCheckRun(id(11), ACME, commitSha(2), STARTED);
  const other = await fake.createCheckRun(id(11), ACME, commitSha(2), STARTED);
  await fake.updateCheckRun(id(11), ACME, run.id, PASSED);
  await expect(fake.updateCheckRun(id(11), ACME, id(1), PASSED)).rejects.toBeInstanceOf(GitHubNotFoundError);
  expect(fake.checkRunWrites).toEqual([
    { kind: 'create', id: run.id, write: STARTED },
    { kind: 'create', id: other.id, write: STARTED },
    { kind: 'update', id: run.id, write: PASSED },
  ]);
  expect(fake.checkRuns[0]?.write).toEqual(PASSED);
});

test('every run the fake posts has its own id and the id of the App the fake stands for', async () => {
  const fake = world();
  const first = await fake.createCheckRun(id(11), ACME, commitSha(2), STARTED);
  fake.setApp({ ...(await fake.getApp()), id: id(4343) });
  const second = await fake.createCheckRun(id(11), ACME, commitSha(2), STARTED);
  expect([first.appId, second.appId]).toEqual([4242, 4343]);
  expect(second.id).toBeGreaterThan(first.id);
});

test('an update changes the state and the external id of a run and leaves its commit and App', async () => {
  const fake = world();
  const run = await fake.createCheckRun(id(11), ACME, commitSha(2), STARTED);
  const updated = await fake.updateCheckRun(id(11), ACME, run.id, PASSED);
  expect(updated).toEqual({ ...run, status: 'completed' });
});

test.each([
  ['createCheckRun', (fake: FakeGitHub) => fake.createCheckRun(id(11), ACME, commitSha(2), STARTED)],
  ['updateCheckRun', (fake: FakeGitHub) => fake.updateCheckRun(id(11), ACME, id(1), PASSED)],
  ['getCheckRun', (fake: FakeGitHub) => fake.getCheckRun(id(11), ACME, id(1))],
  ['listCheckRunsForRef', (fake: FakeGitHub) => fake.listCheckRunsForRef(id(11), ACME, commitSha(2))],
] as const)(
  '%s is recorded with the installation, can be scripted to fail once and waits for a hook',
  async (method, call) => {
    const fake = world();
    const outage = new GitHubUnavailableError('down');
    const hooked: string[] = [];
    fake.failNext(method, outage);
    fake.beforeNext(method, () => {
      hooked.push(method);
      return Promise.resolve();
    });
    await expect(call(fake)).rejects.toBe(outage);
    expect(hooked).toEqual([method]);
    expect(fake.calls).toEqual([{ method, installationId: 11 }]);
  },
);
