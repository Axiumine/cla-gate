// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { foreignRun } from '../github-check-contract/test-support.ts';
import {
  APP,
  FAILING,
  FULL_NAME,
  HEAD,
  INSTALLATION,
  NAMES,
  PASSING,
  reportingWorld,
  withoutTrigger,
} from './test-support.ts';

// `EvaluationReporter.failed` and `cancelled` (E09-S06): a check never stays `in_progress` for good. `failed` ends the run
// `failure` with the sentence that sends the contributor to `/recheck`; `cancelled` ends a run that is still running and leaves a
// finished one alone. Neither writes a comment or a column of `pr_evaluations`.

const methods = (fake: { calls: readonly { method: string }[] }): string[] => fake.calls.map((call) => call.method);

const FAILED_SUMMARY = 'Something went wrong while checking this pull request. Comment `/recheck` to try again.';

test('failed completes the run that started with the failure conclusion, the fixed title and the fixed summary', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  expect(await world.reporter.failed(target, 'evaluation_failed')).toEqual({ status: 'reported' });
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(world.fake.checkRuns[0]?.run).toMatchObject({ status: 'completed', headSha: HEAD, appId: APP });
  expect(world.fake.checkRuns[0]?.write).toEqual({
    status: 'completed',
    conclusion: 'failure',
    title: 'CLA check could not complete',
    summary: FAILED_SUMMARY,
    completedAt: new Date('2026-11-02T10:00:00Z'),
    externalId: String(target.evaluationId),
  });
});

test('failed writes no comment and no column: the rows are what they were and no comment call is made', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  const before = await world.rows();
  const calls = world.fake.calls.length;
  await world.reporter.failed(target, 'evaluation_failed');
  expect(await world.rows()).toEqual(before);
  expect(methods(world.fake).slice(calls)).toEqual(['getCheckRun', 'updateCheckRun']);
});

test('failed with no run on the SHA creates one that is already completed, and records no id on the row', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.failed(target, 'evaluation_failed');
  expect(methods(world.fake)).toEqual(['listCheckRunsForRef', 'createCheckRun']);
  expect(world.fake.checkRuns[0]?.run).toMatchObject({ status: 'completed' });
  expect(world.fake.checkRuns[0]?.write).toMatchObject({
    conclusion: 'failure',
    title: 'CLA check could not complete',
  });
  expect((await world.rows()).map((row) => row.check_run_id)).toEqual([null]);
});

test('failed overwrites the verdict of a run that was completed, and does not open a second run for /recheck', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation({ trigger: 'recheck' });
  await world.reporter.started(target);
  await world.reporter.publish(target, PASSING, NAMES);
  await world.reporter.failed(target, 'evaluation_failed');
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(world.fake.checkRuns[0]?.write).toMatchObject({
    conclusion: 'failure',
    title: 'CLA check could not complete',
  });
});

test('failed twice, as the dead-letter handler does when it is retried, leaves one run with the same output', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  await world.reporter.failed(target, 'evaluation_failed');
  const written = world.fake.checkRuns[0]?.write;
  await world.reporter.failed(target, 'evaluation_failed');
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(world.fake.checkRuns[0]?.write).toEqual(written);
});

test('failed names no one and never asks GitHub for the pull request', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.failed(target, 'evaluation_failed');
  expect(methods(world.fake)).not.toContain('getPullRequest');
  expect(world.logs.text()).not.toMatch(/octocat|org-1/u);
});

test('cancelled completes a run that is still in progress with the cancelled conclusion and the fixed words', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  expect(await world.reporter.cancelled(withoutTrigger(target))).toEqual({ status: 'reported' });
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(world.fake.checkRuns[0]?.run).toMatchObject({ status: 'completed', headSha: HEAD });
  expect(world.fake.checkRuns[0]?.write).toEqual({
    status: 'completed',
    conclusion: 'cancelled',
    title: 'CLA check cancelled',
    summary: 'This pull request was closed before the check finished.',
    completedAt: new Date('2026-11-02T10:00:00Z'),
    externalId: String(target.evaluationId),
  });
});

test('cancelled finds the run through one lookup and writes it once, with no comment and no column', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  const before = await world.rows();
  const calls = world.fake.calls.length;
  await world.reporter.cancelled(withoutTrigger(target));
  expect(methods(world.fake).slice(calls)).toEqual(['getCheckRun', 'updateCheckRun']);
  expect(await world.rows()).toEqual(before);
});

test('cancelled leaves a run that is completed as it is: the verdict stays and nothing is written', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation({ result: 'success' });
  await world.reporter.started(target);
  await world.reporter.publish(target, FAILING, NAMES);
  const written = world.fake.checkRuns[0]?.write;
  const calls = world.fake.calls.length;
  expect(await world.reporter.cancelled(withoutTrigger(target))).toEqual({ status: 'reported' });
  expect(world.fake.checkRuns[0]?.write).toBe(written);
  expect(methods(world.fake).slice(calls)).toEqual(['getCheckRun']);
  expect(world.logs.lines().filter((line) => line['msg'] === 'report.cancel_not_needed')).toMatchObject([
    { githubInstallationId: INSTALLATION, githubRepoId: 9000, prNumber: 7, headSha: HEAD, checkRunId: 9_000_001 },
  ]);
});

test('cancelled finds a run of this App on the SHA that the row does not record, and a SHA with no run gets none', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.cancelled(withoutTrigger(target));
  expect(world.fake.checkRuns).toEqual([]);
  expect(world.logs.lines().filter((line) => line['msg'] === 'report.cancel_not_needed')).toMatchObject([
    { prNumber: 7, headSha: HEAD, checkRunId: null },
  ]);
  world.fake.addCheckRun(INSTALLATION, FULL_NAME, foreignRun(55, { appId: APP, status: 'in_progress' }));
  await world.reporter.cancelled(withoutTrigger(target));
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(world.fake.checkRuns[0]?.run).toMatchObject({ id: 55, status: 'completed' });
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'cancelled' });
});

test('cancelled does not touch the run of another App that is still running', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  world.fake.addCheckRun(INSTALLATION, FULL_NAME, foreignRun(55, { status: 'in_progress' }));
  await world.reporter.cancelled(withoutTrigger(target));
  expect(world.fake.checkRuns[0]?.run).toMatchObject({ id: 55, status: 'in_progress' });
  expect(world.fake.checkRuns[0]?.write).toBeNull();
  expect(methods(world.fake)).toEqual(['listCheckRunsForRef']);
});

test('cancelled twice, as the close-pr job does when it is retried, changes nothing the second time', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  await world.reporter.cancelled(withoutTrigger(target));
  const written = world.fake.checkRuns[0]?.write;
  await world.reporter.cancelled(withoutTrigger(target));
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(world.fake.checkRuns[0]?.write).toBe(written);
});

test('the log of the endings has the numeric ids, the head SHA and the run id, and nothing a person wrote', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  await world.reporter.cancelled(withoutTrigger(target));
  await world.reporter.failed(target, 'evaluation_failed');
  const runId = world.fake.checkRuns[0]?.run.id;
  const ours = ['report.cancelled', 'report.failed'];
  expect(world.logs.lines().filter((line) => ours.includes(String(line['msg'])))).toMatchObject([
    {
      msg: 'report.cancelled',
      githubInstallationId: INSTALLATION,
      githubRepoId: 9000,
      prNumber: 7,
      headSha: HEAD,
      checkRunId: runId,
    },
    {
      msg: 'report.failed',
      githubInstallationId: INSTALLATION,
      githubRepoId: 9000,
      prNumber: 7,
      headSha: HEAD,
      checkRunId: runId,
    },
  ]);
  expect(world.logs.text()).not.toMatch(/octocat|org-1|CLA/u);
});
