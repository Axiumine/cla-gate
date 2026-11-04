// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { activateMajor, seedInstant, seedSignatures } from './export/export-fixture/test-support.ts';
import { listOwnSignatures } from './own-signatures.ts';
import {
  ADA,
  addRepository,
  BOB,
  enforceDocument,
  suspend,
  twoSeededTenants,
  userIdOf,
} from './own-signatures-fixture/test-support.ts';

// The list of a person's own signatures as the screen shows it (E13-S06): the state of each signature, the way to sign again, the
// org and its suspension, the source, and the page and the place the next one starts at. The statement is in
// own-signatures-queries.test.ts and the route in adapters/http/own-signatures-*.test.ts.

const FIRST_PAGE = { limit: 50, from: null };
/** `expect.any` is typed `any`; as `unknown` it can sit in an object literal. */
const ANY_ID: unknown = expect.any(Number);
const REVOKED = { afterMs: 500, byGithubId: BOB, reason: 'signer_request' } as const;

async function world() {
  const { db } = await migratedTestDatabase();
  return { db, ...(await twoSeededTenants(db)) };
}

/** Ada's signatures: a revoked one and a live one of version 1.0 of tenant 1's document, and a live one of tenant 2's. */
async function adaSigns(
  world: Awaited<ReturnType<typeof twoSeededTenants>> & { db: Parameters<typeof seedSignatures>[0] },
) {
  await seedSignatures(world.db, world.t1, [
    { githubId: ADA, signedAtMs: 1000, revoked: REVOKED },
    { githubId: ADA, signedAtMs: 2000 },
  ]);
  await seedSignatures(world.db, world.t2, [{ githubId: ADA, signedAtMs: 3000 }]);
  return userIdOf(world.db, ADA);
}

test('the state of each signature comes from the major in force: revoked, outdated once a later major is published, active otherwise', async () => {
  const w = await world();
  const userId = await adaSigns(w);
  const before = await listOwnSignatures(w.db, userId, FIRST_PAGE);
  expect(before.items.map((item) => [item.installation.accountLogin, item.state])).toEqual([
    ['org-2', 'active'],
    ['org-1', 'active'],
    ['org-1', 'revoked'],
  ]);
  await activateMajor(w.db, w.t1, 2);
  const after = await listOwnSignatures(w.db, userId, FIRST_PAGE);
  expect(after.items.map((item) => [item.installation.accountLogin, item.state])).toEqual([
    ['org-2', 'active'],
    ['org-1', 'outdated'],
    ['org-1', 'revoked'],
  ]);
});

test('a document with no active version leaves the signature active', async () => {
  const w = await world();
  const userId = await adaSigns(w);
  await w.db.updateTable('cla_documents').set({ active_version_id: null }).where('id', '=', w.t2.documentId).execute();
  const { items } = await listOwnSignatures(w.db, userId, FIRST_PAGE);
  expect(items[0]).toMatchObject({ installation: { accountLogin: 'org-2' }, state: 'active' });
});

test('an item holds the org, the document, the version, the source and the instants, and no key of personal data or of a revocation reason', async () => {
  const w = await world();
  const userId = await adaSigns(w);
  const { items } = await listOwnSignatures(w.db, userId, FIRST_PAGE);
  expect(items[2]).toEqual({
    id: ANY_ID,
    installation: { accountLogin: 'org-1', accountType: 'Organization', suspended: false },
    document: { id: w.t1.documentId, name: 'Individual CLA' },
    version: { id: w.t1.versionId, major: 1, minor: 0 },
    signedAt: seedInstant(1000),
    source: { repositoryFullName: 'org-1/repo', prNumber: 7 },
    state: 'revoked',
    revokedAt: seedInstant(1500),
    resignPath: '/sign/9000',
  });
  expect(Object.keys(items[2] ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'document',
    'id',
    'installation',
    'resignPath',
    'revokedAt',
    'signedAt',
    'source',
    'state',
    'version',
  ]);
});

test('the way to sign again is the source repository while it is listed, for an outdated and for a revoked signature, and none for an active one', async () => {
  const w = await world();
  const userId = await adaSigns(w);
  await activateMajor(w.db, w.t1, 2);
  const { items } = await listOwnSignatures(w.db, userId, FIRST_PAGE);
  expect(items.map((item) => [item.state, item.resignPath])).toEqual([
    ['active', null],
    ['outdated', '/sign/9000'],
    ['revoked', '/sign/9000'],
  ]);
});

test('once the source repository is gone the way is the lowest repository that enforces the document, and none when there is no such repository', async () => {
  const w = await world();
  const userId = await adaSigns(w);
  await activateMajor(w.db, w.t1, 2);
  await w.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', w.t1.repositoryId)
    .execute();
  const none = await listOwnSignatures(w.db, userId, FIRST_PAGE);
  expect(none.items.map((item) => item.resignPath)).toEqual([null, null, null]);
  await addRepository(w.db, w.t1, { githubRepoId: 7000, enforcesDocument: true });
  await addRepository(w.db, w.t1, { githubRepoId: 6000, enforcesDocument: true });
  await addRepository(w.db, w.t1, { githubRepoId: 5000, enforcesDocument: false });
  const found = await listOwnSignatures(w.db, userId, FIRST_PAGE);
  expect(found.items.map((item) => item.resignPath)).toEqual([null, '/sign/6000', '/sign/6000']);
});

test('a source repository that is still listed wins over a lower one that enforces the document', async () => {
  const w = await world();
  const userId = await adaSigns(w);
  await activateMajor(w.db, w.t1, 2);
  await enforceDocument(w.db, w.t1);
  await addRepository(w.db, w.t1, { githubRepoId: 10, enforcesDocument: true });
  const { items } = await listOwnSignatures(w.db, userId, FIRST_PAGE);
  expect(items.map((item) => item.resignPath)).toEqual([null, '/sign/9000', '/sign/9000']);
});

test('a signature with no source repository has no source and, once outdated, the way of the document', async () => {
  const w = await world();
  await seedSignatures(w.db, w.t1, [{ githubId: ADA, signedAtMs: 1000, repositoryId: null }]);
  await activateMajor(w.db, w.t1, 2);
  await enforceDocument(w.db, w.t1);
  const { items } = await listOwnSignatures(w.db, await userIdOf(w.db, ADA), FIRST_PAGE);
  expect(items[0]).toMatchObject({ source: null, state: 'outdated', resignPath: '/sign/9000' });
});

test('a signature made from the dashboard names its repository and no pull request', async () => {
  const w = await world();
  await seedSignatures(w.db, w.t1, [{ githubId: ADA, signedAtMs: 1000, prNumber: null }]);
  const { items } = await listOwnSignatures(w.db, await userIdOf(w.db, ADA), FIRST_PAGE);
  expect(items[0]?.source).toEqual({ repositoryFullName: 'org-1/repo', prNumber: null });
});

test('a suspended installation stays listed and says so, and the other one does not', async () => {
  const w = await world();
  const userId = await adaSigns(w);
  await suspend(w.db, w.t1);
  const { items } = await listOwnSignatures(w.db, userId, FIRST_PAGE);
  expect(items.map((item) => [item.installation.accountLogin, item.installation.suspended])).toEqual([
    ['org-2', false],
    ['org-1', true],
    ['org-1', true],
  ]);
});

test('the account type is the one of the installation', async () => {
  const w = await world();
  const userId = await adaSigns(w);
  await w.db.updateTable('installations').set({ account_type: 'User' }).where('id', '=', w.t2.installationId).execute();
  const { items } = await listOwnSignatures(w.db, userId, FIRST_PAGE);
  expect(items.map((item) => item.installation.accountType)).toEqual(['User', 'Organization', 'Organization']);
});

test('a page of two out of three names the third as the place the next page starts at, and the last page names none', async () => {
  const w = await world();
  const userId = await adaSigns(w);
  const first = await listOwnSignatures(w.db, userId, { limit: 2, from: null });
  expect(first.items).toHaveLength(2);
  expect(first.next).toEqual({ signedAt: '2026-10-15T09:00:01.000000Z', id: ANY_ID });
  const second = await listOwnSignatures(w.db, userId, { limit: 2, from: first.next });
  expect(second.items.map((item) => item.signedAt)).toEqual([seedInstant(1000)]);
  expect(second.next).toBeNull();
});

test('exactly one page of rows has no next page, and a person with no signature has an empty page', async () => {
  const w = await world();
  const userId = await adaSigns(w);
  expect((await listOwnSignatures(w.db, userId, { limit: 3, from: null })).next).toBeNull();
  expect(await listOwnSignatures(w.db, userId + 1000, FIRST_PAGE)).toEqual({ items: [], next: null });
});
