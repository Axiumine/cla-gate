// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { OwnSignatureState } from '../../../shared/own-signatures.ts';
import { activateMajor, seedInstant, seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { tenantChecksums } from '../db/tenant-fixture/test-support.ts';
import type { Tenant } from '../db/test-support.ts';
import { failureOf, ownSignaturesWorld, pageOf } from './own-signatures-fixture/test-support.ts';

// `GET /api/me/signatures` (E13-S06): who may ask, the answer for a person with and without signatures, the fields of an item and
// the states, and that the read writes nothing. The query string is in own-signatures-query.test.ts, the pages in
// own-signatures-pages.test.ts and the isolation of people and tenants in own-signatures-tenants.test.ts.

const ADA = 1234;

/** What differs between the items of the test: the signature, when it was made, the pull request and where it stands. */
interface ItemFields {
  readonly id: number | undefined;
  readonly signedAtMs: number;
  readonly prNumber: number | null;
  readonly state: OwnSignatureState;
  readonly revokedAtMs?: number;
  readonly resignPath: string | null;
}

/** What the item of a signature of tenant `n` (its document and version 1.0, the repository `org-<n>/repo`) is in the answer. */
function itemOf(tenant: Tenant, n: number, fields: ItemFields) {
  return {
    id: fields.id,
    installation: { accountLogin: `org-${n}`, accountType: 'Organization', suspended: false },
    document: { id: tenant.documentId, name: 'Individual CLA' },
    version: { id: tenant.versionId, major: 1, minor: 0 },
    signedAt: seedInstant(fields.signedAtMs).toISOString(),
    source: { repositoryFullName: `org-${n}/repo`, prNumber: fields.prNumber },
    state: fields.state,
    revokedAt: fields.revokedAtMs === undefined ? null : seedInstant(fields.revokedAtMs).toISOString(),
    resignPath: fields.resignPath,
  };
}

test('a signed-in person gets their signatures newest first, with the fields of the story, and the answer is never cached', async () => {
  const world = await ownSignaturesWorld();
  const ada = await world.login(ADA);
  const [revoked, live] = await seedSignatures(world.db, world.t1, [
    { githubId: ADA, signedAtMs: 1000, revoked: { afterMs: 500, byGithubId: 99, reason: 'legal_request' } },
    { githubId: ADA, signedAtMs: 2000, prNumber: 45 },
  ]);
  const [other] = await seedSignatures(world.db, world.t2, [{ githubId: ADA, signedAtMs: 3000, prNumber: null }]);
  await activateMajor(world.db, world.t1, 2);
  const response = await world.list(ada);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['content-type']).toContain('application/json');
  expect(pageOf(response)).toEqual({
    items: [
      itemOf(world.t2, 2, { id: other, signedAtMs: 3000, prNumber: null, state: 'active', resignPath: null }),
      itemOf(world.t1, 1, { id: live, signedAtMs: 2000, prNumber: 45, state: 'outdated', resignPath: '/sign/9000' }),
      itemOf(world.t1, 1, {
        id: revoked,
        signedAtMs: 1000,
        prNumber: 7,
        state: 'revoked',
        revokedAtMs: 1500,
        resignPath: '/sign/9000',
      }),
    ],
    nextCursor: null,
  });
});

test('a person without signatures gets 200 with an empty list and no cursor', async () => {
  const world = await ownSignaturesWorld();
  const ada = await world.login(ADA);
  const response = await world.list(ada);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ items: [], nextCursor: null });
});

test('a request with no session is a 401 with the standard body, never a redirect, whatever the query string says', async () => {
  const world = await ownSignaturesWorld();
  for (const query of ['', '?limit=5', '?limit=0', '?userId=2', '?cursor=zzzz']) {
    const response = await world.list(null, query);
    expect(failureOf(response)).toEqual([401, 'unauthorized']);
    expect(response.headers.location).toBeUndefined();
  }
});

test('a session cookie that is not live is a 401 as well', async () => {
  const world = await ownSignaturesWorld();
  const ada = await world.login(ADA);
  world.advance(30 * 24 * 3600);
  const response = await world.list(ada);
  expect(response.statusCode).toBe(401);
  expect(response.headers.location).toBeUndefined();
});

test('an installation that is suspended or uninstalled keeps its signatures in the list, and says whether it is suspended', async () => {
  const world = await ownSignaturesWorld();
  const ada = await world.login(ADA);
  await seedSignatures(world.db, world.t1, [{ githubId: ADA, signedAtMs: 1000 }]);
  await seedSignatures(world.db, world.t2, [{ githubId: ADA, signedAtMs: 2000 }]);
  await world.db
    .updateTable('installations')
    .set({ suspended_at: new Date('2026-10-20T00:00:00Z') })
    .where('id', '=', world.t1.installationId)
    .execute();
  await world.db
    .updateTable('installations')
    .set({ deleted_at: new Date('2026-10-21T00:00:00Z') })
    .where('id', '=', world.t2.installationId)
    .execute();
  const { items } = pageOf(await world.list(ada));
  expect(items.map((item) => [item.installation.accountLogin, item.installation.suspended])).toEqual([
    ['org-2', false],
    ['org-1', true],
  ]);
});

test('the read writes nothing: no row, no job and no audit entry', async () => {
  const world = await ownSignaturesWorld();
  const ada = await world.login(ADA);
  await seedSignatures(world.db, world.t1, [{ githubId: ADA, signedAtMs: 1000 }]);
  const before = await tenantChecksums(world.db);
  pageOf(await world.list(ada));
  pageOf(await world.list(ada, '?limit=1'));
  expect(await tenantChecksums(world.db)).toEqual(before);
});

test('a HEAD request has no route of its own, so the list has one budget and one answer', async () => {
  const world = await ownSignaturesWorld();
  const ada = await world.login(ADA);
  const response = await world.app.inject({
    method: 'HEAD',
    url: '/api/me/signatures',
    headers: { cookie: ada.cookie },
  });
  expect(response.statusCode).toBe(404);
});
