// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { publishCorporateDocument } from './corporate-fixture/test-support.ts';
import { containing, migratedTestDatabase, seedTenant } from './test-support.ts';

// Migration 020 (E21-S01), repositories.corporate_document_id: null means individual signatures only; a value is a corporate
// document of the same installation.

const CHECK = { code: '23514' };
const FOREIGN_KEY = { code: '23503' };

async function world() {
  const { db } = await migratedTestDatabase();
  const one = await seedTenant(db, 1);
  const two = await seedTenant(db, 2);
  const corporateOne = await publishCorporateDocument(db, one);
  const corporateTwo = await publishCorporateDocument(db, two);
  const setDocument = (repositoryId: number, documentId: number | null) =>
    db.updateTable('repositories').set({ corporate_document_id: documentId }).where('id', '=', repositoryId).execute();
  const read = (repositoryId: number) =>
    db
      .selectFrom('repositories')
      .select(['corporate_document_id', 'cla_document_id'])
      .where('id', '=', repositoryId)
      .executeTakeFirstOrThrow();
  return { db, one, two, corporateOne, corporateTwo, setDocument, read };
}

test('a repository has no corporate document until one is set, and a repository that existed before is in that state', async () => {
  const { read, one } = await world();
  expect(await read(one.repositoryId)).toEqual({ corporate_document_id: null, cla_document_id: null });
});

test('a corporate document of the same installation can be set, replaced by nothing, and set again', async () => {
  const { read, setDocument, one, corporateOne } = await world();
  await setDocument(one.repositoryId, corporateOne.documentId);
  expect(await read(one.repositoryId)).toEqual({
    corporate_document_id: corporateOne.documentId,
    cla_document_id: null,
  });
  await setDocument(one.repositoryId, null);
  expect((await read(one.repositoryId)).corporate_document_id).toBeNull();
  await setDocument(one.repositoryId, corporateOne.documentId);
  expect((await read(one.repositoryId)).corporate_document_id).toBe(corporateOne.documentId);
});

test('the document must be a corporate one: an individual document is refused, and the repository keeps what it had', async () => {
  const { read, setDocument, one, corporateOne } = await world();
  await setDocument(one.repositoryId, corporateOne.documentId);
  await expect(setDocument(one.repositoryId, one.documentId)).rejects.toMatchObject({
    ...CHECK,
    message: containing('must point at a document of kind corporate'),
  });
  expect((await read(one.repositoryId)).corporate_document_id).toBe(corporateOne.documentId);
});

test('a document of another installation is refused by the composite foreign key, whatever its kind', async () => {
  const { read, setDocument, one, two, corporateTwo } = await world();
  await expect(setDocument(one.repositoryId, corporateTwo.documentId)).rejects.toMatchObject(FOREIGN_KEY);
  await expect(setDocument(one.repositoryId, two.documentId)).rejects.toMatchObject(CHECK);
  expect((await read(one.repositoryId)).corporate_document_id).toBeNull();
});

test('a document that does not exist is refused by the foreign key', async () => {
  const { setDocument, one } = await world();
  await expect(setDocument(one.repositoryId, 987_654)).rejects.toMatchObject(FOREIGN_KEY);
});

test('a repository can be inserted with a corporate document, and not with a document of another kind or tenant', async () => {
  const { db, one, corporateOne, corporateTwo } = await world();
  const insert = (githubRepoId: number, documentId: number) =>
    db
      .insertInto('repositories')
      .values({
        installation_id: one.installationId,
        github_repo_id: githubRepoId,
        full_name: `org-1/other-${githubRepoId}`,
        corporate_document_id: documentId,
      })
      .execute();
  await insert(1, corporateOne.documentId);
  await expect(insert(2, one.documentId)).rejects.toMatchObject(CHECK);
  await expect(insert(3, corporateTwo.documentId)).rejects.toMatchObject(FOREIGN_KEY);
  const stored = await db
    .selectFrom('repositories')
    .select('full_name')
    .where('corporate_document_id', 'is not', null)
    .execute();
  expect(stored).toEqual([{ full_name: 'org-1/other-1' }]);
});

test('the trigger runs when the corporate document is written and not when another column is, and the kind of a document never changes', async () => {
  const { db, one, corporateOne, setDocument } = await world();
  await setDocument(one.repositoryId, corporateOne.documentId);
  await db.updateTable('repositories').set({ full_name: 'org-1/renamed' }).where('id', '=', one.repositoryId).execute();
  const triggers = await sql<{ definition: string }>`
    select pg_get_triggerdef(oid) as definition from pg_trigger
    where tgrelid = 'repositories'::regclass and tgname = 'repositories_guard_corporate_document'`.execute(db);
  expect(triggers.rows).toHaveLength(1);
  expect(triggers.rows[0]?.definition).toMatch(
    /BEFORE INSERT OR UPDATE OF corporate_document_id ON .*repositories FOR EACH ROW/u,
  );
  await expect(
    db.updateTable('cla_documents').set({ kind: 'individual' }).where('id', '=', corporateOne.documentId).execute(),
  ).rejects.toMatchObject({ code: '23001' });
});

test('the corporate document does not take the place of the individual one', async () => {
  const { db, one, corporateOne, setDocument } = await world();
  await db
    .updateTable('repositories')
    .set({ cla_document_id: one.documentId })
    .where('id', '=', one.repositoryId)
    .execute();
  await setDocument(one.repositoryId, corporateOne.documentId);
  expect(
    await db
      .selectFrom('repositories')
      .select(['cla_document_id', 'corporate_document_id'])
      .where('id', '=', one.repositoryId)
      .execute(),
  ).toEqual([{ cla_document_id: one.documentId, corporate_document_id: corporateOne.documentId }]);
});
