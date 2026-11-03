// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { pullRequest } from '../github-pull-contract/test-support.ts';
import {
  FULL_NAME,
  HEAD,
  INSTALLATION,
  MINUTE,
  openPull,
  POLICY_JOB,
  REPOSITORY,
  seedAged,
  sweepWorld,
} from './test-support.ts';

// What the `sweep-repository` job asks to be evaluated (E07-S09): every open pull request of the repository, whatever result it has
// for its head SHA, because the policy it was judged under changed. The world has one repository with open pull request 7 at
// `HEAD`.

test('every open pull request is sent to be evaluated with the trigger policy_change: the ones with a final result for their head SHA too', async () => {
  const world = await sweepWorld();
  openPull(world, 8);
  openPull(world, 9);
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'success' });
  await seedAged(world, { prNumber: 8, headSha: HEAD, result: 'failure' });
  expect(await world.runPolicySweep()).toEqual({ outcome: 'swept' });
  expect((await world.queued()).map(({ job }) => job)).toEqual(
    [9, 8, 7].map((prNumber) => ({
      type: 'evaluate-pr',
      githubInstallationId: INSTALLATION,
      githubRepoId: REPOSITORY,
      prNumber,
      trigger: 'policy_change',
    })),
  );
});

test('each evaluation is sent under the coalesce key of its pull request and the idempotency key of the run', async () => {
  const world = await sweepWorld();
  await world.runPolicySweep(POLICY_JOB, 'policy-9');
  expect(world.enqueuer.calls).toEqual([
    {
      job: {
        type: 'evaluate-pr',
        githubInstallationId: INSTALLATION,
        githubRepoId: REPOSITORY,
        prNumber: 7,
        trigger: 'policy_change',
      },
      options: {
        idempotencyKey: 'sweep-repository:policy-9:9000:7',
        coalesceKey: 'evaluation:9000:7',
      },
    },
  ]);
});

test('it writes no Check Run and no comment and no row itself: GitHub is asked to read the repository and its pull requests, the reporter is not called', async () => {
  const world = await sweepWorld();
  openPull(world, 8);
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'success' });
  const before = await world.rows();
  await world.runPolicySweep();
  expect(world.calls()).toEqual(['getRepositoryById', 'listOpenPullRequests']);
  expect(world.reporter.startedTargets).toEqual([]);
  expect(world.reporter.published).toEqual([]);
  expect(world.reporter.failures).toEqual([]);
  expect(world.reporter.cancellations).toEqual([]);
  expect(world.evaluate).not.toHaveBeenCalled();
  expect(await world.rows()).toEqual(before);
});

test('the evaluations it sent are then done by the evaluate-pr job: the pull request that had a success is evaluated again', async () => {
  const world = await sweepWorld();
  await seedAged(world, { prNumber: 7, headSha: HEAD, result: 'success' });
  await world.runPolicySweep();
  const [sent] = await world.queued();
  if (sent?.job.type !== 'evaluate-pr') {
    throw new Error('an evaluate-pr job was expected');
  }
  expect(await world.run(sent.job)).toEqual({ outcome: 'evaluated' });
  expect(world.reporter.published).toHaveLength(1);
});

test('a second run sends nothing for a pull request whose evaluation still waits, and one after that evaluation started sends again', async () => {
  const world = await sweepWorld();
  await world.runPolicySweep(POLICY_JOB, 'policy-1');
  world.clock.advance(10 * MINUTE);
  await world.runPolicySweep(POLICY_JOB, 'policy-2');
  expect(await world.queuedPulls()).toEqual([7]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'sweep_repository.swept', queued: 0, deduplicated: 1 }),
  );
  // The evaluation that started may have read the policy before the change this run is for.
  await world.startJobs();
  await world.runPolicySweep(POLICY_JOB, 'policy-3');
  expect(await world.queuedPulls()).toEqual([7, 7]);
});

test('a retry of the same run sends nothing more: the job that is queued already will do the evaluation', async () => {
  const world = await sweepWorld();
  await world.runPolicySweep(POLICY_JOB, 'policy-1');
  world.clock.advance(5 * MINUTE);
  await world.runPolicySweep(POLICY_JOB, 'policy-1');
  expect(await world.queuedPulls()).toEqual([7]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'sweep_repository.swept', queued: 0, alreadyQueued: 1 }),
  );
});

test('the reason of the job does not change what the run does', async () => {
  const world = await sweepWorld();
  await world.runPolicySweep({ ...POLICY_JOB, reason: 'repository_enabled' }, 'policy-1');
  await world.startJobs();
  await world.runPolicySweep({ ...POLICY_JOB, reason: 'override_changed' }, 'policy-2');
  expect(await world.queuedPulls()).toEqual([7, 7]);
  expect((await world.queued()).map(({ job }) => (job.type === 'evaluate-pr' ? job.trigger : job.type))).toEqual([
    'policy_change',
    'policy_change',
  ]);
});

test('a repository with no open pull request costs the two reads and queues nothing', async () => {
  const world = await sweepWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(7, { state: 'closed' }));
  expect(await world.runPolicySweep()).toEqual({ outcome: 'swept' });
  expect(await world.queued()).toEqual([]);
  expect(world.calls()).toEqual(['getRepositoryById', 'listOpenPullRequests']);
});

test('the pull requests are read 100 to a page, ten pages at most: the 1,000 newest are sent and the log line says the rest was left', async () => {
  const world = await sweepWorld();
  for (let number = 8; number <= 1030; number += 1) {
    openPull(world, number);
  }
  await world.runPolicySweep();
  expect(world.calls().filter((method) => method === 'listOpenPullRequests')).toHaveLength(10);
  const queued = await world.queuedPulls();
  expect(queued).toHaveLength(1000);
  expect([Math.max(...queued), Math.min(...queued)]).toEqual([1030, 31]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'sweep_repository.swept', listed: 1000, truncated: true, queued: 1000 }),
  );
});

test('a repository with exactly 1,000 open pull requests is read whole and is not reported as cut', async () => {
  const world = await sweepWorld();
  for (let number = 8; number <= 1006; number += 1) {
    openPull(world, number);
  }
  await world.runPolicySweep();
  expect(await world.queuedPulls()).toHaveLength(1000);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'sweep_repository.swept', listed: 1000, truncated: false }),
  );
});

test('a repository that was renamed on GitHub is read under its new name, and stored under it', async () => {
  const world = await sweepWorld();
  world.fake.setRepositories(INSTALLATION, [{ id: REPOSITORY, fullName: 'org-1/renamed' }]);
  world.fake.addPullRequest(INSTALLATION, 'org-1/renamed', pullRequest(3, { headSha: HEAD }));
  await world.runPolicySweep();
  expect(await world.queuedPulls()).toEqual([3]);
  expect(
    (await world.raw.selectFrom('repositories').select('full_name').execute()).map((row) => row.full_name),
  ).toEqual(['org-1/renamed']);
});
