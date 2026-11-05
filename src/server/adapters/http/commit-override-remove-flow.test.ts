// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { commitSha } from '../../services/github-pull-contract/test-support.ts';
import { sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { overrideOf, recordAs, removeOverrideAs } from './commit-override-fixture/test-support.ts';
import { storedEvaluation, summaryOf, unlinkedWorld } from './commit-override-flow-fixture/test-support.ts';
import { enableAs } from './repository-enable-fixture/test-support.ts';
import { COVERED, UNCOVERED } from './repository-flow-fixture/test-support.ts';

// Removing an override, from the click to the Check Runs (E15-S06), with GitHub stubbed by MSW behind the real Octokit adapter, the jobs
// run in-process in the order the queue would, the real engine and the real reporter. The pull request COVERED (opened by tenant 1's
// signer) fails on an unlinked author until the override waives it; the stored details of the engine are what the removal looks for.

test('removing the override turns the green check red again: the pull request is evaluated again and its first commit is unlinked once more', async () => {
  const world = await unlinkedWorld();
  const { t1 } = world;
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await world.drain();
  const recorded = await recordAs(world, 'admin1', t1.plain.repositoryId, commitSha(1));
  expect(recorded.statusCode).toBe(201);
  await world.drain();
  expect(await world.conclusionOf(COVERED)).toBe('success');
  const green = await storedEvaluation(world, t1.plain.repositoryId, COVERED);
  expect(green.details.unlinked).toEqual([{ sha: commitSha(1), role: 'author', overrideId: overrideOf(recorded).id }]);
  expect(await summaryOf(world, COVERED)).toContain('1 by maintainer override');
  const sent = (await sentJobs(world.db)).length;

  const removed = await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, overrideOf(recorded).id);
  expect(removed.statusCode).toBe(204);
  const jobs = (await sentJobs(world.db)).slice(sent);
  expect(jobs.map(({ job }) => (job.type === 'evaluate-pr' ? job.prNumber : job.type))).toEqual([COVERED]);
  await world.drain();

  expect(await world.conclusionOf(COVERED)).toBe('failure');
  const red = await storedEvaluation(world, t1.plain.repositoryId, COVERED);
  expect(red.details.failureCodes).toEqual(['unlinked_identity']);
  expect(red.details.unlinked).toEqual([{ sha: commitSha(1), role: 'author', overrideId: null }]);
  expect(await summaryOf(world, COVERED)).not.toContain('by maintainer override');
});

test('the same commit can be overridden again after the removal: the check turns green on the new row, whose id the stored details name', async () => {
  const world = await unlinkedWorld();
  const { t1 } = world;
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await world.drain();
  const first = overrideOf(await recordAs(world, 'admin1', t1.plain.repositoryId, commitSha(1)));
  await world.drain();
  expect((await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, first.id)).statusCode).toBe(204);
  await world.drain();
  expect(await world.conclusionOf(COVERED)).toBe('failure');

  const again = await recordAs(world, 'admin1', t1.plain.repositoryId, commitSha(1));
  expect(again.statusCode).toBe(201);
  await world.drain();

  const second = overrideOf(again);
  expect(second.id).not.toBe(first.id);
  expect(await world.conclusionOf(COVERED)).toBe('success');
  const green = await storedEvaluation(world, t1.plain.repositoryId, COVERED);
  expect(green.details.unlinked).toEqual([{ sha: commitSha(1), role: 'author', overrideId: second.id }]);
});

test('a pull request that failed anyway is not evaluated again by the removal: the override of its opener who is not covered waived one identity and signed for nobody', async () => {
  const world = await unlinkedWorld();
  const { t1 } = world;
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await world.drain();
  const recorded = await recordAs(world, 'admin1', t1.plain.repositoryId, commitSha(3));
  await world.drain();
  expect(await world.conclusionOf(UNCOVERED)).toBe('failure');
  const sent = (await sentJobs(world.db)).length;
  expect((await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, overrideOf(recorded).id)).statusCode).toBe(
    204,
  );
  expect((await sentJobs(world.db)).slice(sent)).toEqual([]);
});
