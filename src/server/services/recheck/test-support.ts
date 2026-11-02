// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubId } from '../../../shared/github-id.ts';
import { createLogger } from '../../adapters/http/logger.ts';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import {
  type EvaluateWorld,
  evaluateWorld,
  FULL_NAME,
  INSTALLATION,
  PR_NUMBER,
  REPOSITORY,
} from '../evaluate-pr/test-support.ts';
import { comment } from '../github-comment-contract/test-support.ts';
import { commitSha } from '../github-pull-contract/test-support.ts';
import type { JobOutcome } from '../job-registry.ts';
import {
  createJobsTable,
  type FakeEnqueuer,
  fakeEnqueuer,
  type SentJob,
  sentJobs,
} from '../jobs-fixture/test-support.ts';
import type { JobEnqueuer } from '../ports/jobs.ts';
import { FakeClock } from '../test-support.ts';
import { recheckComment } from './recheck-comment.ts';
import type { RecheckContext, RecheckPorts } from './recheck-ports.ts';
import { rerunHeadSha } from './rerun-head-sha.ts';

// The world of the tests of the manual re-evaluation (E07-S07): the world of the `evaluate-pr` tests (a migrated database
// with one tenant, a FakeGitHub that serves its repository and open pull request 7), a queue in a table of the test database
// whose dedupe window follows a clock that moves by hand, and a comment by a person on pull request 7 whose text is the command.

export { FULL_NAME, INSTALLATION, PR_NUMBER, REPOSITORY };

export const COMMENT_ID = parseGithubId(5001);

/** The head SHA of pull request 7. */
export const HEAD = commitSha(2);

/** The job for the comment `COMMENT_ID` on pull request 7. */
export const COMMENT_JOB: EnvelopeOf<'recheck-comment'> = {
  type: 'recheck-comment',
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  prNumber: PR_NUMBER,
  commentId: COMMENT_ID,
};

/** The job that re-runs the checks of the head SHA of pull request 7. */
export const HEAD_JOB: EnvelopeOf<'evaluate-head-sha'> = {
  type: 'evaluate-head-sha',
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  headSha: HEAD,
};

export interface RecheckWorld extends EvaluateWorld {
  /** The time the dedupe window of the queue follows: it stands still until a test moves it. */
  readonly clock: FakeClock;
  readonly enqueuer: FakeEnqueuer;
  readonly recheckPorts: RecheckPorts;
  /** Runs the comment job (the one of this world unless given another) as the first run of job `job-1`. */
  readonly runComment: (job?: EnvelopeOf<'recheck-comment'>, enqueuer?: JobEnqueuer) => Promise<JobOutcome>;
  /** Runs the head SHA job (the one of this world unless given another) as the first run of job `job-1`. */
  readonly runHead: (job?: EnvelopeOf<'evaluate-head-sha'>, enqueuer?: JobEnqueuer) => Promise<JobOutcome>;
  /** The jobs the queue holds, oldest first. */
  readonly queued: () => Promise<SentJob[]>;
}

/** The world of the `evaluate-pr` tests with the queue and the comment of {@link COMMENT_ID}. `options` are those of {@link evaluateWorld}. */
export async function recheckWorld(options: Parameters<typeof evaluateWorld>[0] = {}): Promise<RecheckWorld> {
  const world = await evaluateWorld(options);
  await createJobsTable(world.raw);
  world.fake.addIssueComment(INSTALLATION, FULL_NAME, comment(COMMENT_ID));
  const clock = new FakeClock('2026-11-02T10:00:00Z');
  const enqueuer = fakeEnqueuer(clock);
  const recheckPorts: RecheckPorts = { db: world.db, github: world.fake, clock };
  const logger = createLogger({ logLevel: 'info' }, world.logs.destination);
  const context = (queue: JobEnqueuer): RecheckContext => ({ logger, enqueuer: queue, jobId: 'job-1' });
  return {
    ...world,
    clock,
    enqueuer,
    recheckPorts,
    runComment: (job = COMMENT_JOB, queue = enqueuer) => recheckComment(recheckPorts, job, context(queue)),
    runHead: (job = HEAD_JOB, queue = enqueuer) => rerunHeadSha(recheckPorts, job, context(queue)),
    queued: () => sentJobs(world.raw),
  };
}
