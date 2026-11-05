// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { enableAs } from './repository-enable-fixture/test-support.ts';
import { COVERED, flowWorld, UNCOVERED } from './repository-flow-fixture/test-support.ts';
import { commentsOf, signAgain } from './signature-flow-fixture/test-support.ts';
import { invalidateAs, invalidatedAnswerOf } from './signature-invalidate-fixture/test-support.ts';

// Invalidating a major, from the click to the Check Runs and back (E15-S04), with GitHub stubbed by MSW behind the real Octokit adapter
// and the jobs run in-process in the order the queue would: the real engine, the real reporter. Tenant 1's signer (`member1`) opened
// the pull request COVERED and is covered by the signature `t1.signatureId`; the outsider opened UNCOVERED and signed nothing.

test('invalidating major 1 turns the green check of the open pull request red once the sweep ran, the comment lists the signer as unsigned, and signing again turns it green with a new row', async () => {
  const world = await flowWorld();
  const { t1, people } = world;
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await world.drain();
  expect([await world.conclusionOf(COVERED), await world.conclusionOf(UNCOVERED)]).toEqual(['success', 'failure']);
  const asked = world.github.requests.length;
  const sent = (await sentJobs(world.db)).length;

  const target = { installationId: t1.installationId, documentId: t1.documentId };
  const invalidated = await invalidateAs(world, 'admin1', target, 1);
  expect([invalidated.statusCode, invalidatedAnswerOf(invalidated)]).toEqual([200, { invalidated: 1 }]);
  expect(world.github.requests).toHaveLength(asked);
  const jobs = (await sentJobs(world.db)).slice(sent).map(({ job }) => job);
  expect(jobs).toEqual([
    {
      type: 'sweep-repository',
      githubInstallationId: t1.githubInstallationId,
      githubRepoId: t1.plain.githubRepoId,
      reason: 'signatures_invalidated',
    },
  ]);
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
    .select(['id', 'revoked_at', 'revoke_reason', 'version_id'])
    .where('installation_id', '=', t1.installationId)
    .where('user_id', '=', people.member1.userId)
    .orderBy('id')
    .execute();
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ id: t1.signatureId, revoke_reason: 'maintainer_decision', version_id: t1.versionId });
  expect(rows[0]?.revoked_at).toBeInstanceOf(Date);
  expect(rows[1]).toMatchObject({ revoked_at: null, revoke_reason: null, version_id: t1.versionId });
});
