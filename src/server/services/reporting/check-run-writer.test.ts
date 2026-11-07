// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { createLogger } from '../../adapters/http/logger.ts';
import { captureLogs } from '../../test-support.ts';
import { foreignRun } from '../github-check-contract/test-support.ts';
import { commitSha } from '../github-pull-contract/test-support.ts';
import type { GitHubCheckRun } from '../ports/github.ts';
import {
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubUnavailableError,
  GitHubUnprocessableError,
} from '../ports/github-errors.ts';
import { FakeClock, FakeGitHub } from '../test-support.ts';
import { CheckRunWriter, type RunLocator } from './check-run-writer.ts';
import { APP, BASE_URL, FULL_NAME, INSTALLATION, REPOSITORY, START } from './test-support.ts';

// The writer of the Check Run of a head SHA (E09-S05) on its own: no pull request, no database, a FakeGitHub. It finds the run
// of this App, updates it or creates one, and tells a run it may touch from a run of the same name that is somebody else's.

const SHA = commitSha(2);
const LOCATOR: RunLocator = { githubInstallationId: INSTALLATION, owner: 'org-1', repo: 'repo', headSha: SHA };
const IN_PROGRESS = { kind: 'in_progress', headSha: SHA } as const;
const SUCCESS = {
  kind: 'success',
  headSha: SHA,
  covered: { signature: 1, allowlist: 0, corporate: 0, override: 0 },
} as const;

function world() {
  const fake = new FakeGitHub();
  fake.addInstallation(
    {
      id: INSTALLATION,
      account: { id: parseGithubId(7000), login: 'org-1', type: 'Organization' },
      suspendedAt: null,
      permissions: {},
    },
    [{ id: REPOSITORY, fullName: FULL_NAME }],
  );
  const logs = captureLogs();
  const writer = new CheckRunWriter({
    github: fake,
    appId: APP,
    clock: new FakeClock(START),
    logger: createLogger({ logLevel: 'info' }, logs.destination),
  });
  return { fake, writer, logs };
}

/** One of our own runs, as the world holds them: on `SHA`, of this App. */
const ours = (id: number, overrides: Partial<GitHubCheckRun> = {}): GitHubCheckRun =>
  foreignRun(id, { appId: APP, status: 'in_progress', ...overrides });

/** The fields pino adds to every line of its own accord. */
const PINO = new Set(['level', 'time', 'pid', 'hostname', 'v']);

const methods = (fake: FakeGitHub): string[] => fake.calls.map((call) => call.method);

test('with no run on the commit a new one is created with the view, the times, the external id and the details link', async () => {
  const { fake, writer } = world();
  const { checkRunId } = await writer.upsert({ ...LOCATOR, view: IN_PROGRESS, externalId: '17' });
  expect(methods(fake)).toEqual(['listCheckRunsForRef', 'createCheckRun']);
  expect(fake.checkRuns).toHaveLength(1);
  expect(fake.checkRuns[0]).toMatchObject({
    run: { id: checkRunId, headSha: SHA, status: 'in_progress', appId: APP, externalId: '17' },
    fullName: FULL_NAME,
    write: {
      status: 'in_progress',
      title: 'Checking CLA signatures',
      startedAt: new Date(START),
      externalId: '17',
    },
  });
  expect(fake.checkRuns[0]?.write).not.toHaveProperty('completedAt');
  expect(fake.checkRuns[0]?.write).not.toHaveProperty('detailsUrl');
});

test('a view that is completed is written with its conclusion, the time it ended and the details link, and no start time', async () => {
  const { fake, writer } = world();
  await writer.upsert({ ...LOCATOR, view: SUCCESS, detailsUrl: `${BASE_URL}/sign/9000?pr=7` });
  expect(fake.checkRuns[0]?.write).toMatchObject({
    status: 'completed',
    conclusion: 'success',
    title: 'CLA check passed',
    completedAt: new Date(START),
    detailsUrl: `${BASE_URL}/sign/9000?pr=7`,
  });
  expect(fake.checkRuns[0]?.write).not.toHaveProperty('startedAt');
  expect(fake.checkRuns[0]?.write).not.toHaveProperty('externalId');
});

test('the run of this App is updated, not duplicated, and its id is returned', async () => {
  const { fake, writer } = world();
  fake.addCheckRun(INSTALLATION, FULL_NAME, ours(10));
  const { checkRunId } = await writer.upsert({ ...LOCATOR, view: SUCCESS });
  expect(checkRunId).toBe(10);
  expect(methods(fake)).toEqual(['listCheckRunsForRef', 'updateCheckRun']);
  expect(fake.checkRuns).toHaveLength(1);
  expect(fake.checkRuns[0]?.run.status).toBe('completed');
});

test('of the runs the listing holds the one of this App is updated, and the runs of another App with the same name are never touched', async () => {
  const { fake, writer } = world();
  fake.addCheckRun(INSTALLATION, FULL_NAME, ours(12));
  fake.addCheckRun(INSTALLATION, FULL_NAME, ours(10, { appId: parseGithubId(77) }));
  fake.addCheckRun(INSTALLATION, FULL_NAME, foreignRun(99));
  const found = await writer.find(LOCATOR);
  expect(found?.id).toBe(12);
  await writer.upsert({ ...LOCATOR, view: SUCCESS });
  expect(fake.checkRuns.map((stored) => [stored.run.id, stored.write === null])).toEqual([
    [12, false],
    [10, true],
    [99, true],
  ]);
});

test('a run of another App with the same name does not count: a new run is created beside it', async () => {
  const { fake, writer } = world();
  fake.addCheckRun(INSTALLATION, FULL_NAME, foreignRun(99, { status: 'in_progress' }));
  expect(await writer.find(LOCATOR)).toBeNull();
  const { checkRunId } = await writer.upsert({ ...LOCATOR, view: IN_PROGRESS });
  expect(checkRunId).not.toBe(99);
  expect(fake.checkRuns.map((stored) => stored.run.id)).toEqual([99, checkRunId]);
});

test('a supplied run id is read by its id, with no listing, and updated', async () => {
  const { fake, writer } = world();
  fake.addCheckRun(INSTALLATION, FULL_NAME, ours(10));
  fake.addCheckRun(INSTALLATION, FULL_NAME, ours(12));
  const { checkRunId } = await writer.upsert({ ...LOCATOR, existingId: parseGithubId(10), view: SUCCESS });
  expect(checkRunId).toBe(10);
  expect(methods(fake)).toEqual(['getCheckRun', 'updateCheckRun']);
});

test.each([
  ['one that does not exist', parseGithubId(404), undefined],
  ['one of another App', parseGithubId(99), foreignRun(99)],
  ['one on another commit', parseGithubId(98), ours(98, { headSha: commitSha(3) })],
])(
  'a supplied run id of %s means there is no run: a new one is created with no listing',
  async (_name, existingId, seeded) => {
    const { fake, writer } = world();
    if (seeded !== undefined) {
      fake.addCheckRun(INSTALLATION, FULL_NAME, seeded);
    }
    const { checkRunId } = await writer.upsert({ ...LOCATOR, existingId, view: SUCCESS });
    expect(checkRunId).not.toBe(existingId);
    expect(methods(fake)).toEqual(['getCheckRun', 'createCheckRun']);
  },
);

test('a new run is created without a lookup when one is asked for, and the run that was there is left as it is', async () => {
  const { fake, writer } = world();
  fake.addCheckRun(INSTALLATION, FULL_NAME, ours(10, { status: 'completed' }));
  const { checkRunId } = await writer.upsert({ ...LOCATOR, view: IN_PROGRESS, forceNew: true });
  expect(methods(fake)).toEqual(['createCheckRun']);
  expect(fake.checkRuns.map((stored) => [stored.run.id, stored.run.status])).toEqual([
    [10, 'completed'],
    [checkRunId, 'in_progress'],
  ]);
});

test.each([
  ['404', new GitHubNotFoundError('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}'), 404],
  ['422', new GitHubUnprocessableError('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}'), 422],
])(
  'a PATCH answered %s falls back to a new run and says so with the status code',
  async (_name, refusal, statusCode) => {
    const { fake, writer, logs } = world();
    fake.addCheckRun(INSTALLATION, FULL_NAME, ours(10));
    fake.failNext('updateCheckRun', refusal);
    const { checkRunId } = await writer.upsert({ ...LOCATOR, view: SUCCESS });
    expect(checkRunId).not.toBe(10);
    expect(methods(fake)).toEqual(['listCheckRunsForRef', 'updateCheckRun', 'createCheckRun']);
    const recreated = logs.lines().find((line) => line['msg'] === 'report.check_run_recreated');
    expect(recreated).toMatchObject({ githubInstallationId: INSTALLATION, headSha: SHA, checkRunId: 10, statusCode });
  },
);

test.each([
  ['a rate limit', new GitHubRateLimitedError(120, 'secondary')],
  ['an outage', new GitHubUnavailableError('down')],
  ['a refusal of the permission', new GitHubForbiddenError('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}')],
])('a PATCH that fails with %s is rethrown unchanged and no run is created', async (_name, failure) => {
  const { fake, writer } = world();
  fake.addCheckRun(INSTALLATION, FULL_NAME, ours(10));
  fake.failNext('updateCheckRun', failure);
  await expect(writer.upsert({ ...LOCATOR, view: SUCCESS })).rejects.toBe(failure);
  expect(methods(fake)).toEqual(['listCheckRunsForRef', 'updateCheckRun']);
});

test.each([
  ['listCheckRunsForRef', new GitHubUnavailableError('down')],
  ['createCheckRun', new GitHubForbiddenError('POST /repos/{owner}/{repo}/check-runs')],
] as const)('a failure of %s reaches the caller unchanged', async (method, failure) => {
  const { fake, writer } = world();
  fake.failNext(method, failure);
  await expect(writer.upsert({ ...LOCATOR, view: SUCCESS })).rejects.toBe(failure);
});

test('the log has the installation id, the head SHA, the run id and the state, and nothing else', async () => {
  const { fake, writer, logs } = world();
  fake.addCheckRun(INSTALLATION, FULL_NAME, ours(10));
  await writer.upsert({ ...LOCATOR, view: SUCCESS, detailsUrl: `${BASE_URL}/sign/9000?pr=7`, externalId: '17' });
  fake.failNext('updateCheckRun', new GitHubNotFoundError('PATCH'));
  await writer.upsert({ ...LOCATOR, view: SUCCESS });
  const lines = logs.lines().map((line) => Object.fromEntries(Object.entries(line).filter(([key]) => !PINO.has(key))));
  const created = fake.checkRuns.at(-1)?.run.id;
  expect(lines).toEqual([
    {
      msg: 'report.check_run_updated',
      githubInstallationId: INSTALLATION,
      headSha: SHA,
      checkRunId: 10,
      status: 'completed',
    },
    {
      msg: 'report.check_run_recreated',
      githubInstallationId: INSTALLATION,
      headSha: SHA,
      checkRunId: 10,
      statusCode: 404,
    },
    {
      msg: 'report.check_run_created',
      githubInstallationId: INSTALLATION,
      headSha: SHA,
      checkRunId: created,
    },
  ]);
  expect(logs.text()).not.toContain(BASE_URL);
  expect(logs.text()).not.toContain('org-1');
});

test('a run the caller has just found is updated without a second lookup, and forceNew still posts a new one', async () => {
  const { fake, writer } = world();
  fake.addCheckRun(INSTALLATION, FULL_NAME, ours(55));
  const known = await writer.find(LOCATOR);
  expect(known).toMatchObject({ id: 55 });
  const before = fake.calls.length;
  const { checkRunId } = await writer.upsert({ ...LOCATOR, known: known ?? ours(1), view: SUCCESS });
  expect(checkRunId).toBe(55);
  expect(methods(fake).slice(before)).toEqual(['updateCheckRun']);
  const fresh = await writer.upsert({ ...LOCATOR, known: known ?? ours(1), view: SUCCESS, forceNew: true });
  expect(fresh.checkRunId).not.toBe(55);
  expect(methods(fake).slice(before)).toEqual(['updateCheckRun', 'createCheckRun']);
});

test('the minimal output of a failure is written instead of the full one: the counts and the hint, no sections, no text', async () => {
  const { fake, writer } = world();
  const view = {
    kind: 'failure',
    headSha: SHA,
    unsigned: 2,
    unlinked: 1,
    summary: [{ kind: 'text', text: 'A section with a name.' }],
    text: [{ kind: 'text', text: 'More names.' }],
  } as const;
  await writer.upsert({ ...LOCATOR, view, minimal: true });
  expect(fake.checkRuns[0]?.write).toEqual({
    status: 'completed',
    conclusion: 'failure',
    title: 'CLA signature required: 2 unsigned, 1 unlinked',
    summary:
      'The CLA check did not pass for commit 0000000 (2 unsigned, 1 unlinked). The details could not be shown here. Comment `/recheck` to run it again.',
    completedAt: new Date(START),
  });
  await writer.upsert({ ...LOCATOR, view });
  expect(fake.checkRuns[0]?.write?.summary).toBe('A section with a name.');
  expect(fake.checkRuns[0]?.write?.text).toBe('More names.');
});
