// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubUnavailableError,
  InstallationGoneError,
  InstallationNotAdmittedError,
  InstallationSuspendedError,
} from '../ports/github-errors.ts';
import type { EvaluationReporter, ReportOutcome, ReportTarget } from '../ports/reporter.ts';
import { INSTALLATION, NAMES, PASSING, reportingWorld, withoutTrigger } from './test-support.ts';

// The error mapping of E09-S06 holds for every method of the port, not only for `publish`: each of the five methods meets the
// same GitHub answers in the same way. The first call each makes is the lookup of the run of the head SHA, which is where the
// FakeGitHub fails them; the statuses on the wire are in check-run-reporter-errors.test.ts.

type Call = (reporter: EvaluationReporter, target: ReportTarget) => Promise<ReportOutcome>;

const METHODS: readonly (readonly [name: string, call: Call])[] = [
  ['started', (reporter, target) => reporter.started(target)],
  ['publish', (reporter, target) => reporter.publish(target, PASSING, NAMES)],
  ['failed', (reporter, target) => reporter.failed(target, 'evaluation_failed')],
  ['cancelled', (reporter, target) => reporter.cancelled(withoutTrigger(target))],
  ['enforcementDisabled', (reporter, target) => reporter.enforcementDisabled(withoutTrigger(target))],
];

/** Every method with each failure of `failures`: `[method, call, label, failure]`. */
function eachMethod(failures: readonly (readonly [label: string, failure: Error])[]) {
  return METHODS.flatMap(([name, call]) => failures.map(([label, failure]) => [name, call, label, failure] as const));
}

test.each(
  eachMethod([
    [
      'a repository GitHub does not have',
      new GitHubNotFoundError('GET /repos/{owner}/{repo}/commits/{ref}/check-runs'),
    ],
  ]),
)(
  '%s: %s is a skipped report with the reason repository_gone, and the row records nothing',
  async (_name, call, _label, failure) => {
    const world = await reportingWorld();
    const target = await world.evaluation();
    world.fake.failNext('listCheckRunsForRef', failure);
    expect(await call(world.reporter, target)).toEqual({ status: 'skipped', reason: 'repository_gone' });
    expect(world.fake.checkRuns).toEqual([]);
    expect((await world.rows()).map((row) => row.check_run_id)).toEqual([null]);
  },
);

test.each(
  eachMethod([
    ['a suspended installation', new InstallationSuspendedError(INSTALLATION)],
    ['an installation that is gone', new InstallationGoneError(INSTALLATION)],
    ['an installation the instance does not admit', new InstallationNotAdmittedError('rejected')],
  ]),
)('%s: %s is a skipped report with the reason installation_unavailable', async (_name, call, _label, failure) => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  world.fake.failNext('listCheckRunsForRef', failure);
  expect(await call(world.reporter, target)).toEqual({ status: 'skipped', reason: 'installation_unavailable' });
  expect(world.fake.checkRuns).toEqual([]);
});

test.each(
  eachMethod([
    ['a rate limit', new GitHubRateLimitedError(120, 'primary')],
    ['an outage', new GitHubUnavailableError('GitHub answered 502 to GET')],
    ['a refused credential', new GitHubAuthError()],
  ]),
)('%s: %s is rethrown as it is', async (_name, call, _label, failure) => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  world.fake.failNext('listCheckRunsForRef', failure);
  await expect(call(world.reporter, target)).rejects.toBe(failure);
  expect(world.fake.checkRuns).toEqual([]);
});

test.each(eachMethod([['a 403', new GitHubForbiddenError('GET /repos/{owner}/{repo}/commits/{ref}/check-runs')]]))(
  '%s: %s is a ReportRejectedError for the missing permission, logged by its ids',
  async (_name, call, _label, failure) => {
    const world = await reportingWorld();
    const target = await world.evaluation();
    world.fake.failNext('listCheckRunsForRef', failure);
    await expect(call(world.reporter, target)).rejects.toMatchObject({
      name: 'ReportRejectedError',
      rejection: 'checks_permission_missing',
    });
    expect(world.logs.lines().filter((line) => line['msg'] === 'checks_permission_missing')).toMatchObject([
      { statusCode: 403, githubInstallationId: INSTALLATION, prNumber: 7 },
    ]);
  },
);
