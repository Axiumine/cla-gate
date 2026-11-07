// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { approve, corporateTenant, derive, signAgreement } from '../../adapters/db/corporate-fixture/test-support.ts';
import { asRuntimeRole, seedTenant } from '../../adapters/db/test-support.ts';
import { createLogger } from '../../adapters/http/logger.ts';
import { createOrgMembership } from '../org-membership.ts';
import { createOrgMembershipCache } from '../org-membership-cache.ts';
import { corporateWorld, storeExpiredApproval } from './corporate-fixture/test-support.ts';
import { evaluatePr } from './evaluate-pr.ts';
import { engineInput, JOB } from './test-support.ts';

// E21-S05: a corporate approval covers an author in the evaluation of a pull request. The pull request is opened by user 7 and written by 1
// and 2; the agreement of the tenant was signed by user 7, so the opener has the signatory's own approval. Nobody signed the individual CLA.

const READ_OF_APPROVALS = 'db:select corporate_approvals';

/** How many statements the job sent over the approvals of corporate agreements. */
const approvalReads = (timeline: readonly string[]): number =>
  timeline.filter((step) => step === READ_OF_APPROVALS).length;

test('people covered by approvals pass, the stored details name the agreement and the approval of each, and the approvals are read in one statement', async () => {
  const { world, corporate, approvePerson } = await corporateWorld();
  const one = await approvePerson(1);
  const two = await approvePerson(2);
  await world.run();
  const [row] = await world.rows();
  expect(row?.result).toBe('success');
  expect(row?.details).toMatchObject({
    outcome: 'success',
    actors: [
      {
        githubId: 1,
        covered: true,
        basis: { kind: 'corporate_approval', agreementId: corporate.signed.agreementId, approvalId: one },
      },
      {
        githubId: 2,
        covered: true,
        basis: { kind: 'corporate_approval', agreementId: corporate.signed.agreementId, approvalId: two },
      },
      {
        githubId: 7,
        covered: true,
        basis: {
          kind: 'corporate_approval',
          agreementId: corporate.signed.agreementId,
          approvalId: corporate.ownApproval,
        },
      },
    ],
  });
  expect(approvalReads(world.timeline)).toBe(1);
  expect([...engineInput(world).corporateCovered.keys()].sort((a, b) => a - b)).toEqual([1, 2, 7]);
});

test('the opener covered by an approval is not enough: an author nobody covers fails the pull request', async () => {
  const { world, approvePerson } = await corporateWorld();
  await approvePerson(1);
  await world.run();
  const [row] = await world.rows();
  expect(row?.result).toBe('failure');
  expect(row?.details).toMatchObject({
    failureCodes: ['unsigned_contributor'],
    actors: [
      { githubId: 1, covered: true },
      { githubId: 2, covered: false, basis: null },
      { githubId: 7, covered: true },
    ],
  });
});

test('a repository without a corporate document, or without an active CLA, reads no approval at all', async () => {
  const plain = await corporateWorld({ enforce: false });
  await plain.world.run();
  expect(approvalReads(plain.world.timeline)).toBe(0);
  expect(engineInput(plain.world).corporateCovered.size).toBe(0);
  const noCla = await corporateWorld({ cla: false });
  await noCla.world.run();
  expect(approvalReads(noCla.world.timeline)).toBe(0);
  expect((await noCla.world.rows()).map((row) => row.details)).toMatchObject([{ failureCodes: ['no_active_cla'] }]);
});

test.each([
  ['an approval that was revoked', 'revoke approval'],
  ['an agreement whose signature was revoked', 'revoke agreement'],
] as const)('%s covers nobody on the next evaluation of a pull request that was a success', async (_name, change) => {
  const { world, approvePerson, revokeApproval, revokeAgreement } = await corporateWorld();
  const approvals = [await approvePerson(1), await approvePerson(2)];
  await world.run();
  expect((await world.rows()).map((row) => row.result)).toEqual(['success']);
  await (change === 'revoke approval' ? revokeApproval(approvals[0] ?? 0) : revokeAgreement());
  await world.run();
  const [row] = await world.rows();
  expect(row?.result).toBe('failure');
  expect(row?.details).toMatchObject({ failureCodes: ['unsigned_contributor'] });
  expect(engineInput(world).corporateCovered.has(1)).toBe(false);
  expect(engineInput(world).corporateCovered.has(2)).toBe(change === 'revoke approval');
});

test('an approval that expired covers nobody, and one that is still in force does', async () => {
  const { world, corporate, approvePerson } = await corporateWorld();
  await approvePerson(1);
  await storeExpiredApproval(world.raw, corporate, 2);
  await world.run();
  expect([...engineInput(world).corporateCovered.keys()].sort((a, b) => a - b)).toEqual([1, 7]);
  const [row] = await world.rows();
  expect(row?.result).toBe('failure');
});

test('an approval derived from the domain by a rule covers while it lasts', async () => {
  const { world, corporate, approvePerson } = await corporateWorld();
  await approvePerson(1);
  const derived = await derive(world.raw, corporate.signed, corporate.domainApproval, {
    githubId: 2,
    login: 'derived-2',
  });
  await world.run();
  expect(engineInput(world).corporateCovered.get(2)).toEqual({
    agreementId: corporate.signed.agreementId,
    approvalId: derived,
  });
  expect((await world.rows()).map((row) => row.result)).toEqual(['success']);
});

test('an agreement of an earlier major covers nobody, and the people who hold an approval under it are handed over as outdated', async () => {
  const { world, approvePerson, publishNextMajor } = await corporateWorld();
  await approvePerson(1);
  await approvePerson(2);
  await publishNextMajor();
  await world.run();
  const input = engineInput(world);
  expect(input.corporateCovered.size).toBe(0);
  expect([...input.corporateOutdated].sort((a, b) => a - b)).toEqual([1, 2, 7]);
  expect((await world.rows()).map((row) => row.result)).toEqual(['failure']);
});

test('the agreement signed again under the major now in force covers its people, and the others stay outdated', async () => {
  const { world, corporate, approvePerson, publishNextMajor } = await corporateWorld();
  await approvePerson(1);
  await approvePerson(2);
  const next = await publishNextMajor();
  const signed = await signAgreement(world.raw, { tenant: corporate.tenant, document: next }, corporate.signed.person);
  const renewed = await approve(world.raw, signed, { kind: 'user', githubId: 1, login: 'login-1' });
  await world.run();
  expect(engineInput(world).corporateCovered).toEqual(
    new Map([[1, { agreementId: signed.agreementId, approvalId: renewed }]]),
  );
  expect([...engineInput(world).corporateOutdated].sort((a, b) => a - b)).toEqual([2, 7]);
});

test('an agreement for another corporate document of the tenant covers nobody under this repository', async () => {
  const { world, corporate } = await corporateWorld({ enforce: false });
  await world.raw
    .updateTable('repositories')
    .set({ corporate_document_id: null })
    .where('installation_id', '=', world.tenant.installationId)
    .execute();
  await world.raw
    .insertInto('cla_documents')
    .values({
      installation_id: world.tenant.installationId,
      repository_id: null,
      name: 'Another corporate CLA',
      kind: 'corporate',
      active_version_id: null,
    })
    .execute();
  const other = await world.raw
    .selectFrom('cla_documents')
    .select('id')
    .where('name', '=', 'Another corporate CLA')
    .executeTakeFirstOrThrow();
  await world.raw
    .updateTable('repositories')
    .set({ corporate_document_id: other.id })
    .where('installation_id', '=', world.tenant.installationId)
    .execute();
  await world.run();
  expect(engineInput(world).corporateCovered.size).toBe(0);
  expect(corporate.document.documentId).not.toBe(other.id);
});

test('the approvals, agreements and signatures of another installation never reach the engine, whatever the numeric ids', async () => {
  const { world } = await corporateWorld();
  const other = await seedTenant(world.raw, 2);
  const neighbour = await corporateTenant(world.raw, other, 1);
  await approve(world.raw, neighbour.signed, { kind: 'user', githubId: 2, login: 'neighbour-2' });
  await world.raw
    .updateTable('repositories')
    .set({ corporate_document_id: neighbour.document.documentId })
    .where('installation_id', '=', other.installationId)
    .execute();
  await world.run();
  expect([...engineInput(world).corporateCovered.keys()]).toEqual([7]);
  expect([...engineInput(world).corporateOutdated]).toEqual([]);
  expect((await world.rows()).map((row) => row.result)).toEqual(['failure']);
});

test('the job runs as the runtime role and reads the approvals it needs', async () => {
  const { world, approvePerson } = await corporateWorld({ runtime: true });
  await approvePerson(1);
  await approvePerson(2);
  const logger = createLogger({ logLevel: 'info' }, world.logs.destination);
  const outcome = await asRuntimeRole(world.raw, (trx) =>
    evaluatePr(
      {
        ...world.ports,
        db: trx,
        orgMembership: createOrgMembership({
          db: trx,
          github: world.fake,
          logger,
          cache: createOrgMembershipCache(world.ports.clock),
        }),
      },
      JOB,
      { attempt: 0, logger, enqueuer: world.handedOver, jobId: 'job-1' },
    ),
  );
  expect(outcome).toEqual({ outcome: 'evaluated' });
  expect((await world.rows()).map((row) => row.result)).toEqual(['success']);
});
