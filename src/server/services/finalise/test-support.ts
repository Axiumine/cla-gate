// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import { createLogger } from '../../adapters/http/logger.ts';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import { HEAD, seedEvaluation } from '../close-pr/test-support.ts';
import {
  type EvaluateWorld,
  evaluateWorld,
  FULL_NAME,
  INSTALLATION,
  PR_NUMBER,
  REPOSITORY,
} from '../evaluate-pr/test-support.ts';
import type { JobOutcome } from '../job-registry.ts';
import {
  createJobsTable,
  type FakeEnqueuer,
  fakeEnqueuer,
  type SentJob,
  sentJobs,
} from '../jobs-fixture/test-support.ts';
import { finaliseCheck } from './finalise-check.ts';
import { finaliseRepository } from './finalise-repository.ts';

// The world of the tests of the two finalise jobs (E14-S04): the world of the `evaluate-pr` tests (a migrated database with one
// tenant, a FakeGitHub that serves its repository and the open pull request 7 at `HEAD`, a FakeReporter, a captured log) in which
// enforcement has been turned off, and the fake queue that writes into a test table.

export { FULL_NAME, HEAD, INSTALLATION, PR_NUMBER, REPOSITORY, seedEvaluation };

/** The job that finalises the check of pull request 7 of the repository of the tenant. */
export const CHECK_JOB: EnvelopeOf<'finalise-check'> = {
  type: 'finalise-check',
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  prNumber: PR_NUMBER,
};

/** The job that finalises the pending checks of the repository of the tenant. */
export const REPOSITORY_JOB: EnvelopeOf<'finalise-repository'> = {
  type: 'finalise-repository',
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
};

export interface FinaliseWorld extends EvaluateWorld {
  /** The logger of the jobs, which writes into the captured log of the world. */
  readonly logger: Logger;
  /** The fake queue the jobs send to, which writes into the test table. */
  readonly enqueuer: FakeEnqueuer;
  /** The jobs the finalise jobs sent, in order. */
  readonly sent: () => Promise<SentJob[]>;
  /** Runs `finalise-check` (the job of this world unless given another) on the ports of this world, as the job `jobId`. */
  readonly runCheck: (job?: EnvelopeOf<'finalise-check'>, jobId?: string) => Promise<JobOutcome>;
  /** Runs `finalise-repository` (the job of this world unless given another) on the ports of this world, as the job `jobId`. */
  readonly runRepository: (job?: EnvelopeOf<'finalise-repository'>, jobId?: string) => Promise<JobOutcome>;
}

/** The world of the `evaluate-pr` tests with enforcement turned off for the repository. `options` are those of {@link evaluateWorld}. */
export async function finaliseWorld(options: Parameters<typeof evaluateWorld>[0] = {}): Promise<FinaliseWorld> {
  const world = await evaluateWorld(options);
  await world.raw.updateTable('repositories').set({ enabled: false }).execute();
  await createJobsTable(world.raw);
  const enqueuer = fakeEnqueuer();
  const logger = createLogger({ logLevel: 'info' }, world.logs.destination);
  return {
    ...world,
    logger,
    enqueuer,
    sent: () => sentJobs(world.raw),
    runCheck: (job = CHECK_JOB, jobId = 'job-1') => finaliseCheck(world.ports, job, { logger, enqueuer, jobId }),
    runRepository: (job = REPOSITORY_JOB, jobId = 'job-1') =>
      finaliseRepository(world.ports, job, { logger, enqueuer, jobId }),
  };
}

/** The states of the tenant in which a finalise job ends as skipped with no GitHub call, as `[reason, statement that brings it about]`. */
export const NOT_FINALISED = [
  ['installation_rejected', "update installations set admission_status = 'rejected'"],
  ['installation_deleted', 'update installations set deleted_at = now()'],
  ['installation_suspended', 'update installations set suspended_at = now()'],
  ['repository_removed', 'update repositories set removed_at = now()'],
  ['repository_enabled', 'update repositories set enabled = true'],
] as const;

/** Stores `count` evaluations, one per pull request numbered from 1, all at one head SHA and with `result`, in one statement. */
export async function seedMany(world: EvaluateWorld, count: number, result: 'in_progress' | 'failure'): Promise<void> {
  await world.raw
    .insertInto('pr_evaluations')
    .values(
      Array.from({ length: count }, (_unused, index) => ({
        installation_id: world.tenant.installationId,
        repository_id: world.tenant.repositoryId,
        pr_number: index + 1,
        head_sha: '5'.repeat(40),
        result,
      })),
    )
    .execute();
}
