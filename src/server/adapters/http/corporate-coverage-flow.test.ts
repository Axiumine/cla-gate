// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  approve,
  personWithId,
  publishCorporateDocument,
  signAgreement,
} from '../db/corporate-fixture/test-support.ts';
import { revokeAs as revokeApprovalAs, revokedOf } from './corporate-approval-fixture/test-support.ts';
import { signerWith } from './corporate-fixture/test-support.ts';
import { enableAs } from './repository-enable-fixture/test-support.ts';
import { COVERED, flowWorld, UNCOVERED } from './repository-flow-fixture/test-support.ts';
import { commentsOf } from './signature-flow-fixture/test-support.ts';
import { revokeAs, revokedAnswerOf } from './signature-revoke-fixture/test-support.ts';

// A corporate CLA from the approval to the Check Runs and back (E21-S05), with GitHub stubbed by MSW behind the real Octokit adapter and the
// jobs run in-process in the order the queue would: the real engine, the real reporter. Tenant 1's repository also has a corporate CLA, signed by
// its org admin for a company, who approved the outsider (the author of the pull request UNCOVERED, who signed no individual CLA). The signer
// `member1` of the pull request COVERED is covered by their own signature and is never touched by what happens to the agreement.

/** The flow world with the corporate CLA in place and the repository enforced: the agreement, the approval of the outsider, the jobs run. */
async function corporateFlow() {
  const world = await flowWorld();
  const { db, t1, people } = world;
  const document = await publishCorporateDocument(db, t1);
  await db
    .updateTable('repositories')
    .set({ corporate_document_id: document.documentId })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const signed = await signAgreement(db, { tenant: t1, document }, await personWithId(db, people.admin1.githubId));
  const approvalId = await approve(db, signed, {
    kind: 'user',
    githubId: people.outsider.githubId,
    login: `user-${people.outsider.githubId}`,
  });
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await world.drain();
  return { world, signed, approvalId };
}

/** The summary the last write to the Check Run of the pull request `prNumber` carried. */
async function summaryOf(world: Awaited<ReturnType<typeof flowWorld>>, prNumber: number): Promise<string> {
  const [run] = await world.github.client.listCheckRunsForRef(
    world.t1.githubInstallationId,
    'org-1/repo',
    String(world.heads.get(prNumber)),
  );
  return world.github.checkRunWrites.findLast((record) => record.id === run?.id)?.write.summary ?? '';
}

test('the author an approval of the corporate CLA covers passes with no individual signature, and the Check Run says they are covered by a corporate CLA', async () => {
  const { world } = await corporateFlow();
  expect([await world.conclusionOf(COVERED), await world.conclusionOf(UNCOVERED)]).toEqual(['success', 'success']);
  const summary = await summaryOf(world, UNCOVERED);
  expect(summary).toContain('1 contributor covered: 1 by corporate CLA.');
  expect(summary).toContain('1 contributor is covered by a corporate CLA.');
  expect(summary).not.toContain('Acme Corp');
  expect(await summaryOf(world, COVERED)).not.toContain('corporate');
});

test('revoking the signature of the agreement turns the green check of the covered pull request red, and the one covered by a signature stays green', async () => {
  const { world, signed } = await corporateFlow();
  const revoked = await revokeAs(world, 'admin1', world.t1.installationId, signed.signatureId);
  expect([revoked.statusCode, revokedAnswerOf(revoked).reevaluating]).toEqual([200, 1]);
  await world.drain();
  expect([await world.conclusionOf(COVERED), await world.conclusionOf(UNCOVERED)]).toEqual(['success', 'failure']);
  const comment = await commentsOf(world, UNCOVERED);
  expect(comment).toContain('Not signed (1)');
  expect(comment).toContain(`user-${world.people.outsider.githubId}`);
  expect(comment).not.toContain('corporate CLA covered');
});

test('revoking the approval of the person turns the green check red, and the next evaluation fails for the pull request that was success', async () => {
  const { world, signed, approvalId } = await corporateFlow();
  const manager = await signerWith(world, world.people.admin1.githubId);
  revokedOf(await revokeApprovalAs(world, manager, { agreementId: signed.agreementId, approvalId }));
  await world.drain();
  expect([await world.conclusionOf(COVERED), await world.conclusionOf(UNCOVERED)]).toEqual(['success', 'failure']);
  expect(await commentsOf(world, UNCOVERED)).toContain('Not signed (1)');
});
