// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { RETRY_LIMIT } from '../../domain/job-retry.ts';
import { JOBS } from '../../domain/test-support.ts';
import { deadWorld, logged } from './test-support.ts';

// What wraps the dead-letter handlers (E07-S05): one handler tells what died by the `type` every envelope carries, logs it
// at error, and gives up with a single named line when its own last attempt fails. The loop stops there: the dead-letter
// queue has no dead-letter queue.

test.each([
  ['recheck-comment', JOBS.recheckComment],
  ['close-pr', JOBS.closePr],
  ['revoke-user-sessions', JOBS.revokeUserSessions],
  ['sweep', { type: 'sweep' }],
  ['sweep-installation', { type: 'sweep-installation', githubInstallationId: 5000 }],
  [
    'sweep-repository',
    { type: 'sweep-repository', githubInstallationId: 5000, githubRepoId: 9000, reason: 'allowlist_changed' },
  ],
  ['finalise-repository', { type: 'finalise-repository', githubInstallationId: 5000, githubRepoId: 9000 }],
  ['finalise-check', { type: 'finalise-check', githubInstallationId: 5000, githubRepoId: 9000, prNumber: 7 }],
])('a dead %s is logged at error and nothing else is done: no GitHub call, no row, no report', async (type, job) => {
  const world = await deadWorld();
  expect(await world.runDead(job)).toEqual({ outcome: 'logged' });
  expect(logged(world, 'job.dead_lettered')).toMatchObject([{ level: 50, type, outcome: 'logged', jobId: 'dead-1' }]);
  expect(world.calls()).toEqual([]);
  expect(await world.rows()).toEqual([]);
  expect(world.reporter.failures).toEqual([]);
  expect(world.timeline.filter((step) => !step.startsWith('db:select'))).toEqual([]);
});

test('the log of a dead sweep-repository carries its ids and its reason, the closed field that says why it exists (E07-S09)', async () => {
  const world = await deadWorld();
  await world.runDead({
    type: 'sweep-repository',
    githubInstallationId: 5000,
    githubRepoId: 9000,
    reason: 'signatures_invalidated',
  });
  expect(logged(world, 'job.dead_lettered')).toMatchObject([
    { githubInstallationId: 5000, githubRepoId: 9000, reason: 'signatures_invalidated' },
  ]);
});

test('the log of a dead job carries the numeric ids and the delivery and nothing from the data that is not a closed field', async () => {
  const world = await deadWorld();
  await world.runDead(JOBS.recheckComment);
  const [line] = logged(world, 'job.dead_lettered');
  expect(line).toMatchObject({
    githubInstallationId: JOBS.recheckComment.githubInstallationId,
    githubRepoId: JOBS.recheckComment.githubRepoId,
    prNumber: JOBS.recheckComment.prNumber,
    commentId: JOBS.recheckComment.commentId,
    deliveryId: JOBS.recheckComment.deliveryId,
  });
});

test.each([
  ['data that is no envelope', { type: 'close-pr', githubInstallationId: -1 }, 'close-pr'],
  ['a type nobody has', { type: 'drop-tables' }, undefined],
  ['a string', 'close-pr', undefined],
  ['nothing', null, undefined],
])('%s is logged at error with the fields that failed and completes as unrecognised', async (_what, data, type) => {
  const world = await deadWorld();
  expect(await world.runDead(data)).toEqual({ outcome: 'unrecognised' });
  const [line, ...others] = logged(world, 'job.dead_lettered');
  expect(others).toEqual([]);
  expect(line).toMatchObject({
    level: 50,
    outcome: 'unrecognised',
    jobId: 'dead-1',
    ...(type === undefined ? {} : { type }),
  });
  expect(line?.['type']).toBe(type);
  expect(world.logs.text()).not.toContain('drop-tables');
});

test('the fields that failed are named with the reason and never with their value', async () => {
  const world = await deadWorld();
  await world.runDead({ type: 'close-pr', githubInstallationId: 'secret-looking-value' });
  const [line] = logged(world, 'job.dead_lettered');
  expect(line?.['issues']).toEqual(expect.arrayContaining(['githubInstallationId:invalid_type']));
  expect(world.logs.text()).not.toContain('secret-looking-value');
});

test('a handler that throws is logged as a failed attempt and the job is retried: not the last attempt, so no give-up line', async () => {
  const world = await deadWorld({ evaluation: false });
  await expect(world.runDead(JOBS.evaluatePr, { retryCount: RETRY_LIMIT - 1 })).rejects.toThrow('no GitHub App');
  expect(logged(world, 'dead_letter.failed')).toMatchObject([
    { level: 40, type: 'evaluate-pr', attempt: RETRY_LIMIT - 1 },
  ]);
  expect(logged(world, 'dead_letter_unhandled')).toEqual([]);
  expect(logged(world, 'job.dead_lettered')).toEqual([]);
});

test('the last attempt that fails is logged as dead_letter_unhandled at error, once, and still rejects: there is no further queue', async () => {
  const world = await deadWorld({ evaluation: false });
  await expect(world.runDead(JOBS.evaluatePr, { retryCount: RETRY_LIMIT })).rejects.toThrow('no GitHub App');
  expect(logged(world, 'dead_letter_unhandled')).toMatchObject([
    {
      level: 50,
      type: 'evaluate-pr',
      attempt: RETRY_LIMIT,
      githubInstallationId: JOBS.evaluatePr.githubInstallationId,
    },
  ]);
});

test('a job whose signal aborted is failed, not completed, even when the handler finished', async () => {
  const world = await deadWorld();
  const reason = new Error('grace period over');
  await expect(world.runDead(JOBS.closePr, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  expect(logged(world, 'job.dead_lettered')).toEqual([]);
});
