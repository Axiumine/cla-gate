// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, expect, test, vi } from 'vitest';
import { createLogger } from '../adapters/http/logger.ts';
import { captureLogs } from '../test-support.ts';
import { id, installation } from './github-contract/test-support.ts';
import type { GitHubRepositoryPermission } from './ports/github.ts';
import {
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubResponseError,
  GitHubUnavailableError,
  InstallationGoneError,
  InstallationNotAdmittedError,
  InstallationSuspendedError,
  type NotAdmittedReason,
} from './ports/github-errors.ts';
import { ProbeBudget, ProbeBudgetExhaustedError } from './probe-budget.ts';
import { createRepoAdminLookup, repoAdminFact } from './repo-admin.ts';
import { installationRow, storedRepository, VIEWER, VIEWER_ID } from './role-fixture/test-support.ts';
import { FakeGate, FakeGitHub } from './test-support.ts';

// The repository admin role fact (E11-S03) against the in-memory GitHub of E05-S04. What the real adapter does with each
// answer is in adapters/github/repo-admin-permission.test.ts.

afterEach(() => {
  vi.useRealTimers();
});

/** The lookup over a fake GitHub that serves installation 11 (`acme`) and installation 12 (`globex`). */
function setup() {
  const gate = new FakeGate();
  const fake = new FakeGitHub({ gate });
  fake.addInstallation(installation(11, 'acme'));
  fake.addInstallation(installation(12, 'globex'));
  const logs = captureLogs();
  const lookup = createRepoAdminLookup({ github: fake, log: createLogger({ logLevel: 'info' }, logs.destination) });
  return { fake, gate, logs, lookup };
}

const INSTALLATION = installationRow(11);
const API = storedRepository('acme/api');

const answer = (
  permission: GitHubRepositoryPermission['permission'],
  userId: number = VIEWER_ID,
): GitHubRepositoryPermission => ({ permission, userId: id(userId) });

test.each([
  ['admin with the viewer id', answer('admin'), true],
  ['maintain', answer('maintain'), false],
  ['write', answer('write'), false],
  ['triage', answer('triage'), false],
  ['read', answer('read'), false],
  ['none', answer('none'), false],
  ['admin with the id of someone else (a recycled login)', answer('admin', 777), false],
])('%s gives repository admin %s', async (_name, permission, expected) => {
  const { fake, lookup } = setup();
  fake.addRepositoryPermission(id(11), 'acme/api', 'alice', permission);
  expect(await lookup(INSTALLATION, API, VIEWER)).toBe(expected);
});

test('the owner and the name are repositories.full_name and the handle is the viewer login, and GitHub is asked for installation 11 once', async () => {
  const { fake, lookup } = setup();
  fake.addRepositoryPermission(id(11), 'acme/api', 'alice', answer('admin'));
  expect(await lookup(INSTALLATION, API, VIEWER)).toBe(true);
  expect(fake.calls).toEqual([{ method: 'getRepositoryPermission', installationId: 11 }]);
});

test('no answer at all (a 404) is not an admin', async () => {
  const { lookup } = setup();
  expect(await lookup(INSTALLATION, API, VIEWER)).toBe(false);
});

test.each([
  ['a repository that was renamed since the last sync', storedRepository('acme/api-old-name'), VIEWER],
  ['a repository that moved to another owner since the last sync', storedRepository('old-owner/api'), VIEWER],
  ['a login that was renamed since the last login', API, { githubId: VIEWER_ID, login: 'alice-renamed' }],
])('%s fails closed until the next sync or login', async (_name, stored, viewer) => {
  const { fake, lookup } = setup();
  fake.addRepositoryPermission(id(11), 'acme/api', 'alice', answer('admin'));
  expect(await lookup(INSTALLATION, stored, viewer)).toBe(false);
});

test('a repository that is removed is never probed, even for someone who is an admin of it', async () => {
  const { fake, lookup } = setup();
  fake.addRepositoryPermission(id(11), 'acme/api', 'alice', answer('admin'));
  expect(await lookup(INSTALLATION, storedRepository('acme/api', new Date('2026-11-01T00:00:00Z')), VIEWER)).toBe(
    false,
  );
  expect(fake.calls).toEqual([]);
});

test.each([
  ['no slash', 'acme'],
  ['a second slash', 'acme/api/extra'],
  ['no owner', '/api'],
  ['no name', 'acme/'],
  ['nothing', ''],
])('a stored name with %s holds no repository: not an admin and no call is made', async (_name, fullName) => {
  const { fake, lookup } = setup();
  fake.addRepositoryPermission(id(11), 'acme/api', 'alice', answer('admin'));
  expect(await lookup(INSTALLATION, storedRepository(fullName), VIEWER)).toBe(false);
  expect(fake.calls).toEqual([]);
});

test('a 403 that is a missing permission is logged with the numeric installation id and is not an admin', async () => {
  const { fake, logs, lookup } = setup();
  fake.addRepositoryPermission(id(11), 'acme/api', 'alice', answer('admin'));
  fake.failNext(
    'getRepositoryPermission',
    new GitHubForbiddenError('GET /repos/{owner}/{repo}/collaborators/{username}/permission'),
  );
  expect(await lookup(INSTALLATION, API, VIEWER)).toBe(false);
  const warnings = logs.lines().filter((line) => line['msg'] === 'repository_permission_missing');
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatchObject({ level: 40, githubInstallationId: 11 });
  expect(logs.text()).not.toMatch(/alice|acme/);
});

test.each([
  ['a rate limit', new GitHubRateLimitedError(30, 'primary')],
  ['an outage', new GitHubUnavailableError('GitHub could not be reached')],
  ['a refused App credential', new GitHubAuthError()],
  [
    'an answer that is not what the schema says',
    new GitHubResponseError('GET /repos/{owner}/{repo}/collaborators/{username}/permission', ['permission']),
  ],
  ['an unexpected 404', new GitHubNotFoundError('GET /repos/{owner}/{repo}/collaborators/{username}/permission')],
  ['an installation GitHub no longer has', new InstallationGoneError(id(11))],
  ['a suspension GitHub reports', new InstallationSuspendedError(id(11))],
])('%s is thrown, never read as an answer, and logs nothing', async (_name, failure) => {
  const { fake, logs, lookup } = setup();
  fake.addRepositoryPermission(id(11), 'acme/api', 'alice', answer('admin'));
  fake.failNext('getRepositoryPermission', failure);
  await expect(lookup(INSTALLATION, API, VIEWER)).rejects.toBe(failure);
  expect(logs.text()).toBe('');
});

test.each<NotAdmittedReason>(['rejected', 'deleted', 'suspended', 'unknown', 'not_wired'])(
  'an installation the gate refuses (%s) throws before GitHub is asked',
  async (reason) => {
    const { fake, gate, lookup } = setup();
    fake.addRepositoryPermission(id(11), 'acme/api', 'alice', answer('admin'));
    gate.refuse(id(11), reason);
    await expect(lookup(INSTALLATION, API, VIEWER)).rejects.toEqual(new InstallationNotAdmittedError(reason));
    expect(fake.calls).toEqual([]);
  },
);

test('a lookup that takes longer than 5 s is an outage, at the exact boundary', async () => {
  vi.useFakeTimers();
  const { fake, lookup } = setup();
  fake.addRepositoryPermission(id(11), 'acme/api', 'alice', answer('admin'));
  fake.beforeNext('getRepositoryPermission', () => new Promise<void>(() => undefined));
  let outcome: unknown = 'pending';
  const running = lookup(INSTALLATION, API, VIEWER).then(
    (admin) => {
      outcome = admin;
    },
    (failure: unknown) => {
      outcome = failure;
    },
  );
  await vi.advanceTimersByTimeAsync(4999);
  expect(outcome).toBe('pending');
  await vi.advanceTimersByTimeAsync(1);
  await running;
  expect(outcome).toBeInstanceOf(GitHubUnavailableError);
});

test('the same viewer is admin of a repository of one installation and a writer on another: each lookup asks its own installation', async () => {
  const { fake, lookup } = setup();
  fake.addRepositoryPermission(id(11), 'acme/api', 'alice', answer('admin'));
  fake.addRepositoryPermission(id(12), 'globex/api', 'alice', answer('write'));
  expect(await lookup(installationRow(11), storedRepository('acme/api'), VIEWER)).toBe(true);
  expect(await lookup(installationRow(12), storedRepository('globex/api'), VIEWER)).toBe(false);
  expect(fake.calls.map((call) => call.installationId)).toEqual([11, 12]);
});

test('an admin of a repository of installation 11 is no admin of a repository of the same name under installation 12', async () => {
  const { fake, lookup } = setup();
  fake.addRepositoryPermission(id(11), 'acme/api', 'alice', answer('admin'));
  expect(await lookup(installationRow(12), API, VIEWER)).toBe(false);
});

test('a lookup with a budget spends one probe right before GitHub is asked, and none when it asks nothing', async () => {
  const { fake, lookup } = setup();
  fake.addRepositoryPermission(id(11), 'acme/api', 'alice', answer('admin'));
  const budget = new ProbeBudget(5);
  await lookup(INSTALLATION, API, VIEWER, budget);
  await lookup(INSTALLATION, storedRepository('acme/api', new Date('2026-11-01T00:00:00Z')), VIEWER, budget);
  await lookup(INSTALLATION, storedRepository('nonsense'), VIEWER, budget);
  expect([budget.remaining, fake.calls.length]).toEqual([4, 1]);
});

test('a lookup whose budget is empty throws ProbeBudgetExhaustedError and GitHub is not asked', async () => {
  const { fake, lookup } = setup();
  fake.addRepositoryPermission(id(11), 'acme/api', 'alice', answer('admin'));
  await expect(lookup(INSTALLATION, API, VIEWER, new ProbeBudget(0))).rejects.toBeInstanceOf(ProbeBudgetExhaustedError);
  expect(fake.calls).toEqual([]);
});

test('a failed probe has spent its probe: the call was made', async () => {
  const { fake, lookup } = setup();
  fake.failNext('getRepositoryPermission', new GitHubUnavailableError('down'));
  const budget = new ProbeBudget(2);
  await expect(lookup(INSTALLATION, API, VIEWER, budget)).rejects.toBeInstanceOf(GitHubUnavailableError);
  expect(budget.remaining).toBe(1);
});

test('an org admin satisfies any repository requirement: the repository lookup is not called', async () => {
  const lookup = vi.fn(() => Promise.resolve(false));
  expect(await repoAdminFact(true, lookup)).toBe(true);
  expect(lookup).not.toHaveBeenCalled();
});

test.each([
  ['an admin of the repository', true],
  ['someone who is not', false],
])('for anyone who is not an org admin the fact is the answer of the repository lookup: %s', async (_name, found) => {
  const lookup = vi.fn(() => Promise.resolve(found));
  expect(await repoAdminFact(false, lookup)).toBe(found);
  expect(lookup).toHaveBeenCalledTimes(1);
});

test('a failing repository lookup fails the fact for anyone who is not an org admin', async () => {
  const failure = new GitHubUnavailableError('down');
  await expect(repoAdminFact(false, () => Promise.reject(failure))).rejects.toBe(failure);
});
