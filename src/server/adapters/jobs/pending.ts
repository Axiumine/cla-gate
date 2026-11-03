// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PendingJobs, PendingWorkTarget } from '../../services/ports/jobs.ts';
import type { Boss } from './boss.ts';
import type { QueueName } from './queues.ts';

// The jobs that wait for a pull request, and how they are dropped when it is closed (E07-S06). It goes through pg-boss's own
// API (`findJobs` and `cancel`), never through its tables: the layout of the `pgboss` schema is pg-boss's to change.

/** The queues whose job names the pull request itself (`prNumber` in the payload). */
const BY_PULL_REQUEST = ['evaluate-pr', 'recheck-comment'] as const satisfies readonly QueueName[];

/** The queue whose job names a head SHA and no pull request. */
const BY_HEAD_SHA = 'evaluate-head-sha' satisfies QueueName;

export class PgBossPendingJobs implements PendingJobs {
  readonly #boss: Boss;

  constructor(boss: Boss) {
    this.#boss = boss;
  }

  /**
   * Cancels the jobs of `queue` whose payload contains `data`, but only the ones that wait (`created` and `retry`): pg-boss
   * cancels a running job as well, and a running job is left to finish (its steps 2 and 8 see the closed pull request,
   * E07-S04). The payload always carries the installation, so a job of another installation is never matched.
   */
  async #cancelWaiting(queue: QueueName, data: object): Promise<number> {
    const jobs = await this.#boss.findJobs(queue, { data, queued: true });
    if (jobs.length > 0) {
      await this.#boss.cancel(
        queue,
        jobs.map((job) => job.id),
      );
    }
    return jobs.length;
  }

  async cancelForPullRequest(target: PendingWorkTarget): Promise<number> {
    const { githubInstallationId, githubRepoId, prNumber, headShas } = target;
    const repository = { githubInstallationId, githubRepoId };
    const counts = await Promise.all([
      ...BY_PULL_REQUEST.map((queue) => this.#cancelWaiting(queue, { ...repository, prNumber })),
      ...headShas.map((headSha) => this.#cancelWaiting(BY_HEAD_SHA, { ...repository, headSha })),
    ]);
    return counts.reduce((total, count) => total + count, 0);
  }
}
