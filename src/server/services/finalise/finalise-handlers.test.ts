// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { type HandlerDeps, registerHandlers } from '../job-handlers.ts';
import { runJob } from '../job-run.ts';
import { queuedJob, runWorld } from '../job-run-fixture/test-support.ts';
import { CHECK_JOB, finaliseWorld, HEAD, REPOSITORY_JOB, seedEvaluation } from './test-support.ts';

// The handlers of the two finalise jobs as `registerHandlers` binds them (E14-S04): the ports of the evaluation jobs for the signal
// of the job, the queue and the id of the job the wrapper runs it with, and the wrapper's verdicts.

test('finalise-check completes the check with the ports it is given for the signal of the job and completes with the outcome', async () => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'failure' });
  const ports = vi.fn<NonNullable<HandlerDeps['evaluatePr']>>(() => world.ports);
  const { deps } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: ports });
  });
  const signal = new AbortController().signal;
  const verdict = await runJob('finalise-check', queuedJob(CHECK_JOB, { signal }), deps);
  expect(verdict).toEqual({ status: 'completed', output: { outcome: 'finalised' } });
  expect(ports).toHaveBeenCalledExactlyOnceWith(signal);
  expect(world.reporter.disabled.map((target) => target.headSha)).toEqual([HEAD]);
});

test('finalise-repository sends its jobs to the queue the wrapper runs it with, under the id of the job, and completes with the outcome', async () => {
  const world = await finaliseWorld();
  await seedEvaluation(world, { result: 'in_progress' });
  const ports = vi.fn<NonNullable<HandlerDeps['evaluatePr']>>(() => world.ports);
  const { deps } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: ports });
  });
  const signal = new AbortController().signal;
  const verdict = await runJob('finalise-repository', queuedJob(REPOSITORY_JOB, { id: 'job-42', signal }), {
    ...deps,
    enqueuer: world.enqueuer,
  });
  expect(verdict).toEqual({ status: 'completed', output: { outcome: 'queued' } });
  expect(ports).toHaveBeenCalledExactlyOnceWith(signal);
  expect((await world.sent()).map((sent) => sent.idempotencyKey)).toEqual([
    `finalise-check:job-42:${String(REPOSITORY_JOB.githubRepoId)}:7`,
  ]);
});

test.each([
  ['finalise-check', { type: 'finalise-check', prNumber: 'seven' }],
  ['finalise-repository', { type: 'finalise-repository', githubRepoId: 'nine thousand' }],
] as const)(
  'a %s job whose payload is not an envelope is dead-lettered before the ports are asked for anything',
  async (type, data) => {
    const ports = vi.fn<NonNullable<HandlerDeps['evaluatePr']>>();
    const { deps } = runWorld((registry) => {
      registerHandlers(registry, { syncInstallation: undefined, evaluatePr: ports });
    });
    expect((await runJob(type, queuedJob(data), deps)).status).toBe('deadletter');
    expect(ports).not.toHaveBeenCalled();
  },
);
