// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import type { ReconcileOutcome } from '../installation-reconcile.ts';
import { type SweepDeps, sweep } from './sweep.ts';
import { addNeighbour, callsFor, INSTALLATION, MINUTE, type SweepWorld, sweepWorld } from './test-support.ts';

// The `sweep` job (E07-S08): the installations are reconciled, then one `sweep-installation` job is sent for each installation the
// instance serves. The reconciliation is a double here; its own tests are E05-S08's.

const RECONCILED: ReconcileOutcome = { synced: 3, failed: 0 };

function deps(world: SweepWorld, reconcile?: SweepDeps['reconcileInstallations']) {
  const reconcileInstallations = vi.fn<SweepDeps['reconcileInstallations']>(
    reconcile ?? (() => Promise.resolve(RECONCILED)),
  );
  return { reconcileInstallations, deps: { db: world.db, reconcileInstallations } satisfies SweepDeps };
}

const sent = async (world: SweepWorld) =>
  (await world.queued()).flatMap(({ job }) =>
    job.type === 'sweep-installation' ? [Number(job.githubInstallationId)] : [],
  );

test('the installations are reconciled first, with the signal of the job, and then one job is sent for each served installation', async () => {
  const world = await sweepWorld();
  await addNeighbour(world, 2);
  const { deps: sweepDeps, reconcileInstallations } = deps(world);
  const context = world.context();
  expect(await sweep(sweepDeps, context)).toEqual({ outcome: 'fanned_out' });
  expect(reconcileInstallations).toHaveBeenCalledExactlyOnceWith(context.signal);
  expect(await sent(world)).toEqual([5000, 10_000]);
  // the sweep itself asks for no evaluation: that is the work of the jobs it starts
  expect(await world.queuedPulls()).toEqual([]);
  expect(world.logs.lines()).toContainEqual(
    expect.objectContaining({ msg: 'sweep.fanned_out', installations: 2, deduplicated: 0, synced: 3, failed: 0 }),
  );
});

test('a rejected, a suspended and a deleted installation get no job, and a job that was started for one of them makes no request', async () => {
  const world = await sweepWorld();
  const rejected = await addNeighbour(world, 2, { admission: 'rejected' });
  const suspended = await addNeighbour(world, 3, { suspended: true });
  const deleted = await addNeighbour(world, 4, { deleted: true });
  await sweep(deps(world).deps, world.context());
  expect(await sent(world)).toEqual([5000]);
  for (const neighbour of [rejected, suspended, deleted]) {
    expect(callsFor(world, neighbour.githubInstallationId)).toBe(0);
  }
});

test('each job has its own dedupe key and a window of a minute, and its idempotency key names the run and the installation', async () => {
  const world = await sweepWorld();
  await addNeighbour(world, 2);
  await sweep(deps(world).deps, world.context('sweep-job-9'));
  expect(world.enqueuer.calls).toEqual([
    {
      job: { type: 'sweep-installation', githubInstallationId: INSTALLATION },
      options: {
        idempotencyKey: 'sweep:sweep-job-9:5000',
        dedupeKey: 'sweep-installation:5000',
        dedupeWindowSeconds: 60,
      },
    },
    {
      job: { type: 'sweep-installation', githubInstallationId: 10_000 },
      options: {
        idempotencyKey: 'sweep:sweep-job-9:10000',
        dedupeKey: 'sweep-installation:10000',
        dedupeWindowSeconds: 60,
      },
    },
  ]);
});

test('a run that is retried sends nothing twice, and two runs inside the window start one job per installation', async () => {
  const world = await sweepWorld();
  const { deps: sweepDeps } = deps(world);
  await sweep(sweepDeps, world.context('sweep-1'));
  await sweep(sweepDeps, world.context('sweep-1'));
  world.clock.advance(MINUTE / 2);
  await sweep(sweepDeps, world.context('sweep-2'));
  expect(await sent(world)).toEqual([5000]);
  expect(
    world.logs
      .lines()
      .filter((line) => line['msg'] === 'sweep.fanned_out')
      .map((line) => line['deduplicated']),
  ).toEqual([0, 0, 1]);
  world.clock.advance(2 * MINUTE);
  await sweep(sweepDeps, world.context('sweep-3'));
  expect(await sent(world)).toEqual([5000, 5000]);
});

test('with no served installation nothing is sent, and the job still completes', async () => {
  const world = await sweepWorld();
  await world.raw.updateTable('installations').set({ admission_status: 'rejected' }).execute();
  expect(await sweep(deps(world).deps, world.context())).toEqual({ outcome: 'fanned_out' });
  expect(await world.queued()).toEqual([]);
});

test('a reconciliation that fails fails the job and sends nothing: the queue retries it', async () => {
  const world = await sweepWorld();
  const failure = new Error('GitHub answered 502 to GET /app/installations');
  await expect(sweep(deps(world, () => Promise.reject(failure)).deps, world.context())).rejects.toBe(failure);
  expect(await world.queued()).toEqual([]);
});

test('a send that fails rolls back the sends of the run, so the retry starts them all', async () => {
  const world = await sweepWorld();
  await addNeighbour(world, 2);
  const failure = new Error('the queue is down');
  const failing = { ...world.enqueuer, enqueue: vi.fn(() => Promise.reject(failure)) };
  await expect(sweep(deps(world).deps, { ...world.context(), enqueuer: failing })).rejects.toBe(failure);
  expect(await world.queued()).toEqual([]);
});

test('the jobs it starts are swept independently: a failure of one installation leaves the other one swept', async () => {
  const world = await sweepWorld();
  const neighbour = await addNeighbour(world, 2);
  await sweep(deps(world).deps, world.context());
  world.fake.failNext('listOpenPullRequests', new Error('GitHub answered 502'));
  const jobs = (await world.queued()).flatMap(({ job }) => (job.type === 'sweep-installation' ? [job] : []));
  const settled = await Promise.allSettled(jobs.map((job, index) => world.runSweep(job, `run-${String(index)}`)));
  expect(settled.map((result) => result.status === 'fulfilled' && result.value)).toEqual([
    { outcome: 'partial' },
    { outcome: 'swept' },
  ]);
  expect(callsFor(world, neighbour.githubInstallationId)).toBe(1);
});
