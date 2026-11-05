// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
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
import { commitSha, pullRequest } from '../github-pull-contract/test-support.ts';
import type { JobOutcome } from '../job-registry.ts';
import { FakePendingJobs } from '../job-run-fixture/test-support.ts';
import { closePr } from './close-pr.ts';
import type { ClosePrPorts } from './close-pr-ports.ts';

// The world of the tests of the `close-pr` job (E07-S06): the world of the `evaluate-pr` tests (a migrated database with one
// tenant, a FakeGitHub that serves its repository and pull request 7, a FakeReporter, a captured log), in which pull request
// 7 has been closed on GitHub, with the queue as a handler sees it in memory.

export { FULL_NAME, INSTALLATION, PR_NUMBER, REPOSITORY };

/** The job that prunes pull request 7 of the repository of the tenant. */
export const CLOSE_JOB: EnvelopeOf<'close-pr'> = {
  type: 'close-pr',
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  prNumber: PR_NUMBER,
};

/** The head SHA of pull request 7. */
export const HEAD = commitSha(2);

export interface CloseWorld extends EvaluateWorld {
  readonly pending: FakePendingJobs;
  readonly closePorts: ClosePrPorts;
  /** Runs the job (the one of this world unless given another) on the ports of this world, as its first attempt. */
  readonly runClose: (job?: EnvelopeOf<'close-pr'>) => Promise<JobOutcome>;
}

/** The world of the `evaluate-pr` tests with pull request 7 closed on GitHub. `options` are those of {@link evaluateWorld}. */
export async function closeWorld(options: Parameters<typeof evaluateWorld>[0] = {}): Promise<CloseWorld> {
  const world = await evaluateWorld(options);
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(PR_NUMBER, { state: 'closed' }));
  const pending = new FakePendingJobs();
  const logger = createLogger({ logLevel: 'info' }, world.logs.destination);
  return {
    ...world,
    pending,
    closePorts: world.ports,
    runClose: (job = CLOSE_JOB) => closePr(world.ports, job, { logger, pending }),
  };
}

/** Stores an evaluation of pull request `prNumber` (7 unless given) of the tenant at `headSha`, as the evaluation job leaves it. */
export async function seedEvaluation(
  world: EvaluateWorld,
  row: {
    readonly result: 'in_progress' | 'success' | 'failure' | 'cancelled';
    readonly headSha?: string;
    readonly prNumber?: number;
    readonly checkRunId?: number | null;
    /** Whether the pull request is open or closed (E15-S01); open unless given. */
    readonly prState?: 'open' | 'closed';
  },
): Promise<number> {
  const inserted = await world.raw
    .insertInto('pr_evaluations')
    .values({
      installation_id: world.tenant.installationId,
      repository_id: world.tenant.repositoryId,
      pr_number: row.prNumber ?? PR_NUMBER,
      head_sha: row.headSha ?? HEAD,
      result: row.result,
      check_run_id: row.checkRunId ?? null,
      pr_state: row.prState ?? 'open',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return inserted.id;
}

/** The rows of `pr_evaluations` as `[pr number, head SHA, result]`, oldest first. */
export async function resultsOf(world: EvaluateWorld): Promise<[number, string, string][]> {
  return (await world.rows()).map((row) => [row.pr_number, row.head_sha, row.result]);
}

/** The rows of `pr_evaluations` as `[pr number, head SHA, pr_state]`, oldest first (E15-S01). */
export async function statesOf(world: EvaluateWorld): Promise<[number, string, string][]> {
  const rows = await world.raw
    .selectFrom('pr_evaluations')
    .select(['pr_number', 'head_sha', 'pr_state'])
    .orderBy('id')
    .execute();
  return rows.map((row) => [row.pr_number, row.head_sha, row.pr_state]);
}

/** When each row of `pr_evaluations` was last touched, oldest row first, as milliseconds: what a change of state must leave as it is (E15-S01). */
export async function touchedOf(world: EvaluateWorld): Promise<number[]> {
  const rows = await world.raw.selectFrom('pr_evaluations').select('updated_at').orderBy('id').execute();
  return rows.map((row) => row.updated_at.getTime());
}
