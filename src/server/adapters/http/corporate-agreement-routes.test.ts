// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  CORPORATE_AGREEMENTS_PATH,
  type CorporateAgreement,
  corporateAgreementDetailSchema,
  corporateAgreementPageSchema,
} from '../../../shared/corporate.ts';
import {
  ADA_ID,
  agreementUrl,
  bodyFor,
  corporateWorld,
  failureOf,
  getAs,
  publishMajor,
  signAs,
  signerWith,
  withoutRequestId,
} from './corporate-fixture/test-support.ts';

// The agreements of the signed-in person (E21-S02): `GET /api/corporate/agreements` and `GET /api/corporate/agreements/:agreementId`.
// Authority is being the signatory of the agreement, so nobody else's is ever in an answer.

/** Ada signs under both tenants and, after a second major, under tenant 1 again; Eve signs under tenant 1. Answers the agreements. */
async function agreementsOfTwoPeople() {
  const world = await corporateWorld();
  const eve = await signerWith(world, 4321);
  const adaFirst = await signAs(world, world.ada, world.c1);
  const eves = await signAs(world, eve, world.c1, {
    typedName: 'Eve Example',
    companyName: 'Eve Ltd',
    signatoryTitle: 'Founder',
  });
  const adaOther = await signAs(world, world.ada, world.c2, { companyName: 'Acme Inc', signatoryTitle: 'CEO' });
  const major2 = await publishMajor(world, world.c1, 2);
  const adaSecond = await signAs(world, world.ada, world.c1, major2);
  return { world, eve, adaFirst, eves, adaOther, adaSecond };
}

const pageOf = (response: { statusCode: number; json: () => unknown }) => {
  expect(response.statusCode).toBe(200);
  return corporateAgreementPageSchema.parse(response.json());
};

test('the list holds the agreements of the person only, in every tenant, newest first, as the story shows them', async () => {
  const { world, adaFirst, adaOther, adaSecond } = await agreementsOfTwoPeople();
  const response = await getAs(world, world.ada, CORPORATE_AGREEMENTS_PATH);
  const page = pageOf(response);
  expect(page.items.map((item) => item.id)).toEqual([adaSecond.id, adaOther.id, adaFirst.id]);
  expect(page.nextCursor).toBeNull();
  expect(response.headers['cache-control']).toBe('no-store');
  const expected: CorporateAgreement = {
    id: adaOther.id,
    signatureId: adaOther.signatureId,
    signedAt: adaOther.signedAt,
    major: 1,
    companyName: 'Acme Inc',
    signatoryTitle: 'CEO',
    document: { id: world.c2.document.documentId, name: 'Corporate CLA' },
    installation: { accountLogin: 'org-2' },
    activeApprovalCount: 1,
    revoked: false,
  };
  expect(page.items[1]).toEqual(expected);
  expect(page.items.map((item) => item.major)).toEqual([2, 1, 1]);
});

test('the list of another person holds theirs and none of Ada’s, and a person who signed nothing gets an empty page', async () => {
  const { world, eve, eves } = await agreementsOfTwoPeople();
  const evePage = pageOf(await getAs(world, eve, CORPORATE_AGREEMENTS_PATH));
  expect(evePage.items.map((item) => [item.id, item.companyName])).toEqual([[eves.id, 'Eve Ltd']]);
  const nobody = await signerWith(world, 4400);
  expect(pageOf(await getAs(world, nobody, CORPORATE_AGREEMENTS_PATH))).toEqual({ items: [], nextCursor: null });
});

test('a page of one follows the cursor to the end with no agreement twice and none missed', async () => {
  const { world, adaFirst, adaOther, adaSecond } = await agreementsOfTwoPeople();
  const seen: number[] = [];
  let query = '?limit=1';
  for (let guard = 0; guard < 5; guard++) {
    const page = pageOf(await getAs(world, world.ada, `${CORPORATE_AGREEMENTS_PATH}${query}`));
    seen.push(...page.items.map((item) => item.id));
    if (page.nextCursor === null) {
      break;
    }
    query = `?limit=1&cursor=${page.nextCursor}`;
  }
  expect(seen).toEqual([adaSecond.id, adaOther.id, adaFirst.id]);
});

test('the cursor is opaque: a page of two ends at the id of the first agreement left out', async () => {
  const { world, adaFirst, adaOther, adaSecond } = await agreementsOfTwoPeople();
  const first = pageOf(await getAs(world, world.ada, `${CORPORATE_AGREEMENTS_PATH}?limit=2`));
  expect(first.items.map((item) => item.id)).toEqual([adaSecond.id, adaOther.id]);
  expect(JSON.parse(Buffer.from(first.nextCursor ?? '', 'base64url').toString('utf8'))).toEqual([adaFirst.id]);
});

test.each([
  ['a cursor that is not base64url', '!!!'],
  ['a cursor of text that is not JSON', Buffer.from('zzzz', 'utf8').toString('base64url')],
  ['a cursor of the wrong shape', Buffer.from('{"id":1}', 'utf8').toString('base64url')],
  ['a cursor of a zero id', Buffer.from('[0]', 'utf8').toString('base64url')],
  ['a cursor of a text id', Buffer.from('["1"]', 'utf8').toString('base64url')],
  ['a cursor of two values', Buffer.from('[1,2]', 'utf8').toString('base64url')],
  ['a cursor that is not canonical', `${Buffer.from('[1]', 'utf8').toString('base64url')}=`],
  ['a limit of zero', 'limit=0'],
  ['a limit over 100', 'limit=101'],
  ['a key the list does not know', 'userId=2'],
])('%s is a 400 bad_request', async (_label, query) => {
  const world = await corporateWorld();
  const url = query.includes('=') && !query.startsWith('cursor') ? `?${query}` : `?cursor=${encodeURIComponent(query)}`;
  expect(failureOf(await getAs(world, world.ada, `${CORPORATE_AGREEMENTS_PATH}${url}`))).toEqual([400, 'bad_request']);
});

test('one agreement of the person is read whole, with the text of the company and the title', async () => {
  const { world, adaFirst } = await agreementsOfTwoPeople();
  const response = await getAs(world, world.ada, agreementUrl(adaFirst.id));
  expect(response.statusCode).toBe(200);
  const { agreement } = corporateAgreementDetailSchema.parse(response.json());
  expect(agreement).toMatchObject({
    id: adaFirst.id,
    signatureId: adaFirst.signatureId,
    companyName: 'Acme GmbH',
    signatoryTitle: 'Chief Legal Officer',
    activeApprovalCount: 1,
    revoked: false,
  });
  expect(response.headers['cache-control']).toBe('no-store');
});

test('an agreement that is not the caller’s is the very 404 of an id that names nothing, byte for byte', async () => {
  const { world, eve, adaFirst, eves } = await agreementsOfTwoPeople();
  const missing = await getAs(world, world.ada, agreementUrl(987_654));
  expect(failureOf(missing)).toEqual([404, 'not_found']);
  const others = [
    await getAs(world, world.ada, agreementUrl(eves.id)),
    await getAs(world, eve, agreementUrl(adaFirst.id)),
  ];
  expect(others.map(withoutRequestId)).toEqual(others.map(() => withoutRequestId(missing)));
  expect(others.map((response) => response.statusCode)).toEqual([404, 404]);
});

test('a request with no session is a 401 on both routes, and a path id that is not a positive integer a 400', async () => {
  const { world, adaFirst } = await agreementsOfTwoPeople();
  expect(failureOf(await getAs(world, null, CORPORATE_AGREEMENTS_PATH))).toEqual([401, 'unauthorized']);
  expect(failureOf(await getAs(world, null, agreementUrl(adaFirst.id)))).toEqual([401, 'unauthorized']);
  for (const id of ['0', '-1', '1.5', 'abc', '01']) {
    expect(failureOf(await getAs(world, world.ada, agreementUrl(id))), id).toEqual([400, 'bad_request']);
  }
});

test('the agreements are read while the installation is suspended', async () => {
  const { world, adaFirst } = await agreementsOfTwoPeople();
  await world.db
    .updateTable('installations')
    .set({ suspended_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t1.installationId)
    .execute();
  expect((await getAs(world, world.ada, agreementUrl(adaFirst.id))).statusCode).toBe(200);
  expect(pageOf(await getAs(world, world.ada, CORPORATE_AGREEMENTS_PATH)).items).toHaveLength(3);
});

test('a revoked agreement is listed and read, marked revoked', async () => {
  const { world, adaFirst, adaOther } = await agreementsOfTwoPeople();
  await world.db
    .updateTable('signatures')
    .set({
      revoked_at: new Date(Date.now() + 1000),
      revoked_by: world.t1.publisherId,
      revoke_reason: 'maintainer_decision',
    })
    .where('id', '=', adaFirst.signatureId)
    .execute();
  const items = pageOf(await getAs(world, world.ada, CORPORATE_AGREEMENTS_PATH)).items;
  expect(items.map((item) => [item.id, item.revoked])).toEqual([
    [expect.any(Number), false],
    [adaOther.id, false],
    [adaFirst.id, true],
  ]);
  const one = corporateAgreementDetailSchema.parse((await getAs(world, world.ada, agreementUrl(adaFirst.id))).json());
  expect(one.agreement.revoked).toBe(true);
});

test('the signatory is the person of the signature: the numeric id of the session, never a login or an address', async () => {
  const { world, adaFirst } = await agreementsOfTwoPeople();
  const signature = await world.db
    .selectFrom('signatures as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .select('u.github_id')
    .where('s.id', '=', adaFirst.signatureId)
    .executeTakeFirstOrThrow();
  expect(signature.github_id).toBe(ADA_ID);
  const body = (await getAs(world, world.ada, CORPORATE_AGREEMENTS_PATH)).body;
  expect(body).not.toContain('ada@example.org');
  expect(body).not.toContain(`login-${ADA_ID}`);
  expect(body).not.toContain(bodyFor(world.c1).typedName);
});
