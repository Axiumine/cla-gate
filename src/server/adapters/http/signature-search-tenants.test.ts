// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { idsOf, pageOf, searchWorld, withoutRequestId } from './signature-search-fixture/test-support.ts';

// The search for signatures and the tenants (E15-S02): every statement names the installation of the path, so a signature of another
// tenant never comes back, whoever asks and whatever the filters say.

/** The ids of the signatures a tenant holds, from the database. */
async function storedIds(db: Parameters<typeof seedSignatures>[0], installationId: number): Promise<number[]> {
  const rows = await db
    .selectFrom('signatures')
    .select('id')
    .where('installation_id', '=', installationId)
    .orderBy('signed_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return rows.map((row) => row.id);
}

test('an admin of tenant 1 asking for the installation of tenant 2 gets the 404 of an id that exists nowhere, byte for byte, and the reverse', async () => {
  const { search, t1, t2 } = await searchWorld();
  const unknown = await search('admin1', 987_654);
  const crossed = await search('admin1', t2.installationId);
  const reverse = await search('admin2', t1.installationId);
  expect([unknown.statusCode, crossed.statusCode, reverse.statusCode]).toEqual([404, 404, 404]);
  expect(withoutRequestId(crossed)).toBe(withoutRequestId(unknown));
  expect(withoutRequestId(reverse)).toBe(withoutRequestId(unknown));
  expect(crossed.body).not.toContain('org-2');
});

test('a documentId of tenant 2 under the path of tenant 1 is a 404, for an org admin and for a repository admin, and the reverse', async () => {
  const { search, t1, t2 } = await searchWorld();
  const unknown = await search('admin1', t1.installationId, '?documentId=987654');
  for (const documentId of [t2.documentId, t2.scoped.documentId]) {
    for (const who of ['admin1', 'repoAdmin1'] as const) {
      const response = await search(who, t1.installationId, `?documentId=${documentId}`);
      expect([who, response.statusCode]).toEqual([who, 404]);
      expect(withoutRequestId(response)).toBe(withoutRequestId(unknown));
    }
  }
  expect((await search('admin2', t2.installationId, `?documentId=${t1.documentId}`)).statusCode).toBe(404);
  expect(pageOf(await search('admin2', t2.installationId, `?documentId=${t2.documentId}`)).items).toHaveLength(1);
});

test('a signature of the same GitHub user in tenant 2 never appears in the result of tenant 1, with or without the filter, and the reverse', async () => {
  const { db, search, t1, t2 } = await searchWorld();
  const person = t1.signer.githubId;
  const [mine] = await seedSignatures(db, t1, [{ githubId: 91 }]);
  const [theirs, theirsToo] = await seedSignatures(db, t2, [{ githubId: person }, { githubId: 91 }]);
  const first = await search('admin1', t1.installationId);
  const second = await search('admin2', t2.installationId);
  expect(idsOf(first)).toEqual(await storedIds(db, t1.installationId));
  expect(idsOf(second)).toEqual(await storedIds(db, t2.installationId));
  expect(idsOf(await search('admin1', t1.installationId, `?githubUserId=${person}`))).toEqual([t1.signatureId]);
  expect(idsOf(await search('admin2', t2.installationId, `?githubUserId=${person}`))).toEqual([theirs]);
  expect(idsOf(await search('admin1', t1.installationId, '?githubUserId=91'))).toEqual([mine]);
  expect(idsOf(await search('admin2', t2.installationId, '?githubUserId=91'))).toEqual([theirsToo]);
  expect(first.body).not.toContain('org-2');
  expect(second.body).not.toContain('org-1');
});

test('the login of a signer of tenant 2 finds nothing under tenant 1, even for the same text', async () => {
  const { db, search, t1, t2 } = await searchWorld();
  const pii = { login: 'shared-login', name: 'Same Person', email: 'same@example.test' };
  const [inTwo] = await seedSignatures(db, t2, [{ githubId: 92, pii }]);
  expect(idsOf(await search('admin1', t1.installationId, '?login=shared-login'))).toEqual([]);
  expect(idsOf(await search('admin2', t2.installationId, '?login=shared-login'))).toEqual([inTwo]);
});

test('an admin of both tenants sees each tenant only under its own path, and a document of the other one is still a 404', async () => {
  const { db, people, roles, roleTable, search, t1, t2 } = await searchWorld();
  const both = { login: people.admin1.login, userId: people.admin1.githubId, role: 'admin' } as const;
  roles.load({ ...roleTable, orgs: [...roleTable.orgs, { ...both, installation: t2.githubInstallationId }] });
  const [inOne] = await seedSignatures(db, t1, [{ githubId: 91 }]);
  const [inTwo] = await seedSignatures(db, t2, [{ githubId: 91 }]);
  expect(idsOf(await search('admin1', t1.installationId))).toEqual([t1.signatureId, inOne]);
  expect(idsOf(await search('admin1', t2.installationId))).toEqual([t2.signatureId, inTwo]);
  expect((await search('admin1', t1.installationId, `?documentId=${t2.documentId}`)).statusCode).toBe(404);
  expect((await search('admin1', t2.installationId, `?documentId=${t1.documentId}`)).statusCode).toBe(404);
});
