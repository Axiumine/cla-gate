// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { commit, commitSha, pullRequest } from '../github-pull-contract/test-support.ts';
import { CommitListingMismatchError } from './commit-listing.ts';
import { engineInput, evaluateWorld, FULL_NAME, INSTALLATION, PR_NUMBER } from './test-support.ts';

// The commits and the facts about them, as the job hands them to the engine (E07-S04).

const opened = (overrides: Parameters<typeof pullRequest>[1]) => pullRequest(PR_NUMBER, overrides);

test('a listing that does not add up is read again after the pull request was, and a count that settled in between is the one that counts', async () => {
  const world = await evaluateWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, opened({ commitCount: 3 }));
  world.fake.beforeNext('listPullRequestCommits', () => {
    world.fake.addPullRequest(INSTALLATION, FULL_NAME, opened({ commitCount: 2 }));
    return Promise.resolve();
  });
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  expect(world.calls()).toEqual([
    'getRepositoryById',
    'getPullRequest',
    'listPullRequestCommits',
    'getPullRequest',
    'listPullRequestCommits',
    'getPullRequest',
  ]);
});

test('a listing that disagrees twice fails the job after two listings and two reads of the pull request, with the row left in progress', async () => {
  const world = await evaluateWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, opened({ commitCount: 5 }));
  await expect(world.run()).rejects.toBeInstanceOf(CommitListingMismatchError);
  expect(world.calls().filter((method) => method === 'getPullRequest')).toHaveLength(2);
  expect(world.calls().filter((method) => method === 'listPullRequestCommits')).toHaveLength(2);
  expect(world.evaluate).not.toHaveBeenCalled();
  expect(world.reporter.published).toEqual([]);
  expect((await world.rows()).map((row) => row.result)).toEqual(['in_progress']);
});

test('the retry of a listing that did not add up evaluates once GitHub agrees with itself', async () => {
  const world = await evaluateWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, opened({ commitCount: 5 }));
  await expect(world.run()).rejects.toBeInstanceOf(CommitListingMismatchError);
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, opened({ commitCount: 2 }));
  expect(await world.run(undefined, { attempt: 1 })).toEqual({ outcome: 'evaluated' });
  expect(await world.rows()).toHaveLength(1);
});

test('a push while the commits are read supersedes the job: the head moved, so nothing is written but the row in progress', async () => {
  const world = await evaluateWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, opened({ commitCount: 3 }));
  world.fake.beforeNext('listPullRequestCommits', () => {
    world.fake.addPullRequest(INSTALLATION, FULL_NAME, opened({ headSha: commitSha(3), commitCount: 3 }));
    return Promise.resolve();
  });
  expect(await world.run()).toEqual({ outcome: 'superseded' });
  expect(world.evaluate).not.toHaveBeenCalled();
  expect(world.reporter.published).toEqual([]);
  expect((await world.rows()).map((row) => [row.head_sha, row.result])).toEqual([[commitSha(2), 'in_progress']]);
});

test('a pull request of 300 commits is read through the history of the repository and the engine gets exactly its commits', async () => {
  const world = await evaluateWorld();
  const history = Array.from({ length: 400 }, (_, index) => commit(index + 1));
  world.fake.addPullRequest(
    INSTALLATION,
    FULL_NAME,
    opened({ baseSha: commitSha(100), headSha: commitSha(400), commitCount: 300 }),
  );
  world.fake.setRepositoryCommits(INSTALLATION, FULL_NAME, history.toReversed());
  world.fake.setMergeBase(
    INSTALLATION,
    FULL_NAME,
    { baseSha: commitSha(100), headSha: commitSha(400) },
    commitSha(100),
  );
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  const input = engineInput(world);
  expect(input.listing).toBe('complete');
  expect(new Set(input.commits.map((one) => one.sha))).toEqual(new Set(history.slice(100).map((one) => one.sha)));
  expect(world.calls()).not.toContain('listPullRequestCommits');
});

test('a pull request of more than 2000 commits reaches the engine as an exceeded listing with no commits, and no commit is read', async () => {
  const world = await evaluateWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, opened({ commitCount: 2001 }));
  expect(await world.run()).toEqual({ outcome: 'evaluated' });
  expect(engineInput(world)).toMatchObject({ listing: 'exceeded', commits: [] });
  expect(world.calls()).not.toContain('listPullRequestCommits');
  expect(world.calls()).not.toContain('listRepositoryCommits');
});

test('the commits reach the engine as numeric ids and types, with a commit GitHub could not link to an account as null', async () => {
  const world = await evaluateWorld();
  world.fake.setPullRequestCommits(INSTALLATION, FULL_NAME, PR_NUMBER, [
    commit(1, { author: null }),
    commit(2, { committer: null }),
  ]);
  await world.run();
  const [first, second] = engineInput(world).commits;
  expect([first?.author, first?.committer]).toEqual([null, { id: 1, type: 'User' }]);
  expect([second?.author, second?.committer]).toEqual([{ id: 2, type: 'User' }, null]);
  expect(engineInput(world).opener).toEqual({ id: 7, type: 'User' });
  expect(engineInput(world).headSha).toBe(commitSha(2));
});

test('the overrides of the repository for the collected commits reach the engine, and those for other commits do not', async () => {
  const world = await evaluateWorld();
  const note = (sha: string) =>
    world.raw
      .insertInto('commit_overrides')
      .values({
        installation_id: world.tenant.installationId,
        repository_id: world.tenant.repositoryId,
        commit_sha: sha,
        created_by: world.tenant.publisherId,
        reason: 'a note',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  const known = await note(commitSha(1));
  await note(commitSha(99));
  await world.run();
  expect(engineInput(world).overrides).toEqual(new Map([[commitSha(1), known.id]]));
});
