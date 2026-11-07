// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { approve, derive } from '../db/corporate-fixture/test-support.ts';
import {
  addAs,
  addedOf,
  approvalsUrl,
  approvalUrl,
  approvalWorld,
  carryOverUrl,
  pageOf,
  revokeAs,
  revokedOf,
  stateOf,
  storedApprovals,
} from './corporate-approval-fixture/test-support.ts';
import { failureOf, getAs, signedOf, withoutRequestId } from './corporate-fixture/test-support.ts';

// Cross-tenant checks of the approvals (E21-S03): the signatory of tenant 2 sees and changes nothing of tenant 1's agreement, the org
// admin of tenant 1 is not its manager either, and what the two tenants approve is kept apart down to the same domain and the same
// person. Ada signed under tenant 1, Bob (GitHub id 4321) under tenant 2.

const DOMAIN = { kind: 'email_domain', domain: 'acme.example' } as const;

test('a manager cannot add, list, revoke or carry over under the agreement of another tenant: the 404 of an id that names nothing, and no row changes', async () => {
  const world = await approvalWorld();
  const jane = addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' }));
  const before = await stateOf(world.db);
  const calls = world.github.calls.length;
  const unknownId = 987_654;
  const attempts = (agreementId: number, approvalId: number) => [
    world.app.inject({
      method: 'POST',
      url: approvalsUrl(agreementId),
      headers: { ...world.bob.headers, 'content-type': 'application/json' },
      payload: JSON.stringify(DOMAIN),
    }),
    getAs(world, world.bob, approvalsUrl(agreementId)),
    revokeAs(world, world.bob, { agreementId, approvalId }, { reason: 'zzzz' }),
    world.app.inject({
      method: 'POST',
      url: carryOverUrl(agreementId),
      headers: { ...world.bob.headers, 'content-type': 'application/json' },
      payload: JSON.stringify({ fromAgreementId: world.bobs.id }),
    }),
  ];
  const unknown = await Promise.all(attempts(unknownId, unknownId));
  const crossed = await Promise.all(attempts(world.adas.id, jane.id));
  expect(unknown.map(failureOf)).toEqual(Array.from({ length: 4 }, () => [404, 'not_found']));
  expect(crossed.map(withoutRequestId)).toEqual(unknown.map(withoutRequestId));
  expect(world.github.calls).toHaveLength(calls);
  expect(await stateOf(world.db)).toEqual(before);
});

test('the org admin of a tenant is not the manager of its agreements: the same 404 on every route', async () => {
  const world = await approvalWorld();
  const jane = addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' }));
  const before = await stateOf(world.db);
  const asked = [
    await world.ask('admin1', { method: 'GET', url: approvalsUrl(world.adas.id) }),
    await world.ask('admin1', { method: 'POST', url: approvalsUrl(world.adas.id), payload: DOMAIN }),
    await world.ask('admin1', { method: 'DELETE', url: approvalUrl(world.adas.id, jane.id), payload: {} }),
    await world.ask('admin1', { method: 'POST', url: carryOverUrl(world.adas.id), payload: { fromAgreementId: 1 } }),
  ];
  expect(asked.map(failureOf)).toEqual(Array.from({ length: 4 }, () => [404, 'not_found']));
  expect(await stateOf(world.db)).toEqual(before);
});

test('the same domain approved in both tenants is two approvals: each list holds its own, and the lookups were made on each tenant’s installation', async () => {
  const world = await approvalWorld();
  const mine = addedOf(await addAs(world, world.ada, world.adas.id, DOMAIN));
  const his = addedOf(await addAs(world, world.bob, world.bobs.id, DOMAIN));
  addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' }));
  addedOf(await addAs(world, world.bob, world.bobs.id, { kind: 'user', login: 'jane-doe' }));
  const domainsOf = async (agreementId: number, who: typeof world.ada) =>
    pageOf(await getAs(world, who, approvalsUrl(agreementId))).items.filter((item) => item.kind === 'email_domain');
  expect((await domainsOf(world.adas.id, world.ada)).map((item) => item.id)).toEqual([mine.id]);
  expect((await domainsOf(world.bobs.id, world.bob)).map((item) => item.id)).toEqual([his.id]);
  expect(world.github.calls.map((call) => call.installationId)).toEqual([
    world.t1.githubInstallationId,
    world.t2.githubInstallationId,
  ]);
});

test('the same person approved in both tenants is two approvals, and revoking one leaves the other in force', async () => {
  const world = await approvalWorld();
  const first = addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' }));
  const second = addedOf(await addAs(world, world.bob, world.bobs.id, { kind: 'user', login: 'jane-doe' }));
  expect(first.githubId).toBe(second.githubId);
  revokedOf(await revokeAs(world, world.ada, { agreementId: world.adas.id, approvalId: first.id }));
  const theirs = (await storedApprovals(world.db, world.bobs.id)).find((row) => row.id === second.id);
  expect(theirs?.revoked_at).toBeNull();
});

test('revoking a domain in one tenant revokes the approvals derived from it there and from the same domain in the other tenant none', async () => {
  const world = await approvalWorld();
  const first = addedOf(await addAs(world, world.ada, world.adas.id, DOMAIN));
  const second = addedOf(await addAs(world, world.bob, world.bobs.id, DOMAIN));
  const own = await derive(world.db, signedOf(world.c1, world.ada, world.adas), first.id, {
    githubId: 7301,
    login: 'a',
  });
  const foreign = await derive(world.db, signedOf(world.c2, world.bob, world.bobs), second.id, {
    githubId: 7301,
    login: 'a',
  });
  const revoked = revokedOf(await revokeAs(world, world.ada, { agreementId: world.adas.id, approvalId: first.id }));
  expect(revoked.derivedRevoked).toBe(1);
  const stored = [
    ...(await storedApprovals(world.db, world.adas.id)),
    ...(await storedApprovals(world.db, world.bobs.id)),
  ];
  const revokedIds = stored.filter((row) => row.revoked_at !== null).map((row) => row.id);
  expect(revokedIds).toEqual([first.id, own]);
  expect(stored.find((row) => row.id === foreign)?.revoked_at).toBeNull();
  expect(stored.find((row) => row.id === second.id)?.revoked_at).toBeNull();
});

test('an organisation approved in one tenant does not appear in the other, and an approval id of the other tenant is a 404 in the path', async () => {
  const world = await approvalWorld();
  const bobsOrg = await approve(world.db, signedOf(world.c2, world.bob, world.bobs), {
    kind: 'github_org',
    githubId: 9100,
    login: 'acme-org',
  });
  const items = pageOf(await getAs(world, world.ada, approvalsUrl(world.adas.id))).items;
  expect(items.map((item) => item.id)).not.toContain(bobsOrg);
  const response = await revokeAs(world, world.ada, { agreementId: world.adas.id, approvalId: bobsOrg });
  expect(failureOf(response)).toEqual([404, 'not_found']);
});
