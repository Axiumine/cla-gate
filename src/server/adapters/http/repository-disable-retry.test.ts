// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluatePr } from '../../services/evaluate-pr/evaluate-pr.ts';
import type { FakeEnqueuer } from '../../services/jobs-fixture/test-support.ts';
import { GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import type { JobEnqueuer } from '../../services/ports/jobs.ts';
import { setEnabled } from './repository-document-fixture/test-support.ts';
import { evaluationOf, flowWorld, interleaved, UNCOVERED } from './repository-flow-fixture/test-support.ts';

// A repository is switched off, and finalised, just before an evaluation writes its verdict (E14-S04), and the job then fails and
// is retried: after the Check Run was written but before the comment was, or because the hand-over that follows the write cannot
// be sent. The retry finds the repository off and must still leave the check of the pull request `neutral`, with GitHub stubbed
// by MSW behind the real adapter and the real reporter.

/** A queue that refuses the first `finalise-check` an evaluation sends, as one that is down for a moment would, and takes the rest. */
function refusingFirstHandOver(queue: FakeEnqueuer): JobEnqueuer {
  let refused = false;
  return {
    enqueue: (tx, job, options) => {
      if (!refused && options.idempotencyKey.startsWith('finalise-check:evaluate-pr:')) {
        refused = true;
        return Promise.reject(new Error('the queue is down'));
      }
      return queue.enqueue(tx, job, options);
    },
  };
}

const RETRIES = [
  ['the report fails after the write, and the hand-over after it reaches the queue', true, false, 'neutral'],
  ['the report fails after the write, and the hand-over after it cannot be sent either', true, true, 'failure'],
  ['the verdict is written, and the hand-over after it cannot be sent', false, true, 'failure'],
] as const;

test.each(RETRIES)(
  'a disable finalised before the write, then a job that fails and is retried, ends neutral: %s',
  async (_name, reportFails, queueRefuses, afterFirstAttempt) => {
    const world = await flowWorld();
    await setEnabled(world, world.t1.plain.repositoryId, true);
    const { envelope, context, switchOff } = evaluationOf(world, UNCOVERED);
    const queue = queueRefuses ? refusingFirstHandOver(world.queue) : world.queue;
    const cut = interleaved(world.ports.reporter, { 'before-publish': switchOff });
    // The reporter writes the Check Run, then the write of the comment fails: E09-S07 throws it for the queue to retry.
    const reporter = reportFails
      ? {
          ...cut,
          publish: async (...args: Parameters<typeof cut.publish>) => {
            await cut.publish(...args);
            throw new GitHubUnavailableError('the comment write failed');
          },
        }
      : cut;

    await expect(evaluatePr({ ...world.ports, reporter }, envelope, context('job-1', 0, queue))).rejects.toThrow(
      reportFails ? 'the comment write failed' : 'the queue is down',
    );
    await world.drain();
    expect(await world.conclusionOf(UNCOVERED)).toBe(afterFirstAttempt);

    // The queue retries the job: the repository is off, and the run the first attempt left is completed.
    expect(await evaluatePr(world.ports, envelope, context('job-1', 1, queue))).toEqual({
      outcome: 'skipped:repository_disabled',
    });
    await world.drain();
    expect(await world.conclusionOf(UNCOVERED)).toBe('neutral');
  },
);
