// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { failureDetails } from '../../domain/failure-details-fixture/test-support.ts';
import { writeClaim } from '../../services/corporate-claim-write.ts';
import { resolveCorporateTarget } from '../../services/corporate-target.ts';
import { fakeEnqueuer, jobCount, sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { storePr } from '../../services/revocation-fixture/test-support.ts';
import { revokeAs, revokeSignature } from './corporate-approval-fixture/test-support.ts';
import {
  ACME_DOMAIN,
  ACME_ORG,
  approveDomain,
  approveOrg,
  approvePerson,
  claimAs,
  claimAuditOf,
  claimOf,
  claimWorld,
  employee,
  evaluationsSent,
  loginOf,
  userApprovalsOf,
} from './corporate-claim-fixture/test-support.ts';
import { failureOf } from './corporate-fixture/test-support.ts';

// What a claim sets going and what races with it (E21-S04): the open pull requests of the person are evaluated again by the job a signature
// asks for (`evaluate-pr`, keyed by the action), in the transaction of the claim; and a manager who revokes while the claim waits for GitHub wins.

const EMMA = 7101;

/** Tenant 1 with an approved domain, Emma, and the pull requests of every kind that a claim may or may not send for. */
async function crowdedWorld() {
  const world = await claimWorld();
  await approveDomain(world, ACME_DOMAIN);
  const emma = await employee(world, EMMA);
  const { db, t1, t2 } = world;
  const failing = failureDetails({ uncovered: [EMMA] });
  await storePr(db, t1, 'plain', { prNumber: 61, result: 'failure', details: failing });
  await storePr(db, t1, 'plain', { prNumber: 62, result: 'failure', details: failureDetails({ uncovered: [7102] }) });
  await storePr(db, t1, 'plain', { prNumber: 63, result: 'failure', details: failing, state: 'closed' });
  await storePr(db, t1, 'plain', { prNumber: 64, result: 'success', details: failureDetails({ uncovered: [] }) });
  await storePr(db, t1, 'plain', { prNumber: 65, result: 'in_progress', details: failureDetails({ uncovered: [] }) });
  await storePr(db, t1, 'scoped', { prNumber: 66, result: 'failure', details: failing });
  await storePr(db, t2, 'plain', { prNumber: 67, result: 'failure', details: failing });
  return { ...world, emma };
}

test('a claim that covers the person sends one evaluate-pr job, as a signature does, for each open pull request that fails for them or is being evaluated, in their tenant and no other', async () => {
  const world = await crowdedWorld();
  const repo = world.t1.plain.githubRepoId;
  expect(claimOf(await claimAs(world, world.emma, repo))).toEqual([201, 'covered']);
  const [approval] = await userApprovalsOf(world.db, EMMA);
  expect(await evaluationsSent(world.db)).toEqual([
    [`${repo}#61`, `corporate_claim:${approval?.id}:${repo}:61`],
    [`${repo}#65`, `corporate_claim:${approval?.id}:${repo}:65`],
  ]);
  const jobs = await sentJobs(world.db);
  expect(jobs.map(({ job }) => job)).toEqual(
    [61, 65].map((prNumber) => ({
      type: 'evaluate-pr',
      githubInstallationId: world.t1.githubInstallationId,
      githubRepoId: repo,
      prNumber,
      trigger: 'signature',
    })),
  );
});

test('a person who is already covered has their pull requests evaluated again too, under the key of their approval, and a repeated claim sends nothing twice', async () => {
  const world = await crowdedWorld();
  const own = await approvePerson(world, EMMA);
  const repo = world.t1.plain.githubRepoId;
  expect(claimOf(await claimAs(world, world.emma, repo))).toEqual([200, 'already_covered']);
  expect(await evaluationsSent(world.db)).toEqual([
    [`${repo}#61`, `corporate_claim:${own}:${repo}:61`],
    [`${repo}#65`, `corporate_claim:${own}:${repo}:65`],
  ]);
  expect(claimOf(await claimAs(world, world.emma, repo))).toEqual([200, 'already_covered']);
  expect(await jobCount(world.db)).toBe(2);
});

test('a claim nothing covers sends nothing, and a send that fails takes the claim back: no approval, no audit row', async () => {
  const world = await crowdedWorld();
  const stranger = await employee(world, 7105, [{ email: 'x@globex.example', primary: true }]);
  expect(failureOf(await claimAs(world, stranger, world.t1.plain.githubRepoId))).toEqual([409, 'no_matching_approval']);
  expect(await jobCount(world.db)).toBe(0);
  const broken = await crowdedBrokenQueue();
  const response = await claimAs(broken, broken.emma, broken.t1.plain.githubRepoId);
  expect(response.statusCode).toBe(500);
  expect(await userApprovalsOf(broken.db, EMMA)).toEqual([]);
  expect(await claimAuditOf(broken.db)).toEqual([]);
});

/** As {@link crowdedWorld}, with a queue that fails every send. */
async function crowdedBrokenQueue() {
  const world = await claimWorld({ enqueue: () => Promise.reject(new Error('the queue is down')) });
  await approveDomain(world, ACME_DOMAIN);
  const emma = await employee(world, EMMA);
  await storePr(world.db, world.t1, 'plain', {
    prNumber: 61,
    result: 'failure',
    details: failureDetails({ uncovered: [EMMA] }),
  });
  return { ...world, emma };
}

test('a manager who revokes the organisation approval while the claim waits for GitHub wins: 409, nothing written', async () => {
  const world = await claimWorld();
  const org = await approveOrg(world, 'acme-org');
  world.github.scriptPublicMember(ACME_ORG.login, loginOf(EMMA), true);
  const emma = await employee(world, EMMA, []);
  world.github.beforeNext('isPublicOrgMember', async () => {
    expect((await revokeAs(world, world.ada, { agreementId: world.adas.id, approvalId: org })).statusCode).toBe(200);
  });
  expect(failureOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([409, 'no_matching_approval']);
  expect(await userApprovalsOf(world.db, EMMA)).toEqual([]);
  expect((await claimAuditOf(world.db)).map((row) => row.action)).toEqual(['corporate_approval.revoked']);
});

test('an agreement whose signature is revoked while the claim waits for GitHub covers nobody: 409, nothing written', async () => {
  const world = await claimWorld();
  await approveOrg(world, 'acme-org');
  world.github.scriptPublicMember(ACME_ORG.login, loginOf(EMMA), true);
  const emma = await employee(world, EMMA, []);
  world.github.beforeNext('isPublicOrgMember', () => revokeSignature(world, world.adas.signatureId));
  expect(failureOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([409, 'no_matching_approval']);
  expect(await userApprovalsOf(world.db, EMMA)).toEqual([]);
});

test('a match that no longer holds under the lock is refused: the approval of the person is gone, or the approval a rule derives from', async () => {
  const world = await claimWorld();
  const emma = await employee(world, EMMA);
  const target = await resolveCorporateTarget(world.db, world.t1.plain.githubRepoId, 'write');
  const agreement = { id: world.adas.id, signatureId: world.adas.signatureId };
  const claimant = {
    userId: emma.userId,
    githubId: parseGithubId(EMMA),
    login: loginOf(EMMA),
    sessionRowId: emma.sessionId,
  };
  const deps = { db: world.db, enqueuer: fakeEnqueuer() };
  const gone = [
    { agreement, via: 'user', approvalId: 1 },
    { agreement, via: 'rule', parentId: 987_654 },
  ] as const;
  for (const match of gone) {
    await expect(writeClaim(deps, { target, match, claimant })).rejects.toMatchObject({ rule: 'no_matching_approval' });
  }
  expect(await userApprovalsOf(world.db, EMMA)).toEqual([]);
});
