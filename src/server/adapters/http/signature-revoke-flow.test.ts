// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { enableAs } from './repository-enable-fixture/test-support.ts';
import { COVERED, flowWorld, UNCOVERED } from './repository-flow-fixture/test-support.ts';
import { commentsOf, signAgain } from './signature-flow-fixture/test-support.ts';
import { revokeAs, revokedAnswerOf, signatureRow } from './signature-revoke-fixture/test-support.ts';

// Revoking a signature, from the click to the Check Runs and back (E15-S03), with GitHub stubbed by MSW behind the real Octokit adapter
// and the jobs run in-process in the order the queue would: the real engine, the real reporter. Tenant 1's signer (`member1`) opened
// the pull request COVERED and is covered by the signature `t1.signatureId`; the outsider opened UNCOVERED and signed nothing.

test('revoking the signature of the author turns the green check of the open pull request red, and the comment lists the signer as unsigned; signing again turns it green with a new row', async () => {
  const world = await flowWorld();
  const { t1, people } = world;
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await world.drain();
  expect([await world.conclusionOf(COVERED), await world.conclusionOf(UNCOVERED)]).toEqual(['success', 'failure']);
  expect(await commentsOf(world, COVERED)).toBe('');
  const asked = world.github.requests.length;

  const revoked = await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  expect([revoked.statusCode, revokedAnswerOf(revoked).reevaluating]).toEqual([200, 1]);
  expect(world.github.requests).toHaveLength(asked);
  await world.drain();
  expect([await world.conclusionOf(COVERED), await world.conclusionOf(UNCOVERED)]).toEqual(['failure', 'failure']);
  const comment = await commentsOf(world, COVERED);
  expect(comment).toContain('Not signed (1)');
  expect(comment).toContain(`user-${people.member1.githubId}`);

  const signed = await signAgain(world, COVERED);
  expect(signed.statusCode).toBe(201);
  await world.drain();
  expect([await world.conclusionOf(COVERED), await world.conclusionOf(UNCOVERED)]).toEqual(['success', 'failure']);
  const rows = await world.db
    .selectFrom('signatures')
    .select(['id', 'revoked_at', 'document_id', 'version_id'])
    .where('installation_id', '=', t1.installationId)
    .where('user_id', '=', people.member1.userId)
    .orderBy('id')
    .execute();
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ id: t1.signatureId, document_id: t1.documentId, version_id: t1.versionId });
  expect(rows[0]?.revoked_at).toBeInstanceOf(Date);
  expect(rows[1]).toMatchObject({ revoked_at: null, document_id: t1.documentId, version_id: t1.versionId });
  expect((await signatureRow(world, t1.signatureId)).revoke_reason).toBe('maintainer_decision');
});

test('a pull request that is closed is not evaluated again by the revocation: no job, no Check Run write, and its green check stays', async () => {
  const world = await flowWorld();
  const { t1 } = world;
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await world.drain();
  await world.db.updateTable('pr_evaluations').set({ pr_state: 'closed' }).where('pr_number', '=', COVERED).execute();
  const jobs = (await sentJobs(world.db)).length;
  const writes = world.github.checkRunWrites.length;
  const asked = world.github.requests.length;
  const revoked = await revokeAs(world, 'admin1', t1.installationId, t1.signatureId);
  expect([revoked.statusCode, revokedAnswerOf(revoked).reevaluating]).toEqual([200, 0]);
  await world.drain();
  expect(await sentJobs(world.db)).toHaveLength(jobs);
  expect(world.github.checkRunWrites).toHaveLength(writes);
  expect(world.github.requests).toHaveLength(asked);
  expect(await world.conclusionOf(COVERED)).toBe('success');
});
