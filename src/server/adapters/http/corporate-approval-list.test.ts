// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { APPROVAL_PAGE_SIZE } from '../../../shared/corporate-approvals.ts';
import { approve, daysFromNow, derive, insertApprovalRow } from '../db/corporate-fixture/test-support.ts';
import {
  type ApprovalWorld,
  addAs,
  addedOf,
  approvalsUrl,
  approvalWorld,
  pageOf,
  revokeAs,
  revokeSignature,
  seedUserApprovals,
  suspendTenantOne,
} from './corporate-approval-fixture/test-support.ts';
import { failureOf, getAs, signedOf, withoutRequestId } from './corporate-fixture/test-support.ts';

// The list of the approvals of an agreement (E21-S03): active, expired and revoked ones together, newest first, a page at a time
// (50, at most 200), for the signatory only, and served for a revoked agreement and a suspended tenant too.

/** Ada's own approval and `count` more of the manager, stored past the routes. */
async function withApprovals(count: number) {
  const world = await approvalWorld();
  await seedUserApprovals(
    world.db,
    { installationId: world.t1.installationId, agreementId: world.adas.id, userId: world.ada.userId },
    count,
  );
  return world;
}

/** The page of the approvals of Ada's agreement, with `query` (with its `?`). */
const listAdas = (world: ApprovalWorld, query = '') =>
  getAs(world, world.ada, `${approvalsUrl(world.adas.id)}${query}`);

test('the list holds the approvals of every kind and state, newest first, with the login snapshot, the rule and the reason', async () => {
  const world = await approvalWorld();
  const signed = signedOf(world.c1, world.ada, world.adas);
  const user = addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' }));
  const domain = await approve(world.db, signed, { kind: 'email_domain', domain: 'acme.example' });
  const derived = await derive(world.db, signed, domain, { githubId: 7002, login: 'derived-login' });
  const expired = await insertApprovalRow(world.db, {
    installation_id: world.t1.installationId,
    agreement_id: world.adas.id,
    kind: 'user',
    subject_github_id: 7003,
    subject_domain: null,
    source: 'rule',
    derived_from_approval_id: domain,
    approved_at: daysFromNow(-3),
    expires_at: daysFromNow(-1),
  });
  const gone = addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'github_org', login: 'acme-org' }));
  await revokeAs(world, world.ada, { agreementId: world.adas.id, approvalId: gone.id }, { reason: 'left the company' });
  const { items, nextCursor } = pageOf(await listAdas(world));
  expect(nextCursor).toBeNull();
  expect(
    items.map((item) => [item.id, item.kind, item.source, item.state, item.derivedFromApprovalId, item.login]),
  ).toEqual([
    [gone.id, 'github_org', 'manager', 'revoked', null, 'Acme-Org'],
    [expired, 'user', 'rule', 'expired', domain, null],
    [derived, 'user', 'rule', 'active', domain, 'derived-login'],
    [domain, 'email_domain', 'manager', 'active', null, null],
    [user.id, 'user', 'manager', 'active', null, 'Jane-Doe'],
    [expect.any(Number), 'user', 'manager', 'active', null, 'login-1234'],
  ]);
  expect(items[0]?.revokeReason).toBe('left the company');
  expect(items[0]?.revokedAt).toMatch(/Z$/u);
  expect(items[1]?.expiresAt).toMatch(/Z$/u);
});

test('the login of a person who was erased is null: the approval stays, by its numeric id', async () => {
  const world = await approvalWorld();
  const user = addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' }));
  await world.db.deleteFrom('corporate_approval_pii').where('approval_id', '=', user.id).execute();
  const shown = pageOf(await listAdas(world)).items.find((item) => item.id === user.id);
  expect([shown?.githubId, shown?.login]).toEqual([7001, null]);
});

test('a page is 50 approvals unless asked otherwise; the cursor goes on from the last one, and the pages together hold each approval once', async () => {
  const total = APPROVAL_PAGE_SIZE.default * 2 + 21;
  const world = await withApprovals(total - 1);
  const first = pageOf(await listAdas(world));
  expect(first.items).toHaveLength(APPROVAL_PAGE_SIZE.default);
  expect(first.nextCursor).not.toBeNull();
  const second = pageOf(await listAdas(world, `?cursor=${first.nextCursor}`));
  const third = pageOf(await listAdas(world, `?limit=30&cursor=${second.nextCursor}`));
  expect([second.items.length, third.items.length, third.nextCursor]).toEqual([50, 21, null]);
  const ids = [...first.items, ...second.items, ...third.items].map((item) => item.id);
  expect(new Set(ids).size).toBe(total);
  expect(ids).toEqual(ids.toSorted((a, b) => b - a));
});

test('200 is the most a page holds: one request with limit=200 holds them all, and the last page has no cursor', async () => {
  const world = await withApprovals(APPROVAL_PAGE_SIZE.max - 1);
  const page = pageOf(await listAdas(world, `?limit=${APPROVAL_PAGE_SIZE.max}`));
  expect([page.items.length, page.nextCursor]).toEqual([APPROVAL_PAGE_SIZE.max, null]);
});

test('a limit of 1 gives one approval and a cursor', async () => {
  const world = await withApprovals(2);
  const page = pageOf(await listAdas(world, '?limit=1'));
  expect([page.items.length, page.nextCursor === null]).toEqual([1, false]);
});

test.each([
  ['a limit of zero', '?limit=0'],
  ['a limit over 200', '?limit=201'],
  ['a limit with a sign', '?limit=%2B5'],
  ['a limit with a fraction', '?limit=1.5'],
  ['a limit that is not a number', '?limit=many'],
  ['a cursor that is not base64url', '?cursor=!!!'],
  ['a cursor of the wrong shape', `?cursor=${Buffer.from('{"id":1}', 'utf8').toString('base64url')}`],
  ['a key the list does not know', '?agreementId=2'],
])('%s is a 400 bad_request', async (_label, query) => {
  const world = await approvalWorld();
  expect(failureOf(await listAdas(world, query))).toEqual([400, 'bad_request']);
});

test.each([
  ['an id of zero', '0'],
  ['a negative id', '-3'],
  ['an id with a fraction', '1.5'],
  ['an id that is not a number', 'abc'],
])('%s in the path is a 400 bad_request', async (_label, id) => {
  const world = await approvalWorld();
  expect(failureOf(await getAs(world, world.ada, approvalsUrl(id)))).toEqual([400, 'bad_request']);
});

test('the answer is never cached', async () => {
  const world = await approvalWorld();
  expect((await listAdas(world)).headers['cache-control']).toBe('no-store');
});

test('a revoked agreement and a suspended installation are still listed: the roster of an agreement that ended is the manager’s', async () => {
  const world = await approvalWorld();
  await revokeSignature(world, world.adas.signatureId);
  await suspendTenantOne(world);
  expect(pageOf(await listAdas(world)).items).toHaveLength(1);
});

test('anybody but the signatory, and nobody, cannot list: the 404 of an id that names nothing, byte for byte, and a 401', async () => {
  const world = await approvalWorld();
  const unknown = await getAs(world, world.ada, approvalsUrl(987_654));
  const crossed = [
    await getAs(world, world.bob, approvalsUrl(world.adas.id)),
    await getAs(world, world.ada, approvalsUrl(world.bobs.id)),
  ];
  expect(failureOf(unknown)).toEqual([404, 'not_found']);
  expect(crossed.map(withoutRequestId)).toEqual(crossed.map(() => withoutRequestId(unknown)));
  expect(failureOf(await getAs(world, null, approvalsUrl(world.adas.id)))).toEqual([401, 'unauthorized']);
});
