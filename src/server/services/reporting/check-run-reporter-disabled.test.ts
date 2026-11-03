// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { insertEvaluation } from '../../adapters/db/pr-evaluation-links-fixture/test-support.ts';
import { seedTenant } from '../../adapters/db/test-support.ts';
import { ENFORCEMENT_DISABLED_SUMMARY } from '../../domain/reporting/check-output.ts';
import { comment } from '../github-comment-contract/test-support.ts';
import {
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubUnavailableError,
  GitHubUnprocessableError,
} from '../ports/github-errors.ts';
import { FAILING, FULL_NAME, HEAD, INSTALLATION, NAMES, reportingWorld, withoutTrigger } from './test-support.ts';

// `EvaluationReporter.enforcementDisabled` (E09-S06), the method the `finalise-check` job of E14-S04 calls: the Check Run ends
// `neutral` with the fixed sentence, and a pull request comment that exists becomes the one-line notice after the marker. A
// comment that does not exist is not created, a newer head SHA writes the comment instead, and a comment that GitHub refuses
// costs the comment only.

const NOTICE = '<!-- cla-platform:license/cla:v1 -->\nCLA enforcement is disabled for this repository.';
const COMMENT = 5001;
const LATER = new Date('2026-11-02T12:00:00Z');
const EARLIER = new Date('2026-11-02T08:00:00Z');

const methods = (fake: { calls: readonly { method: string }[] }): string[] => fake.calls.map((call) => call.method);

/** A world with pull request 7 at `HEAD` whose row records the comment 5001, which the fake holds with the old text. */
async function commented() {
  const world = await reportingWorld();
  const target = await world.evaluation({ result: 'failure', commentId: COMMENT });
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(COMMENT, { body: 'old text' }));
  return { world, target: withoutTrigger(target) };
}

test('the run ends neutral with the fixed title and the one fixed sentence, whether it was running or finished', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  expect(await world.reporter.enforcementDisabled(withoutTrigger(target))).toEqual({ status: 'reported' });
  await world.reporter.publish(target, FAILING, NAMES);
  await world.reporter.enforcementDisabled(withoutTrigger(target));
  expect(world.fake.checkRuns).toHaveLength(1);
  expect(world.fake.checkRuns[0]?.run.status).toBe('completed');
  expect(world.fake.checkRuns[0]?.write).toEqual({
    status: 'completed',
    conclusion: 'neutral',
    title: 'CLA enforcement is disabled for this repository',
    summary: ENFORCEMENT_DISABLED_SUMMARY,
    completedAt: new Date('2026-11-02T10:00:00Z'),
    externalId: String(target.evaluationId),
  });
});

test('with no run on the SHA a run that is already completed is created, and no column of the row changes', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation({ result: 'failure' });
  const before = await world.rows();
  await world.reporter.enforcementDisabled(withoutTrigger(target));
  expect(methods(world.fake)).toEqual(['listCheckRunsForRef', 'createCheckRun']);
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'neutral' });
  expect(await world.rows()).toEqual(before);
});

test('a comment that exists is rewritten to the notice after the marker, and no other comment is touched', async () => {
  const { world, target } = await commented();
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(5002, { body: 'a person wrote this' }));
  await world.reporter.enforcementDisabled(target);
  expect(await world.fake.getIssueComment(INSTALLATION, FULL_NAME, parseGithubId(COMMENT))).toMatchObject({
    id: COMMENT,
    body: NOTICE,
  });
  expect((await world.fake.getIssueComment(INSTALLATION, FULL_NAME, parseGithubId(5002)))?.body).toBe(
    'a person wrote this',
  );
  expect(methods(world.fake)).toEqual([
    'listCheckRunsForRef',
    'createCheckRun',
    'updateIssueComment',
    'getIssueComment',
    'getIssueComment',
  ]);
});

test('a comment is rewritten once the Check Run is: the run is written first', async () => {
  const { world, target } = await commented();
  const order: string[] = [];
  world.fake.observe((call) => order.push(call.method));
  await world.reporter.enforcementDisabled(target);
  expect(order).toEqual(['listCheckRunsForRef', 'createCheckRun', 'updateIssueComment']);
});

test('the comment of the pull request is rewritten when only a row of an earlier head SHA records it', async () => {
  const world = await reportingWorld();
  await world.evaluation({ headSha: 'b'.repeat(40), commentId: COMMENT, updatedAt: EARLIER });
  const target = await world.evaluation({ result: 'failure', updatedAt: LATER });
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(COMMENT, { body: 'old text' }));
  await world.reporter.enforcementDisabled(withoutTrigger(target));
  expect((await world.fake.getIssueComment(INSTALLATION, FULL_NAME, parseGithubId(COMMENT)))?.body).toBe(NOTICE);
});

test('a comment that does not exist is not created, and a comment of another pull request is not touched', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation({ result: 'failure' });
  await world.evaluation({ prNumber: 8, headSha: 'c'.repeat(40), commentId: 6001 });
  await world.reporter.enforcementDisabled(withoutTrigger(target));
  expect(methods(world.fake)).not.toContain('updateIssueComment');
  expect(methods(world.fake)).not.toContain('createIssueComment');
});

test('a comment of another tenant at the same pull request number is not touched', async () => {
  const world = await reportingWorld();
  const other = await seedTenant(world.db, 2);
  await insertEvaluation(world.db, other, { prNumber: 7, headSha: HEAD, commentId: 7001 });
  const target = await world.evaluation({ result: 'failure' });
  await world.reporter.enforcementDisabled(withoutTrigger(target));
  expect(methods(world.fake)).not.toContain('updateIssueComment');
});

test('when a newer head SHA of the pull request has been evaluated the comment is left to it, and the run is still written', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation({ result: 'failure', updatedAt: EARLIER });
  await world.evaluation({ headSha: 'b'.repeat(40), commentId: COMMENT, updatedAt: LATER });
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(COMMENT, { body: 'old text' }));
  expect(await world.reporter.enforcementDisabled(withoutTrigger(target))).toEqual({ status: 'reported' });
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'neutral' });
  expect(methods(world.fake)).not.toContain('updateIssueComment');
  expect((await world.fake.getIssueComment(INSTALLATION, FULL_NAME, parseGithubId(COMMENT)))?.body).toBe('old text');
  expect(world.logs.lines().filter((line) => line['msg'] === 'comment_skipped_stale')).toMatchObject([
    { githubInstallationId: INSTALLATION, githubRepoId: 9000, prNumber: 7, headSha: HEAD },
  ]);
});

test.each([
  ['403', new GitHubForbiddenError('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}'), 403],
  ['404', new GitHubNotFoundError('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}'), 404],
  ['422', new GitHubUnprocessableError('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}'), 422],
])(
  'a comment that GitHub answers %s costs the comment only: it is logged with the status and the run stays neutral',
  async (_name, refusal, statusCode) => {
    const { world, target } = await commented();
    world.fake.failNext('updateIssueComment', refusal);
    expect(await world.reporter.enforcementDisabled(target)).toEqual({ status: 'reported' });
    expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'neutral' });
    expect(world.logs.lines().filter((line) => line['msg'] === 'comment_skipped')).toMatchObject([
      { statusCode, githubInstallationId: INSTALLATION, prNumber: 7, headSha: HEAD },
    ]);
    expect(world.logs.lines().filter((line) => line['msg'] === 'report.comment_disabled')).toEqual([]);
  },
);

test.each([
  ['a rate limit', new GitHubRateLimitedError(120, 'secondary')],
  ['an outage', new GitHubUnavailableError('GitHub answered 502 to PATCH')],
])(
  '%s on the comment is thrown unchanged for the queue to retry, after the run was written',
  async (_name, failure) => {
    const { world, target } = await commented();
    world.fake.failNext('updateIssueComment', failure);
    await expect(world.reporter.enforcementDisabled(target)).rejects.toBe(failure);
    expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'neutral' });
  },
);

test('repeating the report rewrites the comment to the same text and leaves one run', async () => {
  const { world, target } = await commented();
  await world.reporter.enforcementDisabled(target);
  await world.reporter.enforcementDisabled(target);
  expect(world.fake.checkRuns).toHaveLength(1);
  expect((await world.fake.getIssueComment(INSTALLATION, FULL_NAME, parseGithubId(COMMENT)))?.body).toBe(NOTICE);
});

test('the log names the numeric ids and the head SHA only', async () => {
  const { world, target } = await commented();
  await world.reporter.enforcementDisabled(target);
  expect(world.logs.lines().filter((line) => line['msg'] === 'report.comment_disabled')).toMatchObject([
    { githubInstallationId: INSTALLATION, githubRepoId: 9000, prNumber: 7, headSha: HEAD },
  ]);
  expect(world.logs.text()).not.toMatch(/org-1|CLA|old text/u);
});
