// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { insertEvaluation } from '../../adapters/db/pr-evaluation-links-fixture/test-support.ts';
import { seedTenant } from '../../adapters/db/test-support.ts';
import { evaluatePullRequest } from '../../domain/evaluation/index.ts';
import { commitFacts, evaluationInput } from '../../domain/evaluation/test-support.ts';
import { comment } from '../github-comment-contract/test-support.ts';
import {
  APP,
  BASE_URL,
  commentCalls,
  FAILING,
  FULL_NAME,
  HEAD,
  INSTALLATION,
  MARKER,
  NAMES,
  ours,
  PASSING,
  reportingWorld,
  withoutTrigger,
} from './test-support.ts';

// The pull request comment (E09-S07), on FakeGitHub: one comment per pull request, edited in place, found by the stored id and then by
// the marker plus the App, opened only for a failure, and written after the Check Run. The statuses GitHub can refuse it with are in
// check-run-reporter-comment-errors.test.ts, and the requests the adapter makes in check-run-reporter-comment-http.test.ts.

const COMMENT = 5001;
const LATER = new Date('2026-11-02T12:00:00Z');
const EARLIER = new Date('2026-11-02T08:00:00Z');
const SUCCESS = `${MARKER}\nAll contributors have signed the CLA for commit 0000000.`;

/** The comments of pull request 7 as GitHub lists them now: the world is read without being counted in `calls`. */
async function conversation(world: Awaited<ReturnType<typeof reportingWorld>>) {
  const before = [...world.fake.calls];
  const { comments } = await world.fake.listIssueComments(INSTALLATION, FULL_NAME, 7, 1);
  world.fake.calls.length = 0;
  world.fake.calls.push(...before);
  return comments;
}

const storedIds = async (world: Awaited<ReturnType<typeof reportingWorld>>) =>
  (await world.rows()).map((row) => row.comment_id);

test('a failure with no comment opens one as the App: the marker first, the sign link, the fix and the name; its id is stored on the row', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  await world.reporter.publish(target, FAILING, NAMES);
  expect(commentCalls(world.fake)).toEqual(['listIssueComments', 'createIssueComment']);
  const [posted, ...others] = await conversation(world);
  expect(others).toEqual([]);
  expect(posted).toMatchObject({ issueNumber: 7, appId: APP, author: { type: 'Bot' } });
  expect(
    posted?.body.startsWith(`${MARKER}\n## CLA check failed\n\n[Sign the CLA](${BASE_URL}/sign/9000?pr=7)\n\n`),
  ).toBe(true);
  expect(posted?.body).toContain('`octocat` (GitHub id 1): opened the PR, commit author');
  expect(posted?.body.endsWith('This comment is rewritten on every evaluation of the `license/cla` check.')).toBe(true);
  expect(posted?.body.split(MARKER)).toHaveLength(2);
  expect(await storedIds(world)).toEqual([posted?.id]);
});

test('the Check Run is written before the comment is looked for', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  const order: string[] = [];
  world.fake.observe((call) => order.push(call.method));
  await world.reporter.publish(target, FAILING, NAMES);
  expect(order).toEqual(['listCheckRunsForRef', 'createCheckRun', 'listIssueComments', 'createIssueComment']);
});

test('a passing pull request that never failed gets no comment: the conversation is read, nothing is created or edited', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.started(target);
  await world.reporter.publish(target, PASSING, NAMES);
  expect(commentCalls(world.fake)).toEqual(['listIssueComments']);
  expect(await conversation(world)).toEqual([]);
  expect(await storedIds(world)).toEqual([null]);
});

test('a pass edits the comment the row records to the one sentence with the short SHA, and nothing is listed', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation({ commentId: COMMENT });
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, ours(COMMENT));
  await world.reporter.publish(target, PASSING, NAMES);
  expect(commentCalls(world.fake)).toEqual(['updateIssueComment']);
  expect((await conversation(world)).map((each) => each.body)).toEqual([SUCCESS]);
  expect(await storedIds(world)).toEqual([COMMENT]);
});

test('a pass edits the comment of ours that the listing finds when no id is stored, and stores its id', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, ours(COMMENT));
  await world.reporter.publish(target, PASSING, NAMES);
  expect(commentCalls(world.fake)).toEqual(['listIssueComments', 'updateIssueComment']);
  expect((await conversation(world)).map((each) => each.body)).toEqual([SUCCESS]);
  expect(await storedIds(world)).toEqual([COMMENT]);
});

test('a failure edits the stored comment in place, publishing twice leaves one comment, and no listing is made', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation({ commentId: COMMENT });
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, ours(COMMENT, { body: 'a human replaced the words' }));
  await world.reporter.publish(target, FAILING, NAMES);
  const first = await conversation(world);
  await world.reporter.publish(target, FAILING, NAMES);
  expect(commentCalls(world.fake)).toEqual(['updateIssueComment', 'updateIssueComment']);
  expect(await conversation(world)).toEqual(first);
  expect(first).toHaveLength(1);
  expect(first[0]?.body.startsWith(`${MARKER}\n## CLA check failed`)).toBe(true);
  expect(await storedIds(world)).toEqual([COMMENT]);
});

test('a stored id that GitHub answers 404 to (a maintainer deleted the comment) is recreated, and the new id is stored', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation({ commentId: COMMENT });
  await world.reporter.publish(target, FAILING, NAMES);
  expect(commentCalls(world.fake)).toEqual(['updateIssueComment', 'listIssueComments', 'createIssueComment']);
  const [posted] = await conversation(world);
  expect(posted?.id).not.toBe(COMMENT);
  expect(await storedIds(world)).toEqual([posted?.id]);
});

test('a stored id that GitHub answers 404 to falls through to the listing, which finds the comment of ours and edits it', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation({ commentId: COMMENT });
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, ours(5002));
  await world.reporter.publish(target, FAILING, NAMES);
  expect(commentCalls(world.fake)).toEqual(['updateIssueComment', 'listIssueComments', 'updateIssueComment']);
  expect((await conversation(world)).map((each) => [each.id, each.body.startsWith('<!--')])).toEqual([[5002, true]]);
  expect(await storedIds(world)).toEqual([5002]);
});

test('two stale duplicates of ours: the oldest is updated and the other is left alone', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, ours(5002, { body: `${MARKER}\nsecond` }));
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, ours(5001, { body: `${MARKER}\nfirst` }));
  await world.reporter.publish(target, FAILING, NAMES);
  const [oldest, newer] = await conversation(world);
  expect(oldest?.id).toBe(5001);
  expect(oldest?.body).toContain('## CLA check failed');
  expect(newer).toEqual(ours(5002, { body: `${MARKER}\nsecond` }));
  expect(commentCalls(world.fake)).toEqual(['listIssueComments', 'updateIssueComment']);
  expect(await storedIds(world)).toEqual([5001]);
});

test.each([
  ['a person', { appId: null }],
  ['another App', { appId: parseGithubId(777) }],
  ['no author and no App', { appId: null, author: null }],
  ['our App, but with words that do not begin with the marker', { body: `hello\n${MARKER}` }],
  ['our App, with the marker after a space', { body: ` ${MARKER}` }],
])(
  'a comment %s wrote that begins with the marker is ignored: a new comment is opened and the forged one is left alone',
  async (_who, forgery) => {
    const world = await reportingWorld();
    const target = await world.evaluation();
    const forged = ours(5001, forgery);
    world.fake.addIssueComment(INSTALLATION, FULL_NAME, forged);
    await world.reporter.publish(target, FAILING, NAMES);
    const [first, posted] = await conversation(world);
    expect(first).toEqual(forged);
    expect(posted).toMatchObject({ appId: APP });
    expect(posted?.id).not.toBe(5001);
    expect(await storedIds(world)).toEqual([posted?.id]);
  },
);

test('six pages of unrelated comments: the search stops after five pages and a new comment is opened', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  for (let id = 6001; id <= 6600; id += 1) {
    world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(id));
  }
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, ours(7000));
  await world.reporter.publish(target, FAILING, NAMES);
  expect(commentCalls(world.fake)).toEqual([...Array<string>(5).fill('listIssueComments'), 'createIssueComment']);
  expect((await world.fake.getIssueComment(INSTALLATION, FULL_NAME, parseGithubId(7000)))?.body).toBe(
    `${MARKER}\nold text`,
  );
  expect(await storedIds(world)).not.toEqual([7000]);
});

test('the comment of ours on the fifth page is found, and the sixth page is not read', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  for (let id = 6001; id <= 6499; id += 1) {
    world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(id));
  }
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, ours(6500));
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(6501));
  await world.reporter.publish(target, FAILING, NAMES);
  expect(commentCalls(world.fake)).toEqual([...Array<string>(5).fill('listIssueComments'), 'updateIssueComment']);
  expect(await storedIds(world)).toEqual([6500]);
});

test('the comments of other pull requests and of other repositories are never taken for ours', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, ours(5001, { issueNumber: 8 }));
  world.fake.addIssueComment(INSTALLATION, 'org-1/other', ours(5002));
  await world.reporter.publish(target, FAILING, NAMES);
  const [posted] = await conversation(world);
  expect(posted?.id).not.toBe(5001);
  expect((await world.fake.getIssueComment(INSTALLATION, FULL_NAME, parseGithubId(5001)))?.body).toBe(
    `${MARKER}\nold text`,
  );
});

test('when a newer head SHA of the pull request has been evaluated the comment is left to it: the Check Run is written and nothing else', async () => {
  const world = await reportingWorld();
  await world.evaluation({ headSha: 'b'.repeat(40), updatedAt: LATER });
  const target = await world.evaluation({ updatedAt: EARLIER });
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, ours(COMMENT));
  await world.reporter.publish(target, FAILING, NAMES);
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'failure' });
  expect(commentCalls(world.fake)).toEqual([]);
  expect((await conversation(world)).map((each) => each.body)).toEqual([`${MARKER}\nold text`]);
  expect(world.logs.lines().find((entry) => entry['msg'] === 'comment_skipped_stale')).toMatchObject({
    githubInstallationId: INSTALLATION,
    prNumber: 7,
    headSha: HEAD,
  });
  expect((await world.rows()).map((row) => row.comment_id)).toEqual([null, null]);
});

test('a newer row of another pull request does not make the comment stale', async () => {
  const world = await reportingWorld();
  await world.evaluation({ prNumber: 8, headSha: 'b'.repeat(40), updatedAt: LATER });
  const target = await world.evaluation({ updatedAt: EARLIER });
  await world.reporter.publish(target, FAILING, NAMES);
  expect(commentCalls(world.fake)).toEqual(['listIssueComments', 'createIssueComment']);
});

test('a new head SHA keeps editing the comment of the earlier ones, and its row records the same id', async () => {
  const world = await reportingWorld();
  await world.evaluation({ headSha: 'b'.repeat(40), commentId: COMMENT, updatedAt: EARLIER });
  const target = await world.evaluation({ updatedAt: LATER });
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, ours(COMMENT));
  await world.reporter.publish(target, FAILING, NAMES);
  expect(commentCalls(world.fake)).toEqual(['updateIssueComment']);
  expect(await storedIds(world)).toEqual([COMMENT, COMMENT]);
  expect(await conversation(world)).toHaveLength(1);
});

test('started, failed and cancelled never touch the comment', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation({ commentId: COMMENT });
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, ours(COMMENT));
  await world.reporter.started(target);
  await world.reporter.failed(target, 'evaluation_failed');
  await world.reporter.cancelled(withoutTrigger(target));
  expect(commentCalls(world.fake)).toEqual([]);
  expect((await conversation(world)).map((each) => each.body)).toEqual([`${MARKER}\nold text`]);
});

test('a pass that follows another pull request failing at the same SHA still says this pull request passed', async () => {
  const world = await reportingWorld();
  await world.evaluation({ prNumber: 8, result: 'failure' });
  const target = await world.evaluation({ commentId: COMMENT });
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, ours(COMMENT));
  await world.reporter.publish(target, PASSING, NAMES);
  expect(world.fake.checkRuns[0]?.write).toMatchObject({ conclusion: 'failure', title: 'CLA check failed' });
  expect((await conversation(world)).map((each) => each.body)).toEqual([SUCCESS]);
});

test('the comment id of another tenant at the same pull request number is never used, read or changed', async () => {
  const world = await reportingWorld();
  const other = await seedTenant(world.db, 2);
  await insertEvaluation(world.db, other, { prNumber: 7, headSha: HEAD, commentId: 7001 });
  const target = await world.evaluation();
  await world.reporter.publish(target, FAILING, NAMES);
  expect(commentCalls(world.fake)).toEqual(['listIssueComments', 'createIssueComment']);
  const rows = await world.rows();
  expect(rows.map((row) => [row.installation_id, row.comment_id])).toEqual([
    [other.installationId, 7001],
    [world.tenant.installationId, (await conversation(world))[0]?.id],
  ]);
});

test('the log of a comment write carries ids only: no name, no body, no address', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  await world.reporter.publish(target, FAILING, NAMES);
  const written = world.logs.lines().find((entry) => entry['msg'] === 'report.comment_created');
  expect(written).toMatchObject({ githubInstallationId: INSTALLATION, prNumber: 7, headSha: HEAD });
  expect(world.logs.text()).not.toMatch(/octocat|Sign the CLA|cla-platform|example\.org/u);
});

test('both hostile lists as the logins of 34 unsigned people give a comment with the marker exactly once, as its first line', async () => {
  const world = await reportingWorld();
  const target = await world.evaluation();
  const hostile = [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES];
  const evaluation = evaluatePullRequest(
    evaluationInput({ commits: hostile.map((_name, index) => commitFacts(index + 1)) }),
  );
  const names = {
    logins: new Map(hostile.map((name, index) => [index + 1, name])),
    coAuthors: new Map<string, string[]>(),
  };
  await world.reporter.publish(target, evaluation, names);
  const [posted] = await conversation(world);
  expect(posted?.body.split(MARKER)).toHaveLength(2);
  expect(posted?.body.startsWith(`${MARKER}\n`)).toBe(true);
  expect(posted?.body.split('\n').filter((line) => line.startsWith('- `'))).toHaveLength(34);
  expect(posted?.body.length).toBeLessThanOrEqual(60_000);
});
