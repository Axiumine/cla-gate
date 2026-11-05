// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { activateMajor, seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { idsOf, pageOf, searchWorld } from './signature-search-fixture/test-support.ts';

// The filters of `GET /api/installations/:installationId/signatures` (E15-S02): the state, the signer by GitHub id and by login, and
// the document. The signatures are seeded with their own instants, newest first in every answer.

/** Three people: 71 signed major 1 and still holds it, 72 signed major 1 and was revoked, 73 signed major 2. The document is at major 2. */
async function documentAtMajorTwo() {
  const world = await searchWorld();
  const { db, t1 } = world;
  const second = await activateMajor(db, t1, 2);
  const [outdated, revoked, current] = await seedSignatures(db, t1, [
    { githubId: 71, signedAtMs: 3000 },
    { githubId: 72, signedAtMs: 2000, revoked: { afterMs: 10, byGithubId: 71, reason: 'other' } },
    { githubId: 73, signedAtMs: 1000, version: second },
  ]);
  return { ...world, outdated, revoked, current };
}

test('state=outdated returns only active signatures whose major is below the active major of the document', async () => {
  const { search, t1, outdated } = await documentAtMajorTwo();
  expect(idsOf(await search('admin1', t1.installationId, '?state=outdated'))).toEqual([t1.signatureId, outdated]);
});

test('state=active returns the signatures that are not revoked and not below the active major; state=revoked only the revoked ones', async () => {
  const { search, t1, revoked, current } = await documentAtMajorTwo();
  expect(idsOf(await search('admin1', t1.installationId, '?state=active'))).toEqual([current]);
  expect(idsOf(await search('admin1', t1.installationId, '?state=revoked'))).toEqual([revoked]);
});

test('state=all is the default and returns every signature, and each item names the state the shared function gives it', async () => {
  const { search, t1, outdated, revoked, current } = await documentAtMajorTwo();
  const everyone = [t1.signatureId, outdated, revoked, current];
  expect(idsOf(await search('admin1', t1.installationId))).toEqual(everyone);
  const { items } = pageOf(await search('admin1', t1.installationId, '?state=all'));
  expect(items.map((item) => [item.id, item.state])).toEqual([
    [t1.signatureId, 'outdated'],
    [outdated, 'outdated'],
    [revoked, 'revoked'],
    [current, 'active'],
  ]);
});

test('a document with no active version has no outdated signature: its signatures are active', async () => {
  const { db, scopedTarget, search, t1 } = await searchWorld();
  const [id] = await seedSignatures(db, await scopedTarget(), [{ githubId: 71 }]);
  await db
    .updateTable('cla_documents')
    .set({ active_version_id: null })
    .where('id', '=', t1.scoped.documentId)
    .execute();
  expect(idsOf(await search('admin1', t1.installationId, `?state=active&documentId=${t1.scoped.documentId}`))).toEqual([
    id,
  ]);
  expect(
    idsOf(await search('admin1', t1.installationId, `?state=outdated&documentId=${t1.scoped.documentId}`)),
  ).toEqual([]);
});

test('githubUserId is an exact match on the id of the signer: every signature of that person, revoked ones included, and no other', async () => {
  const { db, search, t1 } = await searchWorld();
  const ids = await seedSignatures(db, t1, [
    { githubId: 71, signedAtMs: 1000, revoked: { afterMs: 10, byGithubId: 8, reason: 'other' } },
    { githubId: 7, signedAtMs: 2000 },
    { githubId: 71, signedAtMs: 3000 },
    { githubId: 710, signedAtMs: 4000 },
  ]);
  expect(idsOf(await search('admin1', t1.installationId, '?githubUserId=71'))).toEqual([ids[2], ids[0]]);
  expect(idsOf(await search('admin1', t1.installationId, '?githubUserId=7'))).toEqual([ids[1]]);
  expect(idsOf(await search('admin1', t1.installationId, '?githubUserId=987654'))).toEqual([]);
});

test('login matches the login the signer gave, whatever the case, and never by prefix, suffix or wildcard', async () => {
  const { db, search, t1 } = await searchWorld();
  const pii = (login: string, n: number) => ({ login, name: `Name ${n}`, email: `n${n}@example.test` });
  const ids = await seedSignatures(db, t1, [
    { githubId: 71, signedAtMs: 1000, pii: pii('Ada-Lovelace', 1) },
    { githubId: 72, signedAtMs: 2000, pii: pii('ada-lovelace-2', 2) },
    { githubId: 73, signedAtMs: 3000, pii: pii('xada-lovelace', 3) },
    { githubId: 74, signedAtMs: 4000, pii: pii('ada_lovelace', 4) },
  ]);
  const found = async (login: string) =>
    idsOf(await search('admin1', t1.installationId, `?login=${encodeURIComponent(login)}`));
  expect(await found('ada-lovelace')).toEqual([ids[0]]);
  expect(await found('ADA-LOVELACE')).toEqual([ids[0]]);
  expect(await found('Ada-Lovelace')).toEqual([ids[0]]);
  expect(await found('ada')).toEqual([]);
  expect(await found('ada-lovelace%')).toEqual([]);
  expect(await found('ada%lovelace')).toEqual([]);
  expect(await found('ada-lovelac_')).toEqual([]);
  expect(await found('ada_lovelace')).toEqual([ids[3]]);
});

test('login is the snapshot of signer_pii, not the login of the users row, and finds nothing once the personal data is erased', async () => {
  const { db, search, t1 } = await searchWorld();
  const ids = await seedSignatures(db, t1, [
    { githubId: 71, signedAtMs: 1000, pii: { login: 'snapshot-71', name: 'N', email: 'n@example.test' } },
    { githubId: 72, signedAtMs: 2000, pii: null },
  ]);
  expect(idsOf(await search('admin1', t1.installationId, '?login=login-71'))).toEqual([]);
  expect(idsOf(await search('admin1', t1.installationId, '?login=SNAPSHOT-71'))).toEqual([ids[0]]);
  expect(idsOf(await search('admin1', t1.installationId, '?login=login-72'))).toEqual([]);
  expect(idsOf(await search('admin1', t1.installationId, '?githubUserId=72'))).toEqual([ids[1]]);
});

test('the filters narrow each other: a signer, a state and a document together', async () => {
  const { db, scopedTarget, search, t1 } = await searchWorld();
  const [first, second] = await seedSignatures(db, t1, [
    { githubId: 71, signedAtMs: 1000 },
    { githubId: 71, signedAtMs: 2000, revoked: { afterMs: 10, byGithubId: 8, reason: 'other' } },
  ]);
  await seedSignatures(db, await scopedTarget(), [{ githubId: 71, signedAtMs: 3000 }]);
  const base = `?githubUserId=71&documentId=${t1.documentId}`;
  expect(idsOf(await search('admin1', t1.installationId, base))).toEqual([second, first]);
  expect(idsOf(await search('admin1', t1.installationId, `${base}&state=revoked`))).toEqual([second]);
  expect(idsOf(await search('admin1', t1.installationId, `${base}&state=active&login=login-71`))).toEqual([first]);
});
