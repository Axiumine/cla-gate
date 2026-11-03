// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { type ClientFixtureOptions, line } from '../../adapters/github/client-fixture/test-support.ts';
import {
  GitHubAuthError,
  GitHubRateLimitedError,
  GitHubUnavailableError,
  InstallationGoneError,
  InstallationNotAdmittedError,
  InstallationSuspendedError,
} from '../ports/github-errors.ts';
import { ReportRejectedError, type ReportSkipReason } from '../ports/reporter.ts';
import { LISTING, POST, refused, scripted } from './scripted-github/test-support.ts';
import { FAILING, HEAD, INSTALLATION, NAMES, PASSING } from './test-support.ts';

// What the reporter does with what GitHub answers (E09-S06), with the Octokit adapter over MSW so that the statuses are real
// ones: a rate limit, an outage and a refused credential leave unchanged for the queue to retry; a repository GitHub does not
// have and an installation that is not served end in a skip; a 403 is a missing permission. The 422 and its minimal retry are
// in check-run-reporter-minimal.test.ts, and every method of the port in check-run-reporter-methods.test.ts.

/** A token provider that fails with `failure`: the installation is not served. */
const tokenFails =
  (failure: Error): NonNullable<ClientFixtureOptions['get']> =>
  () =>
    Promise.reject(failure);

test.each([
  ['GitHubRateLimitedError', { [POST]: refused(429, { 'retry-after': '120' }) }, GitHubRateLimitedError],
  ['GitHubUnavailableError', { [POST]: refused(501) }, GitHubUnavailableError],
  ['GitHubAuthError', { [POST]: refused(401) }, GitHubAuthError],
  [
    'GitHubRateLimitedError on the listing',
    { [LISTING]: refused(429, { 'retry-after': '120' }) },
    GitHubRateLimitedError,
  ],
])(
  '%s is rethrown unchanged, the row records nothing and no log line carries the body',
  async (_name, routes, expected) => {
    const { world, logs } = await scripted(routes);
    const target = await world.evaluation();
    await expect(world.reporter.publish(target, PASSING, NAMES)).rejects.toBeInstanceOf(expected);
    expect((await world.rows()).map((row) => row.check_run_id)).toEqual([null]);
    expect(logs.text() + world.logs.text()).not.toContain('LEAKED');
  },
);

test('a rate limit of 120 seconds surfaces with its 120 seconds, so that the queue decides when to retry', async () => {
  const { world, calls, waits } = await scripted({ [POST]: refused(429, { 'retry-after': '120' }) });
  const target = await world.evaluation();
  const failure = await world.reporter.publish(target, PASSING, NAMES).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(GitHubRateLimitedError);
  expect(failure).toMatchObject({ retryAfterSeconds: 120, scope: 'secondary' });
  expect(waits).toEqual([]);
  expect(calls.map(line)).toHaveLength(2);
});

test.each([
  ['GitHubNotFoundError on the listing of the commit', { [LISTING]: refused(404) }, {}, 'repository_gone'],
  ['GitHubNotFoundError on POST /check-runs', { [POST]: refused(404) }, {}, 'repository_gone'],
  [
    'InstallationSuspendedError',
    {},
    { get: tokenFails(new InstallationSuspendedError(INSTALLATION)) },
    'installation_unavailable',
  ],
  [
    'InstallationGoneError',
    {},
    { get: tokenFails(new InstallationGoneError(INSTALLATION)) },
    'installation_unavailable',
  ],
  [
    'InstallationNotAdmittedError',
    {},
    { get: tokenFails(new InstallationNotAdmittedError('rejected')) },
    'installation_unavailable',
  ],
] as const)(
  '%s ends the report as skipped, is logged by its ids, is not retried and is not thrown',
  async (_name, routes, options, reason: ReportSkipReason) => {
    const { world, calls } = await scripted(routes, options);
    const target = await world.evaluation();
    expect(await world.reporter.publish(target, PASSING, NAMES)).toEqual({ status: 'skipped', reason });
    const requests = calls.map(line);
    expect(new Set(requests).size).toBe(requests.length);
    expect(world.logs.lines().filter((entry) => entry['msg'] === 'report.skipped')).toMatchObject([
      { reason, githubInstallationId: INSTALLATION, githubRepoId: 9000, prNumber: 7, headSha: HEAD },
    ]);
    expect((await world.rows()).map((row) => row.check_run_id)).toEqual([null]);
    expect(world.logs.text()).not.toContain('LEAKED');
  },
);

test('a 403 is a missing permission: it is logged as checks_permission_missing and thrown as a ReportRejectedError with fixed words', async () => {
  const { world, calls } = await scripted({ [POST]: refused(403) });
  const target = await world.evaluation();
  const failure = await world.reporter.publish(target, PASSING, NAMES).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ReportRejectedError);
  expect(failure).toMatchObject({
    name: 'ReportRejectedError',
    rejection: 'checks_permission_missing',
    message: 'GitHub refused the report (checks_permission_missing)',
  });
  expect(world.logs.lines().filter((entry) => entry['msg'] === 'checks_permission_missing')).toMatchObject([
    { level: 50, statusCode: 403, githubInstallationId: INSTALLATION, githubRepoId: 9000, prNumber: 7, headSha: HEAD },
  ]);
  expect(calls.map(line).filter((request) => request.startsWith('POST'))).toHaveLength(1);
  expect(JSON.stringify(failure) + String(failure) + world.logs.text()).not.toContain('LEAKED');
});

test('a hostile name in the verdict never reaches a log line, whatever GitHub answers', async () => {
  const { world } = await scripted({ [POST]: refused(403) });
  const target = await world.evaluation();
  const names = { logins: new Map([[1, '@everyone <script>']]), coAuthors: new Map<string, string[]>() };
  await world.reporter.publish(target, FAILING, names).catch((error: unknown) => error);
  expect(world.logs.text()).not.toMatch(/everyone|script/u);
});
