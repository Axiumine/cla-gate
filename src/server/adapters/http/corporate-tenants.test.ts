// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  CORPORATE_AGREEMENTS_PATH,
  corporateAgreementPageSchema,
  tenantAgreementPageSchema,
} from '../../../shared/corporate.ts';
import { tenantChecksums } from '../db/tenant-fixture/test-support.ts';
import {
  agreementUrl,
  choiceUrl,
  corporateChecksums,
  corporateWorld,
  failureOf,
  getAs,
  signAs,
  signerWith,
  tenantListUrl,
  withoutRequestId,
} from './corporate-fixture/test-support.ts';
import { MAINTAINER_DECISION, revokePath } from './signature-revoke-fixture/test-support.ts';

// Cross-tenant checks of corporate signing (E21-S02): a manager of tenant 1 sees nothing of tenant 2, and the org admin of tenant 1
// gets the 404 of an id that names nothing for every agreement, signature, repository, document and installation of tenant 2.
// Ada signs under tenant 1, Bob (GitHub id 4321) under tenant 2.

async function twoCompanies() {
  const world = await corporateWorld();
  const bob = await signerWith(world, 4321);
  const adas = await signAs(world, world.ada, world.c1);
  const bobs = await signAs(world, bob, world.c2, {
    typedName: 'Bob Example',
    companyName: 'Bob zzzz Ltd',
    signatoryTitle: 'CTO',
  });
  return { world, bob, adas, bobs };
}

/** Everything the two tenants hold, in the tables every tenant route reads and in those of the corporate CLA. */
async function everything(world: Awaited<ReturnType<typeof corporateWorld>>) {
  const tenant = await tenantChecksums(world.db);
  const tables = Object.fromEntries(Object.entries(tenant).filter(([name]) => name !== 'installation_admin_seen'));
  return { tables, corporate: await corporateChecksums(world.db) };
}

test('a manager in one tenant sees nothing of the other: the list holds their agreement only', async () => {
  const { world, bob, adas, bobs } = await twoCompanies();
  const mine = corporateAgreementPageSchema.parse((await getAs(world, world.ada, CORPORATE_AGREEMENTS_PATH)).json());
  expect(mine.items.map((item) => item.id)).toEqual([adas.id]);
  const his = corporateAgreementPageSchema.parse((await getAs(world, bob, CORPORATE_AGREEMENTS_PATH)).json());
  expect(his.items.map((item) => item.id)).toEqual([bobs.id]);
  expect(JSON.stringify(mine)).not.toContain('zzzz');
});

test('a manager asking for an agreement of the other tenant gets the 404 of an id that names nothing, byte for byte', async () => {
  const { world, bob, adas, bobs } = await twoCompanies();
  const unknown = await getAs(world, world.ada, agreementUrl(987_654));
  const crossed = [
    await getAs(world, world.ada, agreementUrl(bobs.id)),
    await getAs(world, bob, agreementUrl(adas.id)),
  ];
  expect(crossed.map(withoutRequestId)).toEqual(crossed.map(() => withoutRequestId(unknown)));
  expect(failureOf(unknown)).toEqual([404, 'not_found']);
});

test('the org admin of one tenant gets the 404 of an id that names nothing for every agreement of the other, and no row changes', async () => {
  const { world, bobs } = await twoCompanies();
  const before = await everything(world);
  const unknownAgreement = await world.ask('admin1', { method: 'GET', url: agreementUrl(987_654) });
  const crossedAgreement = await world.ask('admin1', { method: 'GET', url: agreementUrl(bobs.id) });
  expect(failureOf(crossedAgreement)).toEqual([404, 'not_found']);
  expect(withoutRequestId(crossedAgreement)).toBe(withoutRequestId(unknownAgreement));
  const unknownRevoke = await world.ask('admin1', {
    method: 'POST',
    url: revokePath(world.t1.installationId, 987_654),
    payload: MAINTAINER_DECISION,
  });
  const crossedRevoke = await world.ask('admin1', {
    method: 'POST',
    url: revokePath(world.t1.installationId, bobs.signatureId),
    payload: MAINTAINER_DECISION,
  });
  expect(failureOf(crossedRevoke)).toEqual([404, 'not_found']);
  expect(withoutRequestId(crossedRevoke)).toBe(withoutRequestId(unknownRevoke));
  expect(await everything(world)).toEqual(before);
});

test('the list of the tenant of the org admin holds none of the other tenant, and the other tenant’s path is the 404 of an unknown installation', async () => {
  const { world, adas, bobs } = await twoCompanies();
  const mine = await world.ask('admin1', { method: 'GET', url: tenantListUrl(world.t1.installationId) });
  expect(mine.statusCode).toBe(200);
  expect(tenantAgreementPageSchema.parse(mine.json()).items.map((item) => item.id)).toEqual([adas.id]);
  expect(mine.body).not.toContain('zzzz');
  const unknown = await world.ask('admin1', { method: 'GET', url: tenantListUrl(987_654) });
  const crossed = await world.ask('admin1', { method: 'GET', url: tenantListUrl(world.t2.installationId) });
  expect(failureOf(crossed)).toEqual([404, 'not_found']);
  expect(withoutRequestId(crossed)).toBe(withoutRequestId(unknown));
  expect(bobs.id).not.toBe(adas.id);
});

test('the org admin of one tenant cannot choose a repository or a document of the other, and nothing of it changes', async () => {
  const { world } = await twoCompanies();
  const before = await everything(world);
  const crossedRepository = await world.ask('admin1', {
    method: 'PUT',
    url: choiceUrl(world.t1.installationId, world.t2.plain.repositoryId),
    payload: { documentId: null },
  });
  const crossedInstallation = await world.ask('admin1', {
    method: 'PUT',
    url: choiceUrl(world.t2.installationId, world.t2.plain.repositoryId),
    payload: { documentId: null },
  });
  const crossedDocument = await world.ask('admin1', {
    method: 'PUT',
    url: choiceUrl(world.t1.installationId, world.t1.plain.repositoryId),
    payload: { documentId: world.c2.document.documentId },
  });
  expect([crossedRepository, crossedInstallation].map((response) => response.statusCode)).toEqual([404, 404]);
  expect(withoutRequestId(crossedRepository)).toBe(withoutRequestId(crossedInstallation));
  expect(failureOf(crossedDocument)).toEqual([422, 'document_not_corporate']);
  expect(await everything(world)).toEqual(before);
});

test('signing under one tenant writes no row of the other: the rows of the other tenant are as they were', async () => {
  const { world, bob } = await twoCompanies();
  const rowsOfTenantTwo = async () => ({
    agreements: await world.db
      .selectFrom('corporate_agreements')
      .selectAll()
      .where('installation_id', '=', world.t2.installationId)
      .execute(),
    approvals: await world.db
      .selectFrom('corporate_approvals')
      .selectAll()
      .where('installation_id', '=', world.t2.installationId)
      .execute(),
    signatures: await world.db
      .selectFrom('signatures')
      .selectAll()
      .where('installation_id', '=', world.t2.installationId)
      .execute(),
    audit: await world.db
      .selectFrom('audit_log')
      .selectAll()
      .where('installation_id', '=', world.t2.installationId)
      .execute(),
  });
  const before = await rowsOfTenantTwo();
  const carol = await signerWith(world, 4400);
  await signAs(world, carol, world.c1, { typedName: 'Carol Example' });
  expect(await rowsOfTenantTwo()).toEqual(before);
  const bobList = corporateAgreementPageSchema.parse((await getAs(world, bob, CORPORATE_AGREEMENTS_PATH)).json());
  expect(bobList.items).toHaveLength(1);
});
