// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { NoResultError } from 'kysely';
import { expect, test } from 'vitest';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase, publishVersion, sha256 } from '../adapters/db/test-support.ts';
import { findLiveSignature, insertSignature, insertSignerPii, type NewSignature } from './sign-record-queries.ts';

// The statements that record a signature (E13-S04). The route tests show them through the whole request; these show each one
// on its own, including what the route never asks of it: a document of another tenant, a signature that is revoked, the person
// of another signature. The tenant matrix of the registry (E11-S06) calls them for two tenants as well.

const world = async () => {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  const scope = { installationId: tenants.t1.installationId };
  // The publisher of tenant 1 has signed nothing; the signer of the world has signed version 1.0.
  const request = (overrides: Partial<NewSignature> = {}): NewSignature => ({
    userId: tenants.t1.publisherId,
    documentId: tenants.t1.documentId,
    versionId: tenants.t1.versionId,
    consentTextId: 'individual-v1',
    sourceRepositoryId: tenants.t1.plain.repositoryId,
    sourcePrNumber: 7,
    ...overrides,
  });
  return { db, ...tenants, scope, request };
};

test('insertSignature copies the major and the hash from the version row, writes an individual signature and answers its id and instant', async () => {
  const { db, t1, scope, request } = await world();
  const written = await insertSignature(db, scope, request());
  const row = await db
    .selectFrom('signatures')
    .selectAll()
    .where('user_id', '=', t1.publisherId)
    .executeTakeFirstOrThrow();
  expect(written).toEqual({ id: row.id, signedAt: row.signed_at });
  expect(row).toMatchObject({
    installation_id: t1.installationId,
    document_id: t1.documentId,
    version_id: t1.versionId,
    major: 1,
    content_sha256: t1.contentSha256,
    consent_text_id: 'individual-v1',
    signer_type: 'individual',
    source_repository_id: t1.plain.repositoryId,
    source_pr_number: 7,
    revoked_at: null,
  });
});

test('insertSignature stores no source when there is none', async () => {
  const { db, t1, scope, request } = await world();
  await insertSignature(db, scope, request({ sourceRepositoryId: null, sourcePrNumber: null }));
  const row = await db
    .selectFrom('signatures')
    .select(['source_repository_id', 'source_pr_number'])
    .where('user_id', '=', t1.publisherId)
    .executeTakeFirstOrThrow();
  expect(row).toEqual({ source_repository_id: null, source_pr_number: null });
});

test('insertSignature writes nothing, and says so with null, when a signature that is not revoked exists for the person, document and major', async () => {
  const { db, t1, scope, request } = await world();
  expect(await insertSignature(db, scope, request())).not.toBeNull();
  const minor = await publishVersion(db, t1.documentId, t1.publisherId, { major: 1, minor: 1, text: 'Terms 1.1' });
  expect(await insertSignature(db, scope, request({ versionId: minor.id }))).toBeNull();
  expect(await insertSignature(db, scope, request())).toBeNull();
  const rows = await db.selectFrom('signatures').select('id').where('user_id', '=', t1.publisherId).execute();
  expect(rows).toHaveLength(1);
});

test('insertSignature writes a second row for a revoked signature and for another major', async () => {
  const { db, t1, scope, request } = await world();
  const first = await insertSignature(db, scope, request());
  await db
    .updateTable('signatures')
    .set({ revoked_at: new Date(Date.now() + 1000), revoked_by: t1.publisherId, revoke_reason: 'signer_request' })
    .where('id', '=', first?.id ?? 0)
    .execute();
  expect(await insertSignature(db, scope, request())).not.toBeNull();
  const major2 = await publishVersion(db, t1.documentId, t1.publisherId, { major: 2, minor: 0, text: 'Terms 2.0' });
  expect(await insertSignature(db, scope, request({ versionId: major2.id }))).not.toBeNull();
  expect(await db.selectFrom('signatures').select('id').where('user_id', '=', t1.publisherId).execute()).toHaveLength(
    3,
  );
});

test.each([
  ['the document of another tenant', (w: Awaited<ReturnType<typeof world>>) => ({ documentId: w.t2.documentId })],
  ['the version of another tenant', (w: Awaited<ReturnType<typeof world>>) => ({ versionId: w.t2.versionId })],
  ['a document that does not exist', () => ({ documentId: 987_654 })],
  ['a version that does not exist', () => ({ versionId: 987_654 })],
])('insertSignature writes nothing for %s', async (_label, change) => {
  const w = await world();
  const before = await w.db.selectFrom('signatures').select('id').execute();
  expect(await insertSignature(w.db, w.scope, w.request(change(w)))).toBeNull();
  expect(await w.db.selectFrom('signatures').select('id').execute()).toEqual(before);
});

test('insertSignature refuses a source repository of another tenant, and writes nothing', async () => {
  const { db, t1, t2, scope, request } = await world();
  await expect(
    insertSignature(db, scope, request({ sourceRepositoryId: t2.plain.repositoryId })),
  ).rejects.toMatchObject({
    code: '23503',
  });
  expect(await db.selectFrom('signatures').select('id').where('user_id', '=', t1.publisherId).execute()).toEqual([]);
});

/** The signature of the publisher of tenant 1, written by `insertSignature`. */
async function publisherSigns(w: Awaited<ReturnType<typeof world>>): Promise<number> {
  const written = await insertSignature(w.db, w.scope, w.request());
  return written?.id ?? 0;
}

test('insertSignerPii stores the name, the address and the login of the signature of the person', async () => {
  const w = await world();
  const signatureId = await publisherSigns(w);
  await insertSignerPii(w.db, w.scope, {
    signatureId,
    userId: w.t1.publisherId,
    name: 'Ada Lovelace',
    email: 'Ada@Example.org',
    login: 'ada',
  });
  const row = await w.db
    .selectFrom('signer_pii')
    .selectAll()
    .where('signature_id', '=', signatureId)
    .executeTakeFirstOrThrow();
  expect(row).toMatchObject({
    user_id: w.t1.publisherId,
    name: 'Ada Lovelace',
    email: 'Ada@Example.org',
    login: 'ada',
  });
});

test.each([
  [
    'the signature of another tenant',
    (w: Awaited<ReturnType<typeof world>>) => ({ signatureId: w.t2.signatureId, userId: w.t2.signer.userId }),
  ],
  ['the signature of another person', (w: Awaited<ReturnType<typeof world>>) => ({ userId: w.t2.admin.userId })],
  ['a signature that does not exist', () => ({ signatureId: 987_654 })],
])('insertSignerPii refuses %s with NoResultError and writes nothing', async (_label, change) => {
  const w = await world();
  const signatureId = await publisherSigns(w);
  const before = await w.db.selectFrom('signer_pii').select('signature_id').execute();
  const input = {
    signatureId,
    userId: w.t1.publisherId,
    name: 'Eve',
    email: 'eve@example.org',
    login: 'eve',
    ...change(w),
  };
  await expect(insertSignerPii(w.db, w.scope, input)).rejects.toBeInstanceOf(NoResultError);
  expect(await w.db.selectFrom('signer_pii').select('signature_id').execute()).toEqual(before);
});

test('insertSignerPii does not overwrite the personal data a signature has: a second row for it is refused', async () => {
  const w = await world();
  const signatureId = await publisherSigns(w);
  const input = { signatureId, userId: w.t1.publisherId, name: 'Ada', email: 'ada@example.org', login: 'ada' };
  await insertSignerPii(w.db, w.scope, input);
  await expect(insertSignerPii(w.db, w.scope, { ...input, name: 'Eve' })).rejects.toMatchObject({ code: '23505' });
  expect(
    (
      await w.db
        .selectFrom('signer_pii')
        .select('name')
        .where('signature_id', '=', signatureId)
        .executeTakeFirstOrThrow()
    ).name,
  ).toBe('Ada');
});

test('findLiveSignature answers the signature of the person with the id and numbers of the version it was made under', async () => {
  const { db, t1, scope } = await world();
  const minor = await publishVersion(db, t1.documentId, t1.publisherId, { major: 1, minor: 4, text: 'Terms 1.4' });
  const row = await db
    .insertInto('signatures')
    .values({
      installation_id: t1.installationId,
      user_id: t1.publisherId,
      document_id: t1.documentId,
      version_id: minor.id,
      major: 1,
      content_sha256: sha256('Terms 1.4'),
      consent_text_id: 'individual-v1',
      signer_type: 'individual',
    })
    .returning(['id', 'signed_at'])
    .executeTakeFirstOrThrow();
  expect(await findLiveSignature(db, scope, { userId: t1.publisherId, documentId: t1.documentId, major: 1 })).toEqual({
    id: row.id,
    versionId: minor.id,
    major: 1,
    minor: 4,
    signedAt: row.signed_at,
  });
});

type Asked = readonly [userId: number, documentId: number, major: number];

test.each([
  [
    'a person who has not signed',
    (w: Awaited<ReturnType<typeof world>>): Asked => [w.t1.publisherId, w.t1.documentId, 1],
  ],
  ['another major version', (w: Awaited<ReturnType<typeof world>>): Asked => [w.t1.signer.userId, w.t1.documentId, 2]],
  [
    'the document of another tenant',
    (w: Awaited<ReturnType<typeof world>>): Asked => [w.t2.signer.userId, w.t2.documentId, 1],
  ],
])('findLiveSignature throws NoResultError for %s', async (_label, asked) => {
  const w = await world();
  const [userId, documentId, major] = asked(w);
  await expect(findLiveSignature(w.db, w.scope, { userId, documentId, major })).rejects.toBeInstanceOf(NoResultError);
});

test('findLiveSignature does not answer a revoked signature', async () => {
  const w = await world();
  await w.db
    .updateTable('signatures')
    .set({ revoked_at: new Date(Date.now() + 1000), revoked_by: w.t1.publisherId, revoke_reason: 'signer_request' })
    .where('id', '=', w.t1.signatureId)
    .execute();
  await expect(
    findLiveSignature(w.db, w.scope, { userId: w.t1.signer.userId, documentId: w.t1.documentId, major: 1 }),
  ).rejects.toBeInstanceOf(NoResultError);
});
