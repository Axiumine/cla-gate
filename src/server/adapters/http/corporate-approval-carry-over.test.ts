// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { carryOverResultSchema } from '../../../shared/corporate-approvals.ts';
import { derive } from '../db/corporate-fixture/test-support.ts';
import {
  addAs,
  addedOf,
  approvalsUrl,
  approvalWorld,
  auditRowsOf,
  carryOverAs,
  pageOf,
  revokeAs,
  revokeSignature,
  seedUserApprovals,
  stateOf,
  storedApprovals,
  suspendTenantOne,
} from './corporate-approval-fixture/test-support.ts';
import {
  detailsOf,
  failureOf,
  getAs,
  publishMajor,
  signAs,
  signedOf,
  withoutRequestId,
} from './corporate-fixture/test-support.ts';

// Carrying the approvals over to a new major (E21-S03): the signatory copies their own, still active, manager-made approvals of an
// earlier agreement of the same corporate document to the new agreement, one audit row per copy, all or nothing.

/** Ada signed major 1, approved Jane, a domain and an organisation (revoked), got an employee derived from the domain, and signed major 2. */
async function withTwoMajors() {
  const world = await approvalWorld();
  const first = world.adas;
  const jane = addedOf(await addAs(world, world.ada, first.id, { kind: 'user', login: 'jane-doe' }));
  const domain = addedOf(await addAs(world, world.ada, first.id, { kind: 'email_domain', domain: 'acme.example' }));
  const org = addedOf(await addAs(world, world.ada, first.id, { kind: 'github_org', login: 'acme-org' }));
  await revokeAs(world, world.ada, { agreementId: first.id, approvalId: org.id });
  await derive(world.db, signedOf(world.c1, world.ada, first), domain.id, { githubId: 7002, login: 'derived-login' });
  const second = await signAs(world, world.ada, world.c1, await publishMajor(world, world.c1, 2));
  return { world, first, second, jane, domain };
}

/** The answer of a `200` carry-over. */
function resultOf(response: { statusCode: number; json: () => unknown }) {
  expect(response.statusCode).toBe(200);
  return carryOverResultSchema.parse(response.json());
}

/** What an approval covers, as one line: the kind and the numeric id or the domain. */
const coverOf = (item: { kind: string; githubId: number | null; domain: string | null }): string =>
  `${item.kind}:${item.githubId ?? item.domain}`;

test('the active approvals of the manager are copied to the new agreement, with their login snapshot, one audit row per copy', async () => {
  const { world, first, second, jane, domain } = await withTwoMajors();
  const result = resultOf(await carryOverAs(world, world.ada, second.id, { fromAgreementId: first.id }));
  // Jane and the domain are copied; Ada's own approval is there from signing; the revoked organisation and the derived employee are not.
  expect(result).toEqual({ copied: 2, skipped: 1 });
  const items = pageOf(await getAs(world, world.ada, approvalsUrl(second.id))).items;
  expect(items.map(coverOf).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'email_domain:acme.example',
    'user:1234',
    'user:7001',
  ]);
  expect(items.every((item) => item.source === 'manager' && item.state === 'active')).toBe(true);
  expect(items.find((item) => coverOf(item) === 'user:7001')?.login).toBe('Jane-Doe');
  const listed = new Set(items.map((item) => item.id));
  const carried = (await auditRowsOf(world.db, 'corporate_approval.added')).filter((row) =>
    listed.has(row.subject_id ?? 0),
  );
  const idOf = (cover: string) => items.find((item) => coverOf(item) === cover)?.id;
  expect(carried.map((row) => [row.subject_id, row.installation_id, row.actor_github_id])).toEqual(
    expect.arrayContaining([
      [idOf('user:7001'), world.t1.installationId, 1234],
      [idOf('email_domain:acme.example'), world.t1.installationId, 1234],
    ]),
  );
  expect(carried.map((row) => row.metadata)).toEqual(
    expect.arrayContaining([
      { kind: 'user', github_id: 7001, signature_id: second.signatureId, reason_code: 'carried_over' },
      { kind: 'email_domain', github_id: null, signature_id: second.signatureId, reason_code: 'carried_over' },
    ]),
  );
  expect(carried).toHaveLength(2);
  // The earlier agreement is untouched.
  const rows = await storedApprovals(world.db, first.id);
  expect(rows.filter((row) => [jane.id, domain.id].includes(row.id)).map((row) => row.revoked_at)).toEqual([
    null,
    null,
  ]);
});

test('a second carry-over copies nothing: the approvals are there already, and no audit row is written', async () => {
  const { world, first, second } = await withTwoMajors();
  resultOf(await carryOverAs(world, world.ada, second.id, { fromAgreementId: first.id }));
  const before = await stateOf(world.db);
  expect(resultOf(await carryOverAs(world, world.ada, second.id, { fromAgreementId: first.id }))).toEqual({
    copied: 0,
    skipped: 3,
  });
  expect(await stateOf(world.db)).toEqual(before);
});

test('an approval the new agreement already has is skipped', async () => {
  const { world, first, second } = await withTwoMajors();
  addedOf(await addAs(world, world.ada, second.id, { kind: 'user', login: 'jane-doe' }));
  expect(resultOf(await carryOverAs(world, world.ada, second.id, { fromAgreementId: first.id }))).toEqual({
    copied: 1,
    skipped: 2,
  });
});

test('the agreement that ended can still be copied from: its roster is the manager’s', async () => {
  const { world, first, second } = await withTwoMajors();
  await revokeSignature(world, first.signatureId);
  expect(resultOf(await carryOverAs(world, world.ada, second.id, { fromAgreementId: first.id })).copied).toBe(2);
});

interface Ids {
  readonly first: number;
  readonly second: number;
}

test.each([
  ['the agreement itself', (ids: Ids) => ({ into: ids.second, from: ids.second })],
  ['a later major than the target', (ids: Ids) => ({ into: ids.first, from: ids.second })],
])('%s as the source is a 422 validation_failed on the field fromAgreementId', async (_label, choose) => {
  const { world, first, second } = await withTwoMajors();
  const { into, from } = choose({ first: first.id, second: second.id });
  const before = await stateOf(world.db);
  const response = await carryOverAs(world, world.ada, into, { fromAgreementId: from });
  expect(failureOf(response)).toEqual([422, 'validation_failed']);
  expect(detailsOf(response)).toEqual({ field: 'fromAgreementId' });
  expect(await stateOf(world.db)).toEqual(before);
});

test('an agreement of another corporate document is no source, even when it is the same person’s', async () => {
  const { world, second } = await withTwoMajors();
  const elsewhere = await signAs(world, world.ada, world.c2, { companyName: 'Acme Inc', signatoryTitle: 'CEO' });
  const response = await carryOverAs(world, world.ada, second.id, { fromAgreementId: elsewhere.id });
  expect(failureOf(response)).toEqual([422, 'validation_failed']);
  expect(detailsOf(response)).toEqual({ field: 'fromAgreementId' });
});

test('an agreement that is not the caller’s, as the target or as the source, is the 404 of an id that names nothing', async () => {
  const { world, first, second } = await withTwoMajors();
  const before = await stateOf(world.db);
  const unknown = await carryOverAs(world, world.ada, second.id, { fromAgreementId: 987_654 });
  const crossed = [
    await carryOverAs(world, world.ada, second.id, { fromAgreementId: world.bobs.id }),
    await carryOverAs(world, world.bob, second.id, { fromAgreementId: first.id }),
    await carryOverAs(world, world.ada, world.bobs.id, { fromAgreementId: first.id }),
    await carryOverAs(world, world.ada, 987_654, { fromAgreementId: first.id }),
  ];
  expect(failureOf(unknown)).toEqual([404, 'not_found']);
  expect(crossed.map(withoutRequestId)).toEqual(crossed.map(() => withoutRequestId(unknown)));
  expect(await stateOf(world.db)).toEqual(before);
});

test('a revoked target is a 409 agreement_revoked, and a suspended installation a 409 installation_suspended', async () => {
  const { world, first, second } = await withTwoMajors();
  const before = await stateOf(world.db);
  await suspendTenantOne(world);
  expect(failureOf(await carryOverAs(world, world.ada, second.id, { fromAgreementId: first.id }))).toEqual([
    409,
    'installation_suspended',
  ]);
  await world.db
    .updateTable('installations')
    .set({ suspended_at: null })
    .where('id', '=', world.t1.installationId)
    .execute();
  await revokeSignature(world, second.signatureId);
  expect(failureOf(await carryOverAs(world, world.ada, second.id, { fromAgreementId: first.id }))).toEqual([
    409,
    'agreement_revoked',
  ]);
  expect(await stateOf(world.db)).toEqual(before);
});

test('the copies must fit together under the limit: all of them or none, 422 approval_limit', async () => {
  const { world, first, second } = await withTwoMajors();
  // Ada's own approval and 498 more are 499 in force under the new agreement: the two copies would make 501.
  await seedUserApprovals(
    world.db,
    { installationId: world.t1.installationId, agreementId: second.id, userId: world.ada.userId },
    498,
  );
  const before = await stateOf(world.db);
  const response = await carryOverAs(world, world.ada, second.id, { fromAgreementId: first.id });
  expect(failureOf(response)).toEqual([422, 'approval_limit']);
  expect(detailsOf(response)).toEqual({ limit: 500 });
  expect(await stateOf(world.db)).toEqual(before);
});

test.each([
  ['no body', undefined],
  ['an empty object', {}],
  ['an id that is not a number', { fromAgreementId: 'one' }],
  ['an id of zero', { fromAgreementId: 0 }],
  ['a fraction', { fromAgreementId: 1.5 }],
  ['a key the request does not know', { fromAgreementId: 1, copyRevoked: true }],
])('%s is a 400 bad_request', async (_label, body) => {
  const { world, second } = await withTwoMajors();
  expect(failureOf(await carryOverAs(world, world.ada, second.id, body))).toEqual([400, 'bad_request']);
});
