// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { evaluatePr } from '../../services/evaluate-pr/evaluate-pr.ts';
import { JOB } from '../../services/evaluate-pr/test-support.ts';
import { type FakeEnqueuer, sentJobs } from '../../services/jobs-fixture/test-support.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import { disableRepository } from '../../services/repository-disablement.ts';
import { realPostgresOnly, withConnections } from '../db/test-support.ts';
import { interleaved, liveWorld } from './repository-flow-fixture/test-support.ts';

// A switch-off that races an evaluation that is running (E14-S04, criterion g), on two real connections: the disable has written the
// flag and its job and has not committed while the evaluation goes on, and commits at a chosen point of it. The check on the head SHA
// of the open pull request ends `neutral`, never `failure` or `in_progress`, whatever the point. The order is decided by who reaches a
// gate, never by a timer. PGlite has one session, so an open transaction would stop every other statement: these tests run in the CI
// `postgres` job only. The same cuts run in sequence on any engine in repository-disable-interleaving.test.ts.

/** A queue that holds the send of the finalisation open: `reached` settles when the disable has written its job, `release` lets it commit. */
function holdingSend() {
  const reached = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  const through = (queue: FakeEnqueuer): JobEnqueuer => ({
    enqueue: async (tx, job, options) => {
      const outcome = await queue.enqueue(tx, job, options);
      reached.resolve(undefined);
      await released.promise;
      return outcome;
    },
  });
  return {
    through,
    reached: reached.promise,
    release: () => {
      released.resolve(undefined);
    },
  };
}

/**
 * The tenant of the `evaluate-pr` tests on a real server, and a disable on a connection of its own that the test can begin and
 * commit. Begun, the disable holds the repository row and has not committed. It is begun once the evaluation has opened its run: an
 * evaluation that had yet to insert its own row would wait for the disable (the lock order of E14-S03, not what these tests are about).
 */
async function racingWorld() {
  const hold = holdingSend();
  const world = await liveWorld();
  const disabler = withConnections(1).get(0);
  let disabling: ReturnType<typeof disableRepository> | undefined;
  return {
    world,
    begin: async () => {
      disabling = disableRepository(
        disabler,
        { installationId: world.tenant.installationId },
        hold.through(world.queue),
        {
          repositoryId: world.tenant.repositoryId,
          role: 'org_admin',
          actorGithubId: parseGithubId(1234),
        },
      );
      await hold.reached;
    },
    commit: async () => {
      hold.release();
      expect(await disabling).toEqual({ enabled: false, changed: true });
      await world.drain();
    },
  };
}

const context = (world: Awaited<ReturnType<typeof liveWorld>>) => ({
  attempt: 0,
  logger: world.logger,
  enqueuer: world.queue,
  jobId: 'eval-1',
});

/** The `finalise-repository` jobs the disable has committed. */
const finalisations = async (world: Awaited<ReturnType<typeof liveWorld>>) =>
  (await sentJobs(world.raw)).filter((sent) => sent.job.type === 'finalise-repository');

/** Runs the evaluation of pull request 7 with a disable begun after its run was opened and committed at `cut`. */
async function evaluatedWhileDisabling(cut: 'before-publish' | 'after-publish') {
  const { world, begin, commit } = await racingWorld();
  const reporter = interleaved(world.ports.reporter, { 'after-started': begin, [cut]: commit });
  expect(await evaluatePr({ ...world.ports, reporter }, JOB, context(world))).toEqual({ outcome: 'evaluated' });
  await world.drain();
  return world;
}

/** Every write the mocked GitHub accepted for the Check Runs, as its conclusion (or its status while the run is open). */
const conclusionsOf = (world: Awaited<ReturnType<typeof liveWorld>>) =>
  world.github.checkRunWrites.map((write) => write.write.conclusion ?? write.write.status);

test('with no switch-off in its way the evaluation of the live world leaves the check red and hands nothing over, on whatever engine runs the suite', async () => {
  const world = await liveWorld();
  expect(await evaluatePr(world.ports, JOB, context(world))).toEqual({ outcome: 'evaluated' });
  await world.drain();
  expect(conclusionsOf(world)).toEqual(['in_progress', 'failure']);
  expect(await sentJobs(world.raw)).toEqual([]);
});

realPostgresOnly(
  'a disable that is still open while an evaluation writes its verdict is invisible to it, and the finalisation it sends makes the check neutral once it commits',
  async () => {
    const { world, begin, commit } = await racingWorld();
    const reporter = interleaved(world.ports.reporter, { 'after-started': begin });
    expect(await evaluatePr({ ...world.ports, reporter }, JOB, context(world))).toEqual({ outcome: 'evaluated' });
    expect(conclusionsOf(world)).toEqual(['in_progress', 'failure']);
    // The job the disable sent is part of its transaction: nothing can run it before it commits.
    expect(await finalisations(world)).toEqual([]);
    await commit();
    expect(await finalisations(world)).toHaveLength(1);
    expect(conclusionsOf(world)).toEqual(['in_progress', 'failure', 'neutral']);
  },
);

realPostgresOnly(
  'a disable that commits just before the evaluation writes its verdict leaves the check neutral: the verdict lands over the finalisation, and the hand-over of the evaluation completes it again',
  async () => {
    const world = await evaluatedWhileDisabling('before-publish');
    expect(conclusionsOf(world)).toEqual(['in_progress', 'neutral', 'failure', 'neutral']);
  },
);

realPostgresOnly(
  'a disable that commits just after the evaluation wrote its verdict leaves the check neutral: the re-check of the evaluation hands the pull request over once more',
  async () => {
    const world = await evaluatedWhileDisabling('after-publish');
    expect(conclusionsOf(world)).toEqual(['in_progress', 'failure', 'neutral', 'neutral']);
  },
);
