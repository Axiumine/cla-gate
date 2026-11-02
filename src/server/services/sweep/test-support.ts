// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubId } from '../../../shared/github-id.ts';
import { seedTenant } from '../../adapters/db/test-support.ts';
import { createLogger } from '../../adapters/http/logger.ts';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import type { EvaluatePrPorts } from '../evaluate-pr/evaluate-pr-ports.ts';
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
import {
  createJobsTable,
  type FakeEnqueuer,
  fakeEnqueuer,
  type SentJob,
  sentJobs,
} from '../jobs-fixture/test-support.ts';
import { FakeClock } from '../test-support.ts';
import { sweepPolicyChange } from './policy-sweep.ts';
import { sweepInstallation } from './sweep-installation.ts';
import type { SweepContext, SweepPorts } from './sweep-ports.ts';

// The world of the tests of the scheduled sweep (E07-S08): the world of the `evaluate-pr` tests (a migrated database with one
// admitted tenant whose repository is enabled, a FakeGitHub that serves its repository and open pull request 7, a
// FakeReporter, a captured log), a queue in a table of the test database whose dedupe window follows a clock that moves by
// hand, and the queue as a handler sees it in memory.

export { FULL_NAME, INSTALLATION, PR_NUMBER, REPOSITORY };

/** The job that sweeps the installation of the tenant. */
export const SWEEP_JOB: EnvelopeOf<'sweep-installation'> = {
  type: 'sweep-installation',
  githubInstallationId: INSTALLATION,
};

/** The job that evaluates the open pull requests of the repository of the tenant again after a change of policy (E07-S09). */
export const POLICY_JOB: EnvelopeOf<'sweep-repository'> = {
  type: 'sweep-repository',
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  reason: 'allowlist_changed',
};

/** The head SHA of pull request 7, and another one. */
export const HEAD = commitSha(2);
export const NEWER_HEAD = commitSha(5);

/** Milliseconds in a minute. */
export const MINUTE = 60_000;

export interface SweepWorld extends EvaluateWorld {
  /** The time the dedupe windows of the queue and the age of the evaluations follow: it stands still until a test moves it. */
  readonly clock: FakeClock;
  readonly enqueuer: FakeEnqueuer;
  readonly pending: FakePendingJobs;
  readonly sweepPorts: SweepPorts;
  /** The ports of the evaluation with the clock of this world, which is what a handler of the queue is bound to. */
  readonly evaluatePorts: EvaluatePrPorts;
  readonly context: (jobId?: string) => SweepContext;
  /** Runs the job (the one of this world unless given another) as the run `jobId` (`sweep-1` unless given another). */
  readonly runSweep: (job?: EnvelopeOf<'sweep-installation'>, jobId?: string) => Promise<JobOutcome>;
  /** Runs the `sweep-repository` job (the one of this world unless given another) as the run `jobId` (`policy-1` unless given another). */
  readonly runPolicySweep: (job?: EnvelopeOf<'sweep-repository'>, jobId?: string) => Promise<JobOutcome>;
  /** The jobs the queue holds, oldest first. */
  readonly queued: () => Promise<SentJob[]>;
  /** The numbers of the pull requests an `evaluate-pr` job is queued for, in the order queued. */
  readonly queuedPulls: () => Promise<number[]>;
}

/** The world of the `evaluate-pr` tests with the queue of the sweep. `options` are those of {@link evaluateWorld}. */
export async function sweepWorld(options: Parameters<typeof evaluateWorld>[0] = {}): Promise<SweepWorld> {
  const world = await evaluateWorld(options);
  await createJobsTable(world.raw);
  const clock = new FakeClock('2026-11-02T10:00:00Z');
  const enqueuer = fakeEnqueuer(clock);
  const pending = new FakePendingJobs();
  const sweepPorts: SweepPorts = { db: world.db, github: world.fake, clock, reporter: world.reporter };
  const logger = createLogger({ logLevel: 'info' }, world.logs.destination);
  const context = (jobId = 'sweep-1'): SweepContext => ({
    logger,
    enqueuer,
    pending,
    jobId,
    signal: new AbortController().signal,
  });
  const queued = (): Promise<SentJob[]> => sentJobs(world.raw);
  const evaluatePorts: EvaluatePrPorts = { ...world.ports, clock };
  return {
    ...world,
    clock,
    enqueuer,
    pending,
    sweepPorts,
    evaluatePorts,
    context,
    runSweep: (job = SWEEP_JOB, jobId = 'sweep-1') => sweepInstallation(sweepPorts, job, context(jobId)),
    runPolicySweep: (job = POLICY_JOB, jobId = 'policy-1') => sweepPolicyChange(evaluatePorts, job, context(jobId)),
    queued,
    queuedPulls: async () => (await queued()).flatMap(({ job }) => (job.type === 'evaluate-pr' ? [job.prNumber] : [])),
  };
}

/** Stores an evaluation of pull request `prNumber` of the tenant, last touched `ageMinutes` before the clock of the world. */
export async function seedAged(
  world: SweepWorld,
  row: {
    readonly prNumber: number;
    readonly headSha: string;
    readonly result: 'in_progress' | 'success' | 'failure' | 'cancelled';
    readonly ageMinutes?: number;
  },
): Promise<number> {
  const touched = new Date(world.clock.now().getTime() - (row.ageMinutes ?? 0) * MINUTE);
  const inserted = await world.raw
    .insertInto('pr_evaluations')
    .values({
      installation_id: world.tenant.installationId,
      repository_id: world.tenant.repositoryId,
      pr_number: row.prNumber,
      head_sha: row.headSha,
      result: row.result,
      created_at: touched,
      updated_at: touched,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return inserted.id;
}

/** Opens pull request `prNumber` on GitHub's side in the repository of the tenant, at `headSha`. */
export function openPull(world: SweepWorld, prNumber: number, headSha: string = HEAD): void {
  world.fake.addPullRequest(INSTALLATION, FULL_NAME, pullRequest(prNumber, { headSha }));
}

/** An installation `n` (2 or more) beside the tenant, on the database and on GitHub, with one repository that has an open pull request 7. */
export interface Neighbour {
  readonly githubInstallationId: ReturnType<typeof parseGithubId>;
  readonly githubRepoId: ReturnType<typeof parseGithubId>;
  readonly fullName: string;
}

export async function addNeighbour(
  world: SweepWorld,
  n: number,
  state: {
    readonly admission?: 'admitted' | 'rejected';
    readonly suspended?: boolean;
    readonly deleted?: boolean;
    readonly enabled?: boolean;
  } = {},
): Promise<Neighbour> {
  const tenant = await seedTenant(world.raw, n);
  await world.raw
    .updateTable('installations')
    .set({
      admission_status: state.admission ?? 'admitted',
      suspended_at: state.suspended === true ? new Date('2026-11-01T09:30:00Z') : null,
      deleted_at: state.deleted === true ? new Date('2026-11-01T09:30:00Z') : null,
    })
    .where('id', '=', tenant.installationId)
    .execute();
  await world.raw
    .updateTable('repositories')
    .set({ enabled: state.enabled ?? true })
    .where('installation_id', '=', tenant.installationId)
    .execute();
  const neighbour: Neighbour = {
    githubInstallationId: parseGithubId(n * 5000),
    githubRepoId: parseGithubId(n * 9000),
    fullName: `org-${String(n)}/repo`,
  };
  world.fake.addInstallation(
    {
      id: neighbour.githubInstallationId,
      account: { id: parseGithubId(n * 7000), login: `org-${String(n)}`, type: 'Organization' },
      suspendedAt: null,
      permissions: {},
    },
    [{ id: neighbour.githubRepoId, fullName: neighbour.fullName }],
  );
  world.fake.addPullRequest(neighbour.githubInstallationId, neighbour.fullName, pullRequest(7));
  return neighbour;
}

/** How many calls GitHub served for the installation `githubInstallationId`. */
export const callsFor = (world: SweepWorld, githubInstallationId: Neighbour['githubInstallationId']): number =>
  world.fake.calls.filter((call) => call.installationId === githubInstallationId).length;
