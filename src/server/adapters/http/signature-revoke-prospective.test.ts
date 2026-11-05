// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { failureDetails } from '../../domain/failure-details-fixture/test-support.ts';
import { sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { coveredBy, sentAs, storePr } from '../../services/revocation-fixture/test-support.ts';
import { tablesOf } from './document-fixture/test-support.ts';
import {
  enforceDocuments,
  revokeAs,
  revokedAnswerOf,
  revokeWorld,
  signatureCore,
} from './signature-revoke-fixture/test-support.ts';

// Revocation is prospective only (E15-S03): it stops the signature from covering the evaluations made from now on and asks for the
// open pull requests that relied on it to be evaluated again. Pull requests that are closed are left alone, no row of an evaluation
// is written by the revocation, and what the signature says about the signing never changes.

/** Tenant 1 with a signer (`member1`, signature `t1.signatureId`), every repository enforcing the document, and pull requests of every kind. */
async function crowdedWorld() {
  const world = await revokeWorld();
  await enforceDocuments(world);
  const { db, t1, people } = world;
  const signer = people.member1.githubId;
  const relied = coveredBy({ githubId: signer, signatureId: t1.signatureId });
  const reliedAsSigner = coveredBy({ githubId: signer, signatureId: 9999 });
  const others = coveredBy({ githubId: people.outsider.githubId, signatureId: 9998 });
  await storePr(db, t1, 'plain', { prNumber: 61, details: relied });
  await storePr(db, t1, 'plain', { prNumber: 62, details: reliedAsSigner });
  await storePr(db, t1, 'plain', { prNumber: 63, details: others });
  await storePr(db, t1, 'plain', { prNumber: 64, result: 'failure', details: failureDetails({ uncovered: [signer] }) });
  await storePr(db, t1, 'plain', { prNumber: 65, details: relied, state: 'closed' });
  await storePr(db, t1, 'scoped', { prNumber: 66, details: relied });
  // Pull request 67: an old head SHA relied on the signature, the newest evaluation does not. Pull request 68: the other way round.
  await storePr(db, t1, 'plain', { prNumber: 67, head: '1', day: 1, details: relied });
  await storePr(db, t1, 'plain', { prNumber: 67, head: '2', day: 2, details: others });
  await storePr(db, t1, 'plain', {
    prNumber: 68,
    head: '1',
    day: 1,
    result: 'failure',
    details: failureDetails({ uncovered: [signer] }),
  });
  await storePr(db, t1, 'plain', { prNumber: 68, head: '2', day: 2, details: relied });
  return world;
}

test('the open pull requests whose latest result relied on the signature, or on its signer as covered by a signature, are evaluated again, one job each, and no others', async () => {
  const world = await crowdedWorld();
  const { t1 } = world;
  const response = await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  expect(revokedAnswerOf(response).reevaluating).toBe(4);
  const plain = t1.plain.githubRepoId;
  expect(await sentAs(world.db)).toEqual([`${plain}#61`, `${plain}#62`, `${plain}#68`, `${t1.scoped.githubRepoId}#66`]);
  const triggers = (await sentJobs(world.db)).map(({ job }) => (job.type === 'evaluate-pr' ? job.trigger : job.type));
  expect(triggers).toEqual(['signature', 'signature', 'signature', 'signature']);
});

test('the revocation is prospective: the rows of the evaluations are untouched, the closed pull request keeps its row and its Check Run, and the signature core is byte for byte the same', async () => {
  const world = await crowdedWorld();
  const { db, t1 } = world;
  await db.updateTable('pr_evaluations').set({ check_run_id: 123_456 }).where('pr_number', '=', 65).execute();
  const evaluations = () => db.selectFrom('pr_evaluations').selectAll().orderBy('id').execute();
  const signatures = () =>
    sql<{
      id: number;
      core: string;
    }>`select id, (to_jsonb(s) - 'revoked_at' - 'revoked_by' - 'revoke_reason')::text as core from signatures s order by id`.execute(
      db,
    );
  const untouched = async () => {
    const all = await tablesOf(world);
    return Object.fromEntries(Object.entries(all).filter(([table]) => table !== 'signatures' && table !== 'audit_log'));
  };
  const [evaluationsBefore, signaturesBefore, coreBefore, restBefore] = [
    await evaluations(),
    (await signatures()).rows,
    await signatureCore(world, t1.signatureId),
    await untouched(),
  ];
  const closed = evaluationsBefore.filter((row) => row.pr_number === 65);
  expect(closed.map((row) => [row.pr_state, row.check_run_id])).toEqual([['closed', 123_456]]);
  const response = await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  expect(response.statusCode).toBe(200);
  expect(await evaluations()).toEqual(evaluationsBefore);
  expect((await signatures()).rows).toEqual(signaturesBefore);
  expect(await signatureCore(world, t1.signatureId)).toBe(coreBefore);
  expect(await untouched()).toEqual(restBefore);
  expect(await sentAs(db)).not.toContain(`${t1.plain.githubRepoId}#65`);
});

test('above 100 pull requests that relied on the signature one sweep-repository job is sent for each repository that has one, with the reason signature_revoked, and the answer counts the sweeps', async () => {
  const world = await crowdedWorld();
  const { db, t1, people } = world;
  const relied = coveredBy({ githubId: people.member1.githubId, signatureId: t1.signatureId });
  for (let prNumber = 200; prNumber < 300; prNumber += 1) {
    await storePr(db, t1, 'plain', { prNumber, details: relied });
  }
  const response = await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  expect(revokedAnswerOf(response).reevaluating).toBe(2);
  expect((await sentJobs(db)).map(({ job }) => job)).toEqual([
    {
      type: 'sweep-repository',
      githubInstallationId: t1.githubInstallationId,
      githubRepoId: t1.plain.githubRepoId,
      reason: 'signature_revoked',
    },
    {
      type: 'sweep-repository',
      githubInstallationId: t1.githubInstallationId,
      githubRepoId: t1.scoped.githubRepoId,
      reason: 'signature_revoked',
    },
  ]);
});

test('a repository that does not enforce the document of the signature is not evaluated again, though its pull requests are covered by the same person', async () => {
  const world = await crowdedWorld();
  const { db, t1 } = world;
  await db.updateTable('repositories').set({ enabled: false }).where('id', '=', t1.scoped.repositoryId).execute();
  await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  const plain = t1.plain.githubRepoId;
  expect(await sentAs(db)).toEqual([`${plain}#61`, `${plain}#62`, `${plain}#68`]);
});
