// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluatePr } from '../../services/evaluate-pr/evaluate-pr.ts';
import { account, commit, commitSha, pullRequest } from '../../services/github-pull-contract/test-support.ts';
import { sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { overrideOf, recordAs } from './commit-override-fixture/test-support.ts';
import {
  type FlowWorld,
  FULL_NAME,
  storedEvaluation,
  summaryOf,
  unlinkedWorld,
} from './commit-override-flow-fixture/test-support.ts';
import { pointAt } from './repository-document-fixture/test-support.ts';
import { enableAs } from './repository-enable-fixture/test-support.ts';
import { COVERED, UNCOVERED } from './repository-flow-fixture/test-support.ts';

// Recording an override, from the click to the Check Runs (E15-S05), with GitHub stubbed by MSW behind the real Octokit adapter, the
// jobs run in-process in the order the queue would, the real engine and the real reporter. The first commit of the pull request COVERED
// (opened by tenant 1's signer) and of UNCOVERED (opened by someone who signed nothing) has an author whose email GitHub cannot link
// to an account, so both fail for it; the override waives that identity and nothing else.

const signatureCount = async (world: FlowWorld) =>
  (await world.db.selectFrom('signatures').select('id').execute()).length;

test('a pull request that fails on an unlinked author turns success after the override when its opener is covered, and the summary counts the maintainer override', async () => {
  const world = await unlinkedWorld();
  const { t1 } = world;
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await world.drain();
  expect(await world.conclusionOf(COVERED)).toBe('failure');
  const before = await storedEvaluation(world, t1.plain.repositoryId, COVERED);
  expect(before.details.failureCodes).toEqual(['unlinked_identity']);
  expect(before.details.unlinked).toEqual([{ sha: commitSha(1), role: 'author', overrideId: null }]);
  const signatures = await signatureCount(world);

  const response = await recordAs(world, 'admin1', t1.plain.repositoryId, commitSha(1));
  expect(response.statusCode).toBe(201);
  await world.drain();

  expect(await world.conclusionOf(COVERED)).toBe('success');
  const after = await storedEvaluation(world, t1.plain.repositoryId, COVERED);
  expect(after.details.failureCodes).toEqual([]);
  expect(after.details.unlinked).toEqual([{ sha: commitSha(1), role: 'author', overrideId: overrideOf(response).id }]);
  expect(await summaryOf(world, COVERED)).toContain(
    '2 contributors covered: 1 by signature, 1 by maintainer override.',
  );
  expect(await signatureCount(world)).toBe(signatures);
});

test('the pull request of an opener who is not covered stays a failure after the override: it waives the unlinked author and signs for nobody', async () => {
  const world = await unlinkedWorld();
  const { t1, people } = world;
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await world.drain();
  expect(await world.conclusionOf(UNCOVERED)).toBe('failure');
  const before = await storedEvaluation(world, t1.plain.repositoryId, UNCOVERED);
  expect(before.details.failureCodes).toContain('unlinked_identity');

  const response = await recordAs(world, 'admin1', t1.plain.repositoryId, commitSha(3));
  expect(response.statusCode).toBe(201);
  await world.drain();

  expect(await world.conclusionOf(UNCOVERED)).toBe('failure');
  const after = await storedEvaluation(world, t1.plain.repositoryId, UNCOVERED);
  expect(after.details.failureCodes).not.toContain('unlinked_identity');
  expect(after.details.failureCodes.length).toBeGreaterThan(0);
  expect(after.details.unlinked).toEqual([{ sha: commitSha(3), role: 'author', overrideId: overrideOf(response).id }]);
  expect(after.details.actors).toContainEqual(
    expect.objectContaining({ githubId: people.outsider.githubId, covered: false }),
  );
  // The pull request COVERED was evaluated again too (it was failing), and still fails: its unlinked author has no override.
  expect(await world.conclusionOf(COVERED)).toBe('failure');
});

test('every other commit still has to be covered: an uncovered author of the next commit keeps the pull request a failure after the override of the first', async () => {
  const world = await unlinkedWorld();
  const { t1, people, github } = world;
  const signer = account(people.member1.githubId);
  const stranger = account(people.outsider.githubId);
  github.setPullRequestCommits(t1.githubInstallationId, FULL_NAME, COVERED, [
    commit(1, { author: null, committer: signer }),
    commit(2, { author: stranger, committer: stranger }),
  ]);
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await world.drain();
  const response = await recordAs(world, 'admin1', t1.plain.repositoryId, commitSha(1));
  expect(response.statusCode).toBe(201);
  await world.drain();
  expect(await world.conclusionOf(COVERED)).toBe('failure');
  const after = await storedEvaluation(world, t1.plain.repositoryId, COVERED);
  expect(after.details.failureCodes).not.toContain('unlinked_identity');
  expect(after.details.unlinked).toEqual([{ sha: commitSha(1), role: 'author', overrideId: overrideOf(response).id }]);
  expect(after.details.actors).toContainEqual(
    expect.objectContaining({ githubId: people.outsider.githubId, covered: false }),
  );
});

test('the override of a commit another pull request does not carry changes nothing for it: an override waives its own commit only', async () => {
  const world = await unlinkedWorld();
  const { t1 } = world;
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await world.drain();
  const response = await recordAs(world, 'admin1', t1.plain.repositoryId, commitSha(3));
  expect(response.statusCode).toBe(201);
  await world.drain();
  expect(await world.conclusionOf(COVERED)).toBe('failure');
  const covered = await storedEvaluation(world, t1.plain.repositoryId, COVERED);
  expect(covered.details.unlinked).toEqual([{ sha: commitSha(1), role: 'author', overrideId: null }]);
});

/** Puts tenant 2 on the mocked GitHub with the same two commits as pull request COVERED of tenant 1, and turns its repository on. */
async function enableTenantTwo(world: FlowWorld): Promise<void> {
  const { t2, people, github } = world;
  const fullName = 'org-2/repo';
  const signer = account(people.admin2.githubId);
  github.addInstallation(
    {
      id: t2.githubInstallationId,
      account: { id: t2.accountId, login: t2.accountLogin, type: 'Organization' },
      suspendedAt: null,
      permissions: {},
    },
    [{ id: t2.plain.githubRepoId, fullName }],
  );
  github.addPullRequest(
    t2.githubInstallationId,
    fullName,
    pullRequest(COVERED, { opener: signer, headSha: commitSha(2) }),
  );
  github.setPullRequestCommits(t2.githubInstallationId, fullName, COVERED, [
    commit(1, { author: null, committer: signer }),
    commit(2, { author: signer, committer: signer }),
  ]);
  await pointAt(world, t2.plain.repositoryId, t2.documentId);
  await enableAs(world, 'admin2', t2.plain.repositoryId);
}

test("an override of tenant 1 never changes tenant 2's evaluation of the same commit: it stays a failure, and no job is sent for tenant 2", async () => {
  const world = await unlinkedWorld();
  const { t1, t2 } = world;
  await enableTenantTwo(world);
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await world.drain();
  expect((await storedEvaluation(world, t2.plain.repositoryId, COVERED)).result).toBe('failure');
  const sent = (await sentJobs(world.db)).length;

  const response = await recordAs(world, 'admin1', t1.plain.repositoryId, commitSha(1));
  expect(response.statusCode).toBe(201);
  await world.drain();
  expect(await world.conclusionOf(COVERED)).toBe('success');
  const jobs = (await sentJobs(world.db)).slice(sent).map(({ job }) => job);
  expect(jobs.length).toBeGreaterThan(0);
  expect(
    jobs.every((job) => 'githubInstallationId' in job && job.githubInstallationId === t1.githubInstallationId),
  ).toBe(true);

  // Evaluated again from scratch, tenant 2's pull request is still a failure: the override is not in its policy.
  await evaluatePr(
    world.ports,
    {
      type: 'evaluate-pr',
      githubInstallationId: t2.githubInstallationId,
      githubRepoId: t2.plain.githubRepoId,
      prNumber: COVERED,
      trigger: 'policy_change',
    },
    { logger: world.logger, enqueuer: world.queue, jobId: 'tenant-two-again', attempt: 0 },
  );
  const tenantTwo = await storedEvaluation(world, t2.plain.repositoryId, COVERED);
  expect(tenantTwo.result).toBe('failure');
  expect(tenantTwo.details.failureCodes).toEqual(['unlinked_identity']);
  expect(tenantTwo.details.unlinked).toEqual([{ sha: commitSha(1), role: 'author', overrideId: null }]);
});

test('the lookup of the commit is the one GitHub request of the record, made for the repository with the installation token', async () => {
  const world = await unlinkedWorld();
  const { t1 } = world;
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  const asked = world.github.requests.length;
  const response = await recordAs(world, 'admin1', t1.plain.repositoryId, commitSha(1));
  expect(response.statusCode).toBe(201);
  expect(world.github.requests.slice(asked).filter((request) => request.includes('/commits/'))).toEqual([
    expect.stringContaining(`/repos/${FULL_NAME}/commits/${commitSha(1)}`),
  ]);
});
