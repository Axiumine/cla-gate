// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { EvaluationRowMissingError } from '../../adapters/db/pr-evaluation-links.ts';
import { foreignRun } from '../github-check-contract/test-support.ts';
import { commitSha } from '../github-pull-contract/test-support.ts';
import { GitHubRateLimitedError } from '../ports/github-errors.ts';
import { createCheckRunReporter } from './create-check-run-reporter.ts';
import { APP, BASE_URL, FULL_NAME, HEAD, INSTALLATION, NAMES, PASSING, reportingWorld, START } from './test-support.ts';

// `EvaluationReporter.started` (E09-S05): the Check Run of the head SHA is `in_progress` before the evaluation reads a commit.
// A first call makes the run, a retry after a crash finds it, a finished run stays visible until the verdict replaces it, and a
// person's request to run the check again gets a fresh run.

const methods = (fake: { calls: readonly { method: string }[] }): string[] => fake.calls.map((call) => call.method);

test('with no run on the SHA a run is created in progress, with the row id as its external id, and its id is recorded on the row', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  expect(methods(world.fake)).toEqual(['listCheckRunsForRef', 'createCheckRun']);
  const [stored] = world.fake.checkRuns;
  expect(stored).toMatchObject({
    run: { headSha: HEAD, status: 'in_progress', appId: APP, externalId: String(target.evaluationId) },
    fullName: FULL_NAME,
    write: { status: 'in_progress', title: 'Checking CLA signatures', startedAt: new Date(START) },
  });
  expect(stored?.write?.summary).toBe(
    'Evaluating commit 0000000. This updates automatically. Comment `/recheck` to run it again.',
  );
  expect((await world.rows()).map((row) => [row.id, row.check_run_id, row.result])).toEqual([
    [target.evaluationId, stored?.run.id, 'in_progress'],
  ]);
});

test('the SHA written is the one of the target and the pull request is never asked for', async () => {
  const world = await reportingWorld();
  const other = commitSha(0xfeed);
  const target = await world.evaluation({ headSha: other });
  await world.reporter.started(target);
  expect(world.fake.checkRuns.map((stored) => stored.run.headSha)).toEqual([other]);
  expect(methods(world.fake)).not.toContain('getPullRequest');
});

test('a job retried after a crash between the create and the database write reuses the run that is in progress: there is still one', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  await sql`update pr_evaluations set check_run_id = null`.execute(world.db);
  await world.reporter.started(target);
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(methods(world.fake)).toEqual(['listCheckRunsForRef', 'createCheckRun', 'listCheckRunsForRef']);
  expect((await world.rows()).map((row) => row.check_run_id)).toEqual([world.fake.checkRuns[0]?.run.id]);
});

test('a row that records its run is read by the id, and a run in progress is left untouched with no write to the row', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  const before = await world.rows();
  await world.reporter.started(target);
  expect(methods(world.fake)).toEqual(['listCheckRunsForRef', 'createCheckRun', 'getCheckRun']);
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(await world.rows()).toEqual(before);
});

test('a completed run is left as it is on a pull request event: the previous verdict stays visible, and its id is recorded', async () => {
  const world = await reportingWorld();
  world.fake.addCheckRun(INSTALLATION, FULL_NAME, foreignRun(55, { appId: APP }));
  const target = await world.evaluation();
  await world.reporter.started(target);
  expect(methods(world.fake)).toEqual(['listCheckRunsForRef']);
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(world.fake.checkRuns[0]?.write).toBeNull();
  expect((await world.rows()).map((row) => row.check_run_id)).toEqual([55]);
});

test.each([['check_rerequested'], ['recheck']] as const)(
  'a completed run gets a fresh in progress run when the trigger is %s, and the earlier run is left as it was',
  async (trigger) => {
    const world = await reportingWorld();
    world.fake.addCheckRun(INSTALLATION, FULL_NAME, foreignRun(55, { appId: APP }));
    const target = await world.evaluation({ trigger, checkRunId: 55 });
    await world.reporter.started(target);
    expect(methods(world.fake)).toEqual(['getCheckRun', 'createCheckRun']);
    const [earlier, fresh] = world.fake.checkRuns;
    expect(earlier?.run).toEqual(foreignRun(55, { appId: APP }));
    expect(earlier?.write).toBeNull();
    expect(fresh?.run).toMatchObject({ status: 'in_progress', externalId: String(target.evaluationId) });
    expect((await world.rows()).map((row) => row.check_run_id)).toEqual([fresh?.run.id]);
  },
);

test('a run in progress is reused for a re-run too: asking twice makes one run, not two', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation({ trigger: 'recheck' });
  await world.reporter.started(target);
  await world.reporter.started(target);
  expect(world.fake.checkRuns).toHaveLength(1);
});

test('a run of another App with the same name and the same SHA is not ours: a run is created beside it', async () => {
  const world = await reportingWorld();
  world.fake.addCheckRun(INSTALLATION, FULL_NAME, foreignRun(55, { status: 'in_progress', headSha: HEAD }));
  const target = await world.evaluation();
  await world.reporter.started(target);
  expect(world.fake.checkRuns).toHaveLength(2);
  expect(world.fake.checkRuns[1]?.run.appId).toBe(APP);
});

test('a failure of GitHub reaches the job unchanged and nothing is recorded', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  const limited = new GitHubRateLimitedError(120, 'secondary');
  world.fake.failNext('createCheckRun', limited);
  await expect(world.reporter.started(target)).rejects.toBe(limited);
  expect((await world.rows()).map((row) => row.check_run_id)).toEqual([null]);
});

test('without the row of the pull request nothing is sent to GitHub', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await expect(world.reporter.started({ ...target, prNumber: 8 })).rejects.toBeInstanceOf(EvaluationRowMissingError);
  expect(world.fake.calls).toEqual([]);
});

test('the log has the numeric ids, the head SHA and the run id, and no name, address or text of the report', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  const lines = world.logs.lines().filter((line) => line['msg'] === 'report.started');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({
    githubInstallationId: INSTALLATION,
    githubRepoId: 9000,
    prNumber: 7,
    headSha: HEAD,
    checkRunId: world.fake.checkRuns[0]?.run.id,
  });
  expect(world.logs.text()).not.toMatch(/org-1|Checking CLA|cla\.example/u);
});

test('the factory builds a reporter on a writer for the App, the clock and the logger it is given', async () => {
  const world = await reportingWorld();
  const reporter = createCheckRunReporter({
    db: world.db,
    github: world.fake,
    appId: APP,
    publicBaseUrl: BASE_URL,
    clock: world.clock,
    logger: world.logger,
  });
  const target = await world.evaluation();
  await reporter.started(target);
  await reporter.publish(target, PASSING, NAMES);
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(world.fake.checkRuns[0]?.run).toMatchObject({ appId: APP, status: 'completed' });
  expect(world.fake.checkRuns[0]?.write?.completedAt).toEqual(new Date(START));
});
