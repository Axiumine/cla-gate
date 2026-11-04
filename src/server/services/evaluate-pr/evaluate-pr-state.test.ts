// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { seedTenant } from '../../adapters/db/test-support.ts';
import { HEAD, seedEvaluation, statesOf, touchedOf } from '../close-pr/test-support.ts';
import { commitSha, pullRequest } from '../github-pull-contract/test-support.ts';
import { evaluateWorld, FULL_NAME, INSTALLATION, JOB, PR_NUMBER } from './test-support.ts';

// The state the `evaluate-pr` job keeps in the rows of a pull request it finds open (E15-S01): `open` on every row of the pull
// request, which is how a `reopened` delivery is recorded, before the rule that answers a repeated delivery with what is stored,
// and never on a row of another pull request, another repository or another tenant. A pull request that GitHub shows closed is
// the business of the `close-pr` job: this one changes no state for it.

const OLDER = commitSha(3);
const OTHER_PR = 8;

test('a reopened pull request is open again on every row it has, each head SHA and each result, and another pull request is left as it is', async () => {
  const world = await evaluateWorld();
  await seedEvaluation(world, { result: 'success', headSha: OLDER, prState: 'closed' });
  await seedEvaluation(world, { result: 'cancelled', headSha: commitSha(4), prState: 'closed' });
  await seedEvaluation(world, { result: 'failure', prState: 'closed' });
  await seedEvaluation(world, { result: 'failure', prNumber: OTHER_PR, prState: 'closed' });
  expect(await world.run({ ...JOB, trigger: 'sweep' })).toEqual({ outcome: 'evaluated' });
  expect(await statesOf(world)).toEqual([
    [PR_NUMBER, OLDER, 'open'],
    [PR_NUMBER, commitSha(4), 'open'],
    [PR_NUMBER, HEAD, 'open'],
    [OTHER_PR, HEAD, 'closed'],
  ]);
});

test('a reopen whose head SHA already has a final result and a Check Run is answered as unchanged and still opens the rows the close marked, without touching updated_at', async () => {
  const world = await evaluateWorld();
  await seedEvaluation(world, { result: 'success', headSha: OLDER, prState: 'closed' });
  await seedEvaluation(world, { result: 'failure', checkRunId: 4711, prState: 'closed' });
  const before = await touchedOf(world);
  expect(await world.run()).toEqual({ outcome: 'unchanged' });
  expect(await statesOf(world)).toEqual([
    [PR_NUMBER, OLDER, 'open'],
    [PR_NUMBER, HEAD, 'open'],
  ]);
  expect(await touchedOf(world)).toEqual(before);
  expect(world.reporter.startedTargets).toEqual([]);
});

test('the rows are opened after GitHub was asked for the pull request, and before the rule that answers a repeated delivery reads the row of the evaluation', async () => {
  const world = await evaluateWorld();
  await seedEvaluation(world, { result: 'success', checkRunId: 4711, prState: 'closed' });
  world.timeline.length = 0;
  await world.run();
  expect(
    world.timeline.filter((step) => !['db:select installations', 'db:select repositories'].includes(step)),
  ).toEqual(['gh:getRepositoryById', 'gh:getPullRequest', 'db:update pr_evaluations', 'db:select pr_evaluations']);
});

test('a pull request GitHub shows closed is skipped and its rows keep the state they had: only the close job closes, and nothing here opens', async () => {
  const world = await evaluateWorld();
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(PR_NUMBER, { state: 'closed' }));
  await seedEvaluation(world, { result: 'success', headSha: OLDER, prState: 'closed' });
  await seedEvaluation(world, { result: 'failure', prState: 'open' });
  expect(await world.run()).toEqual({ outcome: 'skipped:pull_request_closed' });
  expect(await statesOf(world)).toEqual([
    [PR_NUMBER, OLDER, 'closed'],
    [PR_NUMBER, HEAD, 'open'],
  ]);
});

test('a pull request that GitHub does not show is skipped with no state changed', async () => {
  const world = await evaluateWorld();
  await seedEvaluation(world, { result: 'success', prNumber: OTHER_PR, prState: 'closed' });
  expect(await world.run({ ...JOB, prNumber: OTHER_PR })).toEqual({ outcome: 'skipped:pull_request_not_found' });
  expect(await statesOf(world)).toEqual([[OTHER_PR, HEAD, 'closed']]);
});

test('pull request 7 of another tenant, at the same head SHA, stays as it is when tenant 1 evaluates its own pull request 7', async () => {
  const world = await evaluateWorld();
  const other = await seedTenant(world.raw, 2);
  await world.raw
    .insertInto('pr_evaluations')
    .values({
      installation_id: other.installationId,
      repository_id: other.repositoryId,
      pr_number: PR_NUMBER,
      head_sha: HEAD,
      result: 'success',
      pr_state: 'closed',
    })
    .execute();
  await seedEvaluation(world, { result: 'failure', prState: 'closed' });
  await world.run({ ...JOB, trigger: 'sweep' });
  const states = await world.raw
    .selectFrom('pr_evaluations')
    .select(['installation_id', 'pr_state'])
    .orderBy('id')
    .execute();
  expect(states).toEqual([
    { installation_id: other.installationId, pr_state: 'closed' },
    { installation_id: world.tenant.installationId, pr_state: 'open' },
  ]);
});
