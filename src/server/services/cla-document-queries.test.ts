// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { tenantChecksums, twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { findDocument, listDocuments, listRepositoryDocuments } from './cla-document-queries.ts';
import { countDocuments, insertDocument, updateDocumentName } from './cla-document-writes.ts';

// The statements over the documents of a tenant (E12-S01). The matrix of tenant-queries-matrix.test.ts calls each of them for
// two tenants; here is what each answers.

async function world() {
  const { db } = await migratedTestDatabase();
  return { db, ...(await twoTenants(db)) };
}

test('a document is found with its active version, and a tenant counts its own documents only', async () => {
  const { db, t1, t2 } = await world();
  const document = await findDocument(db, { installationId: t1.installationId }, t1.documentId);
  expect(document).toEqual({
    id: t1.documentId,
    repositoryId: null,
    repositoryFullName: null,
    name: 'Individual CLA',
    kind: 'individual',
    activeVersion: {
      id: t1.versionId,
      major: 1,
      minor: 0,
      contentSha256: t1.contentSha256,
      publishedAt: document?.activeVersion?.publishedAt,
    },
    createdAt: document?.createdAt,
    updatedAt: document?.updatedAt,
  });
  expect(document?.activeVersion?.publishedAt).toBeInstanceOf(Date);
  expect(await countDocuments(db, { installationId: t1.installationId })).toBe(2);
  expect(await countDocuments(db, { installationId: t2.installationId })).toBe(2);
});

test("a document of another tenant, and one that does not exist, are not found with the tenant's scope", async () => {
  const { db, t1, t2 } = await world();
  const scope = { installationId: t1.installationId };
  expect(await findDocument(db, scope, t2.documentId)).toBeNull();
  expect(await findDocument(db, scope, 987_654)).toBeNull();
});

test('a document without a version has no active version, and the version of another document is never joined to it', async () => {
  const { db, t1 } = await world();
  const scoped = await findDocument(db, { installationId: t1.installationId }, t1.scoped.documentId);
  expect(scoped).toMatchObject({ repositoryId: t1.scoped.repositoryId, name: 'Repository CLA', activeVersion: null });
});

test('a new document is stored for the installation or for an active repository of the tenant and read back whole', async () => {
  const { db, t1 } = await world();
  const scope = { installationId: t1.installationId };
  const wide = await insertDocument(db, scope, { name: 'Wide', kind: 'individual', repositoryId: null });
  const narrow = await insertDocument(db, scope, {
    name: 'Narrow',
    kind: 'corporate',
    repositoryId: t1.plain.repositoryId,
  });
  expect(wide).toMatchObject({ name: 'Wide', kind: 'individual', repositoryId: null, activeVersion: null });
  expect(narrow).toMatchObject({ name: 'Narrow', kind: 'corporate', repositoryId: t1.plain.repositoryId });
  expect(await countDocuments(db, scope)).toBe(4);
});

test("a new document for another tenant's repository, an unknown one or a removed one is not stored", async () => {
  const { db, t1, t2 } = await world();
  const scope = { installationId: t1.installationId };
  await db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-06-01T00:00:00Z') })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const before = await tenantChecksums(db);
  for (const repositoryId of [t2.plain.repositoryId, 987_654, t1.plain.repositoryId]) {
    expect(await insertDocument(db, scope, { name: 'No', kind: 'individual', repositoryId })).toBeNull();
  }
  expect(await tenantChecksums(db)).toEqual(before);
});

test('a name used twice in one scope is refused by the unique constraint, and the same name is free in another scope', async () => {
  const { db, t1 } = await world();
  const scope = { installationId: t1.installationId };
  await expect(
    insertDocument(db, scope, { name: 'Individual CLA', kind: 'individual', repositoryId: null }),
  ).rejects.toMatchObject({
    code: '23505',
    constraint: 'cla_documents_installation_id_repository_id_name_key',
  });
  const elsewhere = await insertDocument(db, scope, {
    name: 'Individual CLA',
    kind: 'individual',
    repositoryId: t1.plain.repositoryId,
  });
  expect(elsewhere).not.toBeNull();
});

test('documents are listed by name then id, and a page starts at the position it is given, that document included', async () => {
  const { db, t1 } = await world();
  const scope = { installationId: t1.installationId };
  const a = await insertDocument(db, scope, { name: 'Same', kind: 'individual', repositoryId: null });
  const b = await insertDocument(db, scope, { name: 'Same', kind: 'individual', repositoryId: t1.plain.repositoryId });
  const all = await listDocuments(db, scope, { limit: 100, from: null });
  expect(all.map((document) => document.name)).toEqual(['Individual CLA', 'Repository CLA', 'Same', 'Same']);
  expect([all[2]?.id, all[3]?.id]).toEqual([a?.id, b?.id]);
  const second = await listDocuments(db, scope, { limit: 100, from: { name: 'Same', id: b?.id ?? 0 } });
  expect(second.map((document) => document.id)).toEqual([b?.id]);
  const firstTwo = await listDocuments(db, scope, { limit: 2, from: null });
  expect(firstTwo).toHaveLength(2);
  const none = await listDocuments(db, scope, { limit: 5, from: { name: 'Zzz', id: 1 } });
  expect(none).toEqual([]);
});

test('the list of a tenant holds its documents only', async () => {
  const { db, t1, t2 } = await world();
  const listed = await listDocuments(db, { installationId: t1.installationId }, { limit: 100, from: null });
  expect(listed.map((document) => document.id)).toEqual([t1.documentId, t1.scoped.documentId]);
  expect(listed.map((document) => document.id)).not.toContain(t2.documentId);
});

test('every read names the repository of a scoped document, by the repository of the same tenant, and has none for a document of the installation (E18-S05)', async () => {
  const { db, t1, t2 } = await world();
  const scope = { installationId: t1.installationId };
  const listed = await listDocuments(db, scope, { limit: 100, from: null });
  expect(listed.map((document) => [document.id, document.repositoryFullName])).toEqual([
    [t1.documentId, null],
    [t1.scoped.documentId, t1.scoped.fullName],
  ]);
  expect((await findDocument(db, scope, t1.scoped.documentId))?.repositoryFullName).toBe(t1.scoped.fullName);
  const other = await listDocuments(db, { installationId: t2.installationId }, { limit: 100, from: null });
  expect(other.map((document) => document.repositoryFullName)).toEqual([null, t2.scoped.fullName]);
});

test('the documents of a repository are its own and those of the installation, each in the order of the list', async () => {
  const { db, t1 } = await world();
  const scope = { installationId: t1.installationId };
  const extra = await insertDocument(db, scope, { name: 'Aaa', kind: 'individual', repositoryId: null });
  const shown = await listRepositoryDocuments(db, scope, t1.scoped.repositoryId);
  expect(shown?.repositoryScoped.map((document) => document.id)).toEqual([t1.scoped.documentId]);
  expect(shown?.installationScoped.map((document) => document.id)).toEqual([extra?.id, t1.documentId]);
  const plain = await listRepositoryDocuments(db, scope, t1.plain.repositoryId);
  expect(plain?.repositoryScoped).toEqual([]);
});

test("another tenant's repository, an unknown one and a removed one have no documents to list", async () => {
  const { db, t1, t2 } = await world();
  const scope = { installationId: t1.installationId };
  await db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-06-01T00:00:00Z') })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  for (const repositoryId of [t2.scoped.repositoryId, 987_654, t1.plain.repositoryId]) {
    expect(await listRepositoryDocuments(db, scope, repositoryId)).toBeNull();
  }
});

test("a document is renamed in its tenant, its updated_at moves forward, and another tenant's document is not touched", async () => {
  const { db, t1, t2 } = await world();
  const scope = { installationId: t1.installationId };
  const before = await findDocument(db, scope, t1.scoped.documentId);
  const checksums = await tenantChecksums(db);
  expect(await updateDocumentName(db, scope, t2.documentId, 'Taken over')).toBeNull();
  expect(await updateDocumentName(db, scope, 987_654, 'Nobody')).toBeNull();
  expect(await tenantChecksums(db)).toEqual(checksums);
  const renamed = await updateDocumentName(db, scope, t1.scoped.documentId, 'New name');
  expect(renamed).toMatchObject({ id: t1.scoped.documentId, name: 'New name', kind: 'individual' });
  expect(renamed?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? Number.POSITIVE_INFINITY);
  expect(renamed?.createdAt).toEqual(before?.createdAt);
});

test('a rename to a name the scope already uses is refused by the unique constraint', async () => {
  const { db, t1 } = await world();
  const scope = { installationId: t1.installationId };
  await insertDocument(db, scope, { name: 'Taken', kind: 'individual', repositoryId: null });
  await expect(updateDocumentName(db, scope, t1.documentId, 'Taken')).rejects.toMatchObject({ code: '23505' });
});
