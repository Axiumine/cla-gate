// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluateWorld, FULL_NAME, INSTALLATION, REPOSITORY } from '../evaluate-pr/test-support.ts';
import {
  addGroup,
  failFor,
  groupJob,
  groupRows,
  prHead,
  reportedHeads,
  reportedResults,
  runGroup,
} from './test-support.ts';

// The `evaluate-merge-group` job (E22-S01): the pull requests of a merge queue's group are evaluated by the engine on their current
// opener and commits, and the verdict goes on the head SHA of the group. `success` only when every one of them passes.

/** `count` pull request numbers, ascending, none of them 0. */
const numbersOf = (count: number): number[] => Array.from({ length: count }, (_, index) => 100 + index);

test('a group of one pull request that passes is evaluated: its row is success and the report goes on the head SHA of the group', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41]);
  expect(await runGroup(world, groupJob(scene))).toEqual({ outcome: 'evaluated' });
  expect(world.reporter.groups).toEqual([
    {
      target: {
        githubInstallationId: INSTALLATION,
        githubRepoId: REPOSITORY,
        fullName: FULL_NAME,
        headSha: scene.head,
      },
      result: { state: 'passed', pullRequests: 1 },
    },
  ]);
  const [row, ...others] = await groupRows(world);
  expect(others).toEqual([]);
  expect(row).toMatchObject({
    installation_id: world.tenant.installationId,
    repository_id: world.tenant.repositoryId,
    head_sha: scene.head,
    base_sha: scene.base,
    result: 'success',
    destroyed_at: null,
    details: { version: 1, outcome: 'success', pullRequests: [{ number: 41, outcome: 'success', failureCodes: [] }] },
  });
});

test('the report is on the head SHA of the group, never on the head SHA of one of its pull requests', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41, 42]);
  await runGroup(world, groupJob(scene));
  expect(reportedHeads(world)).toEqual([scene.head]);
  expect([prHead(41), prHead(42)]).not.toContain(scene.head);
});

test('the engine runs once per pull request, on its opener now and its own commits, and a group passes when every one passes', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [43, 41, 42]);
  expect(await runGroup(world, groupJob(scene))).toEqual({ outcome: 'evaluated' });
  // The members are read and evaluated up to five at once, so the order of the calls is the order the answers arrived in.
  const calls = world.evaluate.mock.calls.map(([input]) => [input.opener.id, input.headSha, input.commits.length]);
  expect(calls.toSorted((first, second) => Number(first[0]) - Number(second[0]))).toEqual([
    [41, prHead(41), 1],
    [42, prHead(42), 1],
    [43, prHead(43), 1],
  ]);
  expect(reportedResults(world)).toEqual([{ state: 'passed', pullRequests: 3 }]);
});

test('one pull request that fails makes the group fail, and the report names it by number', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41, 42, 43]);
  failFor(world, [42]);
  expect(await runGroup(world, groupJob(scene))).toEqual({ outcome: 'evaluated' });
  expect(reportedResults(world)).toEqual([{ state: 'failed', failing: [42] }]);
  const [row] = await groupRows(world);
  expect(row).toMatchObject({
    result: 'failure',
    details: {
      version: 1,
      outcome: 'failure',
      pullRequests: [
        { number: 41, outcome: 'success', failureCodes: [] },
        { number: 42, outcome: 'failure', failureCodes: ['unsigned_contributor'] },
        { number: 43, outcome: 'success', failureCodes: [] },
      ],
    },
  });
});

test('every pull request that fails is named, in ascending order', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [43, 41, 42]);
  failFor(world, [43, 41]);
  await runGroup(world, groupJob(scene));
  expect(reportedResults(world)).toEqual([{ state: 'failed', failing: [41, 43] }]);
});

test.each([
  [1, 'success', 1],
  [25, 'success', 25],
  [26, 'failure', 0],
])('a group of %s pull requests is %s, and the engine runs for %s of them', async (count, result, evaluated) => {
  const world = await evaluateWorld();
  const scene = addGroup(world, numbersOf(count));
  expect(await runGroup(world, groupJob(scene))).toEqual({ outcome: 'evaluated' });
  const [row] = await groupRows(world);
  expect(row?.result).toBe(result);
  expect(world.evaluate).toHaveBeenCalledTimes(evaluated);
  expect(reportedResults(world)).toEqual([
    count > 25 ? { state: 'undetermined' } : { state: 'passed', pullRequests: count },
  ]);
});

test('a group of more than 25 pull requests fails closed with the code that says they were not determined, and no pull request is read', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, numbersOf(26));
  await runGroup(world, groupJob(scene));
  const [row] = await groupRows(world);
  expect(row?.details).toEqual({
    version: 1,
    outcome: 'failure',
    code: 'pull_requests_not_determined',
    pullRequests: [],
  });
  expect(world.calls()).not.toContain('getPullRequest');
});

test('a group whose branch names no pull request and whose range holds one commit fails closed', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41]);
  expect(await runGroup(world, groupJob(scene, { tipPrNumber: undefined }))).toEqual({ outcome: 'evaluated' });
  expect(reportedResults(world)).toEqual([{ state: 'undetermined' }]);
  const [row] = await groupRows(world);
  expect(row?.result).toBe('failure');
});

test('a group whose range holds several commits is completed by the pull requests of the commits, though the branch names none', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41, 42]);
  await runGroup(world, groupJob(scene, { tipPrNumber: undefined }));
  expect(reportedResults(world)).toEqual([{ state: 'passed', pullRequests: 2 }]);
});

test('a group with a pull request that is closed fails closed: the others are not reported as the group', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41, 42]);
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, { ...(await openPull(world, 42)), state: 'closed' });
  await runGroup(world, groupJob(scene));
  expect(reportedResults(world)).toEqual([{ state: 'undetermined' }]);
  expect(world.evaluate).toHaveBeenCalledTimes(1);
});

test('a group whose branch names a pull request GitHub does not have fails closed, though the commits name others', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41, 42]);
  await runGroup(world, groupJob(scene, { tipPrNumber: 4242 }));
  expect(reportedResults(world)).toEqual([{ state: 'undetermined' }]);
  const [row] = await groupRows(world);
  expect(row?.result).toBe('failure');
});

/** Pull request `number` as GitHub shows it now. */
async function openPull(world: Awaited<ReturnType<typeof evaluateWorld>>, number: number) {
  const pull = await world.fake.getPullRequest(INSTALLATION, FULL_NAME, number);
  if (pull === null) {
    throw new Error('the scene has no such pull request');
  }
  return pull;
}

test('the job runs its steps in order: the row is put in progress before GitHub is asked about a pull request, and the report comes last', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41]);
  await runGroup(world, groupJob(scene));
  const wanted = new Set([
    'gh:getRepositoryById',
    'db:insert merge_group_evaluations',
    'gh:compareCommits',
    'gh:getPullRequest',
    'evaluate',
    'db:update merge_group_evaluations',
    'reporter.merge_group',
  ]);
  const steps = world.timeline.filter((step) => wanted.has(step));
  expect(steps[0]).toBe('gh:getRepositoryById');
  expect(steps.indexOf('db:insert merge_group_evaluations')).toBeLessThan(steps.indexOf('gh:getPullRequest'));
  expect(steps.indexOf('gh:getPullRequest')).toBeLessThan(steps.indexOf('evaluate'));
  expect(steps.lastIndexOf('db:update merge_group_evaluations')).toBeLessThan(steps.indexOf('reporter.merge_group'));
  expect(steps.at(-1)).toBe('reporter.merge_group');
});

test('a retry leaves one row and reports again: the report is idempotent, the row is the same', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41]);
  await runGroup(world, groupJob(scene));
  const [first] = await groupRows(world);
  await runGroup(world, groupJob(scene));
  const rows = await groupRows(world);
  expect(rows.map((row) => row.id)).toEqual([first?.id]);
  expect(world.reporter.groups).toHaveLength(2);
});

test('a head SHA of the group that moved on to a different pull request set is a row of its own', async () => {
  const world = await evaluateWorld();
  const first = addGroup(world, [41]);
  await runGroup(world, groupJob(first));
  const second = addGroup(world, [41, 42]);
  await runGroup(world, groupJob(second));
  expect((await groupRows(world)).map((row) => row.head_sha)).toEqual([first.head, second.head]);
});

test('a log line of the job names the verdict and no name, login, email or title', async () => {
  const world = await evaluateWorld();
  await runGroup(world, groupJob(addGroup(world, [41])));
  const lines = world.logs.lines();
  expect(lines).toContainEqual(expect.objectContaining({ msg: 'evaluate_merge_group.evaluated', result: 'success' }));
  expect(JSON.stringify(lines)).not.toMatch(/@|user-41|Author/);
});
