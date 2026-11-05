// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { evaluateWorld } from './evaluate-pr/test-support.ts';
import { type HandlerDeps, HandlerUnavailableError, registerHandlers } from './job-handlers.ts';
import { runJob } from './job-run.ts';
import { DELIVERY_ID, queuedJob, runWorld } from './job-run-fixture/test-support.ts';
import { addGroup, groupJob } from './merge-group/test-support.ts';

// The handler `registerHandlers` binds to `evaluate-merge-group` (E22-S01): it evaluates the group on the ports it is given for the
// signal of the job, completes with the outcome and marks the delivery that started it; without a reporter it fails the job.

test('evaluate-merge-group evaluates the group with the ports of the signal of the job, reports it on the head SHA and marks its delivery', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41, 42]);
  const evaluatePorts = vi.fn<NonNullable<HandlerDeps['evaluatePr']>>(() => world.ports);
  const { deps, marked } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: evaluatePorts });
  });
  const signal = new AbortController().signal;
  const verdict = await runJob(
    'evaluate-merge-group',
    queuedJob({ ...groupJob(scene), deliveryId: DELIVERY_ID }, { signal }),
    deps,
  );
  expect(verdict).toEqual({ status: 'completed', output: { outcome: 'evaluated' } });
  expect(evaluatePorts).toHaveBeenCalledExactlyOnceWith(signal);
  expect(world.reporter.groups.map(({ target, result }) => [target.headSha, result])).toEqual([
    [scene.head, { state: 'passed', pullRequests: 2 }],
  ]);
  expect(marked).toEqual([DELIVERY_ID]);
});

test('without an evaluation reporter an evaluate-merge-group job fails and keeps its delivery: nothing is evaluated without it', async () => {
  const world = await evaluateWorld();
  const scene = addGroup(world, [41]);
  const { deps, marked } = runWorld((registry) => {
    registerHandlers(registry, { syncInstallation: undefined, evaluatePr: undefined });
  });
  await expect(
    runJob('evaluate-merge-group', queuedJob({ ...groupJob(scene), deliveryId: DELIVERY_ID }), deps),
  ).rejects.toThrow(
    new HandlerUnavailableError('evaluate-merge-group', 'no GitHub App or no evaluation reporter (E09) is configured'),
  );
  expect(marked).toEqual([]);
});
