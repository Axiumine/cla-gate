// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { enqueueFinaliseCheck } from '../repository-job-enqueue.ts';
import { isRepositoryEnabled } from '../repository-queries.ts';
import type { EvaluateRun } from './evaluate-pr-ports.ts';

// The re-check of enforcement in the evaluation path (E14-S04). Turning enforcement off sends a `finalise-check` job per pull
// request, and the queue does not make it wait for an `evaluate-pr` that is running (a pg-boss policy holds within one queue), so
// an evaluation can be between its last look at the repository and its write while the finalisation completes the check
// `neutral`, and then write `success` or `failure` over it. The evaluation closes that itself: it reads whether the repository
// still enforces just before it writes, writes nothing when it does not, and reads it again after the write, and in both cases
// a repository that is off hands the pull request to a `finalise-check` job sent after the read. A switch-off that committed
// before the first read stops the write; one that committed after it is seen by the second read, whose job runs after the
// write, so the check ends `neutral` in every order. A job that is sent when it was not needed completes a check that is
// `neutral` already, which the reporter does safely.
//
// A hand-over that fails, or a report that fails after the Check Run was written, fails the job, and the retry must not take the
// repository being off for "nothing to do": the run the earlier attempt started or wrote may be waiting for its completion. So a
// report that fails hands the pull request over before it rethrows, and a retry that finds the repository off hands it over too.

/** The part of a run the hand-over needs: the retry of a job that finds the repository off has no resolved repository yet. */
type HandOver = Omit<EvaluateRun, 'resolved'>;

/** Sends the `finalise-check` job of the pull request in a transaction of its own, under a key that names this run and attempt. */
async function sendFinaliseCheck({ ports, job, context }: HandOver): Promise<void> {
  await ports.db.transaction().execute((tx) =>
    enqueueFinaliseCheck(tx, context.enqueuer, {
      githubInstallationId: job.githubInstallationId,
      githubRepoId: job.githubRepoId,
      prNumber: job.prNumber,
      idempotencyKey: `finalise-check:evaluate-pr:${context.jobId}:${String(context.attempt)}`,
    }),
  );
}

/**
 * Reads whether the repository of the run still enforces and, when it does not, sends the `finalise-check` job of the pull request
 * in a transaction of its own, under a key that names this run and attempt (a retry of the job after a failed send sends again).
 * @returns true when the repository is switched off (or gone): the caller writes nothing, or has written what the job now covers.
 * @throws what the database or the queue throws: the job fails and the queue retries it.
 */
export async function handOverIfOff(run: EvaluateRun): Promise<boolean> {
  const { installation, repository } = run.resolved.tenant;
  if (await isRepositoryEnabled(run.ports.db, installation.id, repository.id)) {
    return false;
  }
  await sendFinaliseCheck(run);
  return true;
}

/**
 * A job that is run again and finds its repository switched off: an earlier attempt may have started the run of the pull request
 * or written its verdict, and failed before the hand-over (or after a switch-off finalised the run, and before it wrote), so the
 * check is handed over now. The first attempt has started nothing, and the finalisation of the switch-off covers what was there.
 * @throws what the database or the queue throws: the job fails and the queue retries it.
 */
export async function handOverRetry(run: HandOver): Promise<void> {
  if (run.context.attempt > 0) {
    await sendFinaliseCheck(run);
  }
}
