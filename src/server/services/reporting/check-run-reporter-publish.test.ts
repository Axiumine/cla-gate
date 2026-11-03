// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { EvaluationRowMissingError } from '../../adapters/db/pr-evaluation-links.ts';
import { recording } from '../../adapters/db/pr-evaluation-links-fixture/test-support.ts';
import { migratedTestDatabase } from '../../adapters/db/test-support.ts';
import { renderName } from '../../domain/reporting/encode.ts';
import { HOSTILE_ROWS } from '../../domain/reporting/test-support.ts';
import { foreignRun } from '../github-check-contract/test-support.ts';
import { GitHubNotFoundError, GitHubUnprocessableError } from '../ports/github-errors.ts';
import {
  APP,
  BASE_URL,
  FAILING,
  FULL_NAME,
  HEAD,
  INSTALLATION,
  NAMES,
  PASSING,
  reportingWorld,
  START,
} from './test-support.ts';

// `EvaluationReporter.publish` (E09-S05): the verdict goes to the Check Run the row records, completed, with the output of
// E09-S02 and E09-S03 and the sign link as its details link; with no run recorded, one is created already completed; a run that
// GitHub refuses to update is replaced; and a second publish changes nothing.

const methods = (fake: { calls: readonly { method: string }[] }): string[] => fake.calls.map((call) => call.method);

test('a passing verdict completes the run the row records with the success output, no details link, and changes no other run', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  await world.reporter.publish(target, PASSING, NAMES);
  expect(world.fake.checkRuns).toHaveLength(1);
  const [stored] = world.fake.checkRuns;
  expect(stored?.run).toMatchObject({ status: 'completed', headSha: HEAD, appId: APP });
  expect(stored?.write).toMatchObject({
    status: 'completed',
    conclusion: 'success',
    title: 'CLA check passed',
    summary: '1 contributor covered: 1 by signature.\n\nChecked commit 0000000.',
    completedAt: new Date(START),
    externalId: String(target.evaluationId),
  });
  expect(stored?.write).not.toHaveProperty('detailsUrl');
  expect(stored?.write).not.toHaveProperty('text');
  expect(methods(world.fake)).toEqual([
    'listCheckRunsForRef',
    'createCheckRun',
    'getCheckRun',
    'updateCheckRun',
    'listIssueComments',
  ]);
});

test('a failing verdict completes the run as a failure with the names, the fix and the sign link as the details link', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  await world.reporter.publish(target, FAILING, NAMES);
  const { write } = world.fake.checkRuns[0] ?? {};
  expect(write).toMatchObject({
    status: 'completed',
    conclusion: 'failure',
    title: 'CLA signature required: 1 unsigned',
    detailsUrl: `${BASE_URL}/sign/9000?pr=7`,
  });
  expect(write?.summary).toContain(`[Sign the CLA](${BASE_URL}/sign/9000?pr=7)`);
  expect(write?.summary).toContain('`octocat` (GitHub id 1): opened the PR, commit author');
});

test('with no run recorded and none on the SHA, the verdict creates a run that is already completed', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.publish(target, PASSING, NAMES);
  expect(methods(world.fake)).toEqual(['listCheckRunsForRef', 'createCheckRun', 'listIssueComments']);
  expect(world.fake.checkRuns[0]?.run).toMatchObject({ status: 'completed', externalId: String(target.evaluationId) });
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'success', completedAt: new Date(START) });
  expect((await world.rows()).map((row) => row.check_run_id)).toEqual([world.fake.checkRuns[0]?.run.id]);
});

test('with no run recorded and a run of this App on the SHA, the verdict completes that run', async () => {
  const world = await reportingWorld();
  world.fake.addCheckRun(INSTALLATION, FULL_NAME, foreignRun(55, { appId: APP, status: 'in_progress' }));
  const target = await world.evaluation();
  await world.reporter.publish(target, PASSING, NAMES);
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(world.fake.checkRuns[0]?.run).toMatchObject({ id: 55, status: 'completed' });
  expect((await world.rows()).map((row) => row.check_run_id)).toEqual([55]);
});

test.each([
  ['404', new GitHubNotFoundError('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}')],
  ['422', new GitHubUnprocessableError('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}')],
])('a PATCH that GitHub answers %s creates a new completed run and records its id', async (_name, refusal) => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  const earlier = world.fake.checkRuns[0]?.run.id;
  world.fake.failNext('updateCheckRun', refusal);
  await world.reporter.publish(target, PASSING, NAMES);
  expect(world.fake.checkRuns).toHaveLength(2);
  const fresh = world.fake.checkRuns[1];
  expect(fresh?.run).toMatchObject({ status: 'completed', headSha: HEAD });
  expect(fresh?.run.id).not.toBe(earlier);
  expect((await world.rows()).map((row) => row.check_run_id)).toEqual([fresh?.run.id]);
});

test('publishing twice leaves one run, completed with the same output, and the second call changes no column of the row', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  await world.reporter.publish(target, FAILING, NAMES);
  const withoutTime = async () => (await world.rows()).map((row) => ({ ...row, updated_at: null }));
  const first = await withoutTime();
  const written = world.fake.checkRuns[0]?.write;
  await world.reporter.publish(target, FAILING, NAMES);
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(world.fake.checkRuns[0]?.write).toEqual(written);
  expect(await withoutTime()).toEqual(first);
  expect(methods(world.fake).filter((method) => method === 'createCheckRun')).toHaveLength(1);
});

test('the id of the run is stored with one update of the row, and a repeat that finds the same id stores nothing', async () => {
  const { db } = await migratedTestDatabase();
  const traced = recording(db);
  const world = await reportingWorld({ db: traced.db });
  const target = await world.evaluation();
  await world.reporter.started(target);
  const updates = () => traced.sent.filter((statement) => statement.sql.startsWith('update "pr_evaluations"')).length;
  expect(updates()).toBe(1);
  await world.reporter.publish(target, PASSING, NAMES);
  expect(updates()).toBe(1);
});

test('the SHA written is the one of the target, and the pull request is never asked for', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.publish(target, PASSING, NAMES);
  expect(world.fake.checkRuns.map((stored) => stored.run.headSha)).toEqual([target.headSha]);
  expect(methods(world.fake)).not.toContain('getPullRequest');
});

test.each(HOSTILE_ROWS)(
  'a login that is the hostile name %s appears in the Check Run only as the one code span of the encoder',
  async (_label, name) => {
    const world = await reportingWorld();
    const target = await world.evaluation();
    await world.reporter.publish(target, FAILING, { ...NAMES, logins: new Map([[1, name]]) });
    const summary = world.fake.checkRuns[0]?.write?.summary ?? '';
    expect(summary).toContain(`- ${renderName(name)} (GitHub id 1): opened the PR, commit author`);
    expect(summary).not.toContain('<!-- cla-platform');
    expect(world.logs.text()).not.toContain(name.slice(0, 12));
  },
);

test('without the row of the pull request nothing is sent to GitHub', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await expect(world.reporter.publish({ ...target, prNumber: 8 }, PASSING, NAMES)).rejects.toBeInstanceOf(
    EvaluationRowMissingError,
  );
  expect(world.fake.calls).toEqual([]);
});

test('the log of a report has the numeric ids, the head SHA and the run id, and nothing a person wrote', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.publish(target, FAILING, NAMES);
  expect(world.logs.lines().filter((line) => line['msg'] === 'report.published')).toMatchObject([
    {
      githubInstallationId: INSTALLATION,
      githubRepoId: 9000,
      prNumber: 7,
      headSha: HEAD,
      checkRunId: world.fake.checkRuns[0]?.run.id,
    },
  ]);
  expect(world.logs.text()).not.toMatch(/octocat|sign|org-1|CLA/u);
});
