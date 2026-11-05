// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import type { GithubId } from '../../../shared/github-id.ts';
import { parseGithubId } from '../../../shared/github-id.ts';
import { seedTenant } from '../../adapters/db/test-support.ts';
import { createLogger } from '../../adapters/http/logger.ts';
import type { Evaluation } from '../../domain/evaluation/index.ts';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import { type EvaluateWorld, FULL_NAME, INSTALLATION, passing, REPOSITORY } from '../evaluate-pr/test-support.ts';
import { account, commit, commitSha, pullRequest } from '../github-pull-contract/test-support.ts';
import type { JobOutcome } from '../job-registry.ts';
import { evaluateMergeGroup } from './evaluate-merge-group.ts';

// The scenes of the tests of the merge group job (E22-S01), built on the world of the evaluate-pr tests: a repository whose queue
// holds a group of pull requests, each squashed into one commit on top of the base branch tip. The pull requests are numbered by
// the caller, the opener of pull request `n` is user `n`, and its one commit is `prHead(n)`. Nothing here is a real repository: the
// shapes follow the documented merge queue (the name of the group's branch ends in the number of the last pull request, the
// commits of the range are associated with their pull request), which no test can verify against GitHub.

/** The tip of the base branch the groups of the scenes are built on. */
export const BASE = commitSha(0x5000);

/** The commit a pull request adds to the group: the `index`-th of the range, counted from the base. */
export const groupCommit = (index: number): string => commitSha(0x6000 + index);

/** The head SHA of pull request `number`, as the pull request itself has it (not the commit of the group). */
export const prHead = (number: number): string => commitSha(0x7000 + number);

/** The repository a group is queued in: the ids the webhook names and the name GitHub shows. */
export interface Home {
  readonly installation: GithubId;
  readonly repository: GithubId;
  readonly fullName: string;
}

/** The repository of the world of the evaluate-pr tests: tenant 1, installation 5000. */
export const HOME: Home = { installation: INSTALLATION, repository: REPOSITORY, fullName: FULL_NAME };

/** What a scene is: the group GitHub built, as the webhook names it. */
export interface Scene extends Home {
  /** The head SHA of the group: the commit the Check Run goes on. */
  readonly head: string;
  readonly base: string;
  readonly numbers: readonly number[];
  /** The number of the last pull request queued, the one the name of the group's branch gives. */
  readonly tip: number;
}

/**
 * Adds to the GitHub of `world` a merge group of the pull requests `numbers`, in the order they were queued: one commit each on
 * top of the base, the pull request each commit is associated with, and each pull request open, with its opener and its one commit.
 * The head of the group is the commit of the last pull request.
 */
export function addGroup(world: Pick<EvaluateWorld, 'fake'>, numbers: readonly number[], home: Home = HOME): Scene {
  const { fake } = world;
  const { installation, fullName } = home;
  const chain = numbers.map((number, index) =>
    commit(number, { sha: groupCommit(index), parents: [index === 0 ? BASE : groupCommit(index - 1)] }),
  );
  fake.setRepositoryCommits(installation, fullName, chain.toReversed());
  const head = groupCommit(numbers.length - 1);
  fake.setMergeBase(installation, fullName, { baseSha: BASE, headSha: head }, BASE);
  numbers.forEach((number, index) => {
    fake.addPullRequest(
      installation,
      fullName,
      pullRequest(number, { headSha: prHead(number), baseSha: BASE, opener: account(number), commitCount: 1 }),
    );
    fake.setPullRequestCommits(installation, fullName, number, [
      commit(number, { sha: prHead(number), parents: [BASE] }),
    ]);
    fake.setCommitPullRequests(installation, fullName, groupCommit(index), [
      { number, state: 'open', headSha: prHead(number) },
    ]);
  });
  return { ...home, head, base: BASE, numbers, tip: numbers.reduce((_previous, number) => number, 0) };
}

/** The job the webhook starts for the group of `scene`: the number of its last pull request is the one its branch name gives. */
export function groupJob(
  scene: Scene,
  overrides: Partial<EnvelopeOf<'evaluate-merge-group'>> = {},
): EnvelopeOf<'evaluate-merge-group'> {
  return {
    type: 'evaluate-merge-group',
    githubInstallationId: scene.installation,
    githubRepoId: scene.repository,
    headSha: scene.head,
    baseSha: scene.base,
    tipPrNumber: scene.tip,
    ...overrides,
  };
}

/** Runs the job of the merge group on the ports of `world`. */
export function runGroup(world: EvaluateWorld, job: EnvelopeOf<'evaluate-merge-group'>): Promise<JobOutcome> {
  const logger = createLogger({ logLevel: 'info' }, world.logs.destination);
  return evaluateMergeGroup(world.ports, job, { logger });
}

/** The verdict of the engine for a pull request that is not covered. */
const FAILING: Evaluation = { ...passing(), outcome: 'failure', failureCodes: ['unsigned_contributor'] };

/** The engine of `world` fails the pull requests `numbers` (their opener is user `n`) and passes every other one. */
export function failFor(world: EvaluateWorld, numbers: readonly number[]): void {
  world.evaluate.mockImplementation((input) => (numbers.includes(input.opener.id) ? FAILING : passing()));
}

/** The rows of `merge_group_evaluations`, oldest first. */
export function groupRows(world: EvaluateWorld) {
  return world.raw
    .selectFrom('merge_group_evaluations')
    .select([
      'id',
      'installation_id',
      'repository_id',
      'head_sha',
      'base_sha',
      'result',
      'details',
      'check_run_id',
      'destroyed_at',
    ])
    .orderBy('id')
    .execute();
}

/** Marks the group of `scene` destroyed in the database, as the `destroyed` delivery does. */
export async function destroyGroup(world: EvaluateWorld, scene: Scene): Promise<void> {
  await world.raw
    .updateTable('merge_group_evaluations')
    .set({ destroyed_at: new Date('2026-11-02T10:00:00Z') })
    .where('head_sha', '=', scene.head)
    .execute();
}

/** The head SHAs the fake reporter was given reports for, in order: one per report, whatever the group. */
export const reportedHeads = (world: EvaluateWorld): string[] =>
  world.reporter.groups.map(({ target }) => target.headSha);

/** The results the fake reporter was given for merge groups, in order. */
export const reportedResults = (world: EvaluateWorld) => world.reporter.groups.map(({ result }) => result);

/**
 * A second tenant (`org-2`, installation 10000, repository 18000), admitted and enforcing, in the database and in the GitHub of
 * `world`: the neighbour that has a group with the very same commits.
 */
export async function secondTenant(world: EvaluateWorld): Promise<Home> {
  const other = await seedTenant(world.raw, 2);
  await sql`update installations set admission_status = 'admitted', admission_reason = null where id = ${other.installationId}`.execute(
    world.raw,
  );
  await world.raw
    .updateTable('repositories')
    .set({ enabled: true, cla_document_id: other.documentId })
    .where('installation_id', '=', other.installationId)
    .execute();
  const home: Home = { installation: parseGithubId(10_000), repository: parseGithubId(18_000), fullName: 'org-2/repo' };
  world.fake.addInstallation(
    {
      id: home.installation,
      account: { id: parseGithubId(14_000), login: 'org-2', type: 'Organization' },
      suspendedAt: null,
      permissions: {},
    },
    [{ id: home.repository, fullName: home.fullName }],
  );
  return home;
}
