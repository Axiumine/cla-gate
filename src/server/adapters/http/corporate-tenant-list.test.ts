// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import {
  CORPORATE_AGREEMENTS_PATH,
  corporateAgreementDetailSchema,
  corporateAgreementPageSchema,
  tenantAgreementPageSchema,
} from '../../../shared/corporate.ts';
import { signatureRevokeResponseSchema } from '../../../shared/signature-revoke.ts';
import { fakeEnqueuer } from '../../services/jobs-fixture/test-support.ts';
import { approve, DOMAIN, derive, insertApprovalRow } from '../db/corporate-fixture/test-support.ts';
import {
  ADA_ID,
  agreementUrl,
  bodyFor,
  type CorporateWorld,
  corporateWorld,
  failureOf,
  getAs,
  postAgreement,
  signAs,
  signedOf,
  signerWith,
  tenantListUrl,
} from './corporate-fixture/test-support.ts';
import { suspendTenantOne } from './repository-document-fixture/test-support.ts';
import { MAINTAINER_DECISION, revokePath } from './signature-revoke-fixture/test-support.ts';

// `GET /api/installations/:installationId/corporate-agreements` (E21-S02): the agreements of one tenant for its org admins, and the
// revocation of one through the signature revocation of E15-S03. Ada and Eve sign under tenant 1, Ada also under tenant 2.

const A_DAY = 86_400_000;

async function twoTenantWorld() {
  const world = await corporateWorld({}, { enqueuer: fakeEnqueuer() });
  const eve = await signerWith(world, 4321);
  const adaOne = await signAs(world, world.ada, world.c1);
  const eveOne = await signAs(world, eve, world.c1, {
    typedName: 'Eve Example',
    companyName: 'Eve Ltd',
    signatoryTitle: 'Founder',
  });
  const adaTwo = await signAs(world, world.ada, world.c2, { companyName: 'Acme Inc' });
  return { world, eve, adaOne, eveOne, adaTwo };
}

const asTenantPage = (response: { statusCode: number; json: () => unknown }) => {
  expect(response.statusCode).toBe(200);
  return tenantAgreementPageSchema.parse(response.json());
};

const listAs = (world: CorporateWorld, who: Parameters<CorporateWorld['ask']>[0], installationId: number, query = '') =>
  world.ask(who, { method: 'GET', url: tenantListUrl(installationId, query) });

test('an org admin sees every agreement of their tenant, newest first, and none of the other tenant', async () => {
  const { world, adaOne, eveOne } = await twoTenantWorld();
  const response = await listAs(world, 'admin1', world.t1.installationId);
  const page = asTenantPage(response);
  expect(page.items.map((item) => item.id)).toEqual([eveOne.id, adaOne.id]);
  expect(page.nextCursor).toBeNull();
  expect(response.headers['cache-control']).toBe('no-store');
  expect(page.items[1]).toEqual({
    id: adaOne.id,
    signatureId: adaOne.signatureId,
    signedAt: adaOne.signedAt,
    major: 1,
    companyName: 'Acme GmbH',
    signatory: { githubId: ADA_ID, login: `login-${ADA_ID}` },
    activeApprovalCount: 1,
    revoked: false,
  });
});

test('the list holds no title, no typed name and no address, and the org admin of the other tenant sees their own', async () => {
  const { world, adaTwo } = await twoTenantWorld();
  const mine = await listAs(world, 'admin2', world.t2.installationId);
  expect(asTenantPage(mine).items.map((item) => item.id)).toEqual([adaTwo.id]);
  const one = await listAs(world, 'admin1', world.t1.installationId);
  for (const secret of ['Chief Legal Officer', 'Founder', 'Ada Lovelace', 'Eve Example', 'ada@example.org']) {
    expect(one.body).not.toContain(secret);
  }
});

test('a page of one follows the cursor to the end with no agreement twice and none missed', async () => {
  const { world, adaOne, eveOne } = await twoTenantWorld();
  const seen: number[] = [];
  let query = '?limit=1';
  for (let guard = 0; guard < 4; guard++) {
    const page = asTenantPage(await listAs(world, 'admin1', world.t1.installationId, query));
    seen.push(...page.items.map((item) => item.id));
    if (page.nextCursor === null) {
      break;
    }
    query = `?limit=1&cursor=${page.nextCursor}`;
  }
  expect(seen).toEqual([eveOne.id, adaOne.id]);
});

test.each([
  ['a cursor that is not base64url', '?cursor=!!!'],
  ['a cursor of the wrong shape', `?cursor=${Buffer.from('{"id":1}', 'utf8').toString('base64url')}`],
  ['a limit of zero', '?limit=0'],
  ['a limit over 100', '?limit=101'],
  ['a key the list does not know', '?installationId=2'],
])('%s is a 400 bad_request', async (_label, query) => {
  const world = await corporateWorld();
  expect(failureOf(await listAs(world, 'admin1', world.t1.installationId, query))).toEqual([400, 'bad_request']);
});

test.each([
  ['the admin of one repository', 'repoAdmin1', 403, 'forbidden'],
  ['a plain member', 'member1', 404, 'not_found'],
  ['a person GitHub knows nothing about', 'outsider', 404, 'not_found'],
  ['the org admin of another tenant', 'admin2', 404, 'not_found'],
  ['nobody', null, 401, 'unauthorized'],
] as const)('%s cannot list the agreements of the tenant', async (_label, who, status, code) => {
  const { world } = await twoTenantWorld();
  expect(failureOf(await listAs(world, who, world.t1.installationId))).toEqual([status, code]);
});

test('a suspended tenant is listed as usual: reads keep working', async () => {
  const { world, adaOne } = await twoTenantWorld();
  await suspendTenantOne(world);
  const items = asTenantPage(await listAs(world, 'admin1', world.t1.installationId)).items;
  expect(items.map((item) => item.id)).toContain(adaOne.id);
});

test('the count is of the approvals in force: a revoked one and an expired one are not counted', async () => {
  const { world, adaOne } = await twoTenantWorld();
  const signed = signedOf(world.c1, world.ada, adaOne);
  const domain = await approve(world.db, signed, { kind: 'email_domain', domain: DOMAIN });
  await approve(world.db, signed, { kind: 'user', githubId: 7001, login: 'employee-login' });
  const revoked = await approve(world.db, signed, { kind: 'user', githubId: 7002, login: 'gone-login' });
  await derive(world.db, signed, domain, { githubId: 7003, login: 'derived-login' });
  await insertApprovalRow(world.db, {
    installation_id: world.t1.installationId,
    agreement_id: adaOne.id,
    kind: 'user',
    subject_github_id: 7004,
    subject_domain: null,
    source: 'rule',
    derived_from_approval_id: domain,
    approved_at: new Date(Date.now() - 3 * A_DAY),
    expires_at: new Date(Date.now() - A_DAY),
  });
  await world.db
    .updateTable('corporate_approvals')
    .set({ revoked_at: new Date(Date.now() + 1000), revoked_by: world.ada.userId })
    .where('id', '=', revoked)
    .execute();
  const own = corporateAgreementDetailSchema.parse((await getAs(world, world.ada, agreementUrl(adaOne.id))).json());
  const listed = asTenantPage(await listAs(world, 'admin1', world.t1.installationId)).items.find(
    (item) => item.id === adaOne.id,
  );
  // The signatory's own, the domain, the employee and the derived one; not the revoked and not the expired.
  expect([own.agreement.activeApprovalCount, listed?.activeApprovalCount]).toEqual([4, 4]);
});

test('an org admin revokes the agreement through the revocation of its signature: it is listed as revoked and the signatory sees it', async () => {
  const { world, adaOne, eveOne } = await twoTenantWorld();
  const response = await world.ask('admin1', {
    method: 'POST',
    url: revokePath(world.t1.installationId, adaOne.signatureId),
    payload: MAINTAINER_DECISION,
  });
  expect(response.statusCode).toBe(200);
  expect(signatureRevokeResponseSchema.parse(response.json()).signature.state).toBe('revoked');
  const items = asTenantPage(await listAs(world, 'admin1', world.t1.installationId)).items;
  expect(items.map((item) => [item.id, item.revoked])).toEqual([
    [eveOne.id, false],
    [adaOne.id, true],
  ]);
  const own = corporateAgreementPageSchema.parse((await getAs(world, world.ada, CORPORATE_AGREEMENTS_PATH)).json());
  expect(own.items.map((item) => [item.id, item.revoked])).toContainEqual([adaOne.id, true]);
});

test('after a revocation the signatory may sign again, and the new agreement is a row of its own', async () => {
  const { world, adaOne } = await twoTenantWorld();
  await world.ask('admin1', {
    method: 'POST',
    url: revokePath(world.t1.installationId, adaOne.signatureId),
    payload: MAINTAINER_DECISION,
  });
  const again = await postAgreement(world, world.ada, bodyFor(world.c1));
  expect(again.statusCode).toBe(201);
});

test('after the erasure of the signatory the list keeps the agreement and names neither the company nor the login', async () => {
  const { world, adaOne } = await twoTenantWorld();
  await sql`select erase_signer_pii(${ADA_ID}, ${world.people.admin1.githubId}, ${world.t1.installationId})`.execute(
    world.db,
  );
  const item = asTenantPage(await listAs(world, 'admin1', world.t1.installationId)).items.find(
    (entry) => entry.id === adaOne.id,
  );
  expect(item).toMatchObject({ companyName: null, signatory: { githubId: ADA_ID, login: null } });
});

test('the agreements of the person are read after erasure with no company and no title', async () => {
  const { world, adaTwo } = await twoTenantWorld();
  await sql`select erase_signer_pii(${ADA_ID}, ${world.people.admin2.githubId}, ${world.t2.installationId})`.execute(
    world.db,
  );
  const one = corporateAgreementDetailSchema.parse((await getAs(world, world.ada, agreementUrl(adaTwo.id))).json());
  expect(one.agreement).toMatchObject({ companyName: null, signatoryTitle: null });
  expect(JSON.stringify(one)).not.toContain('Acme Inc');
});
