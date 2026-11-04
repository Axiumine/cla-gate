// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { enableAs, enabledAnswerOf } from './repository-enable-fixture/test-support.ts';
import { COVERED, flowWorld, UNCOVERED } from './repository-flow-fixture/test-support.ts';

// Turning a repository on, from the click to the Check Runs (E14-S03), with GitHub stubbed by MSW behind the real Octokit adapter: a
// repository with two open pull requests is enabled, the sweep job the call sent lists them through GitHub, an `evaluate-pr` job
// evaluates each with the real engine, and the real reporter writes the `license/cla` Check Runs. The pull request of a person who
// signed ends `success`, the one of a person who did not ends `failure`. The jobs are run in-process, in the order the queue would
// (the flow fixture of E14-S04).

test('a repository with two open pull requests is enabled: after the sweep the covered one is success and the other failure', async () => {
  const world = await flowWorld();
  const { t1, github } = world;
  const response = await enableAs(world, 'admin1', t1.plain.repositoryId);
  expect([response.statusCode, enabledAnswerOf(response)]).toEqual([200, { enabled: true, changed: true }]);
  expect(github.requests).toEqual([]);
  await world.drain();
  expect(await world.conclusionOf(COVERED)).toBe('success');
  expect(await world.conclusionOf(UNCOVERED)).toBe('failure');
  const evaluations = (await sentJobs(world.db)).flatMap((sent) =>
    sent.job.type === 'evaluate-pr' ? [[sent.job.prNumber, sent.job.trigger]] : [],
  );
  expect(evaluations.toSorted((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
    [COVERED, 'policy_change'],
    [UNCOVERED, 'policy_change'],
  ]);
});

test('the call itself makes no GitHub call: the pull requests are listed by the sweep, not by the endpoint', async () => {
  const world = await flowWorld();
  await enableAs(world, 'admin1', world.t1.plain.repositoryId);
  expect(world.github.requests).toEqual([]);
  expect(world.github.checkRunWrites).toEqual([]);
});
