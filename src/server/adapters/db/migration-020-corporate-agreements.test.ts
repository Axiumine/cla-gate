// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import {
  anyDate,
  insertAgreement,
  personWithId,
  publishCorporateDocument,
  signAgreement,
  signCorporate,
  storeAgreementText,
} from './corporate-fixture/test-support.ts';
import type { Database } from './schema.ts';
import { containing, migratedTestDatabase, seedSignature, seedTenant } from './test-support.ts';

// Migration 020 (E21-S01), corporate_agreements and corporate_agreement_pii: the agreement is the consent of the signatory (a
// corporate signature) plus the facts it repeats, and it is insert-only. Its erasable text is a table of its own.

const CHECK = { code: '23514' };
const FOREIGN_KEY = { code: '23503' };
const UNIQUE = { code: '23505' };
const RESTRICT = { code: '23001' };
const SIGNATORY = 501;

/** One tenant with a corporate document and the corporate signature of a signatory, and no agreement yet. */
async function signedOnly() {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db, 1);
  const document = await publishCorporateDocument(db, tenant);
  const signatureId = await signCorporate(db, tenant, document, await personWithId(db, SIGNATORY));
  return { db, tenant, document, signatureId };
}

/** An agreement row from the columns given, so a test can spoil one of them. */
const agreementRow = (db: Kysely<Database>, row: Readonly<Record<string, unknown>>) => {
  const entries = Object.entries(row);
  return sql`
    insert into corporate_agreements (${sql.join(entries.map(([column]) => sql.ref(column)))})
    values (${sql.join(entries.map(([, value]) => sql.val(value)))})`.execute(db);
};

test('an agreement for a corporate signature of the same installation, document and major is stored, and its text next to it', async () => {
  const { db, tenant, document, signatureId } = await signedOnly();
  const agreementId = await insertAgreement(db, tenant, document, signatureId);
  await storeAgreementText(db, agreementId);

  expect(await db.selectFrom('corporate_agreements').selectAll().execute()).toEqual([
    {
      id: agreementId,
      installation_id: tenant.installationId,
      signature_id: signatureId,
      document_id: document.documentId,
      major: 1,
      created_at: anyDate,
    },
  ]);
  expect(await db.selectFrom('corporate_agreement_pii').selectAll().execute()).toEqual([
    { agreement_id: agreementId, company_name: 'Acme Corp', signatory_title: 'Chief Legal Officer' },
  ]);
});

test('an agreement for an individual signature is refused', async () => {
  const { db, tenant, document } = await signedOnly();
  const individual = await seedSignature(db, tenant, 777);
  await expect(insertAgreement(db, tenant, document, individual.signatureId)).rejects.toMatchObject({
    ...CHECK,
    message: containing('the signature is not a corporate one'),
  });
  expect(await db.selectFrom('corporate_agreements').select('id').execute()).toEqual([]);
});

test('an agreement that names another installation than its signature is refused', async () => {
  const { db, document, signatureId } = await signedOnly();
  const other = await seedTenant(db, 2);
  await expect(
    agreementRow(db, {
      installation_id: other.installationId,
      signature_id: signatureId,
      document_id: document.documentId,
      major: 1,
    }),
  ).rejects.toMatchObject({ ...CHECK, message: containing('the installation differs') });
});

test('an agreement that names another document than its signature is refused, even when the document is of the same installation', async () => {
  const { db, tenant, signatureId } = await signedOnly();
  await db
    .insertInto('cla_documents')
    .values({
      installation_id: tenant.installationId,
      repository_id: null,
      name: 'Another corporate CLA',
      kind: 'corporate',
      active_version_id: null,
    })
    .execute();
  const another = await db
    .selectFrom('cla_documents')
    .select('id')
    .where('name', '=', 'Another corporate CLA')
    .executeTakeFirstOrThrow();
  await expect(
    agreementRow(db, {
      installation_id: tenant.installationId,
      signature_id: signatureId,
      document_id: another.id,
      major: 1,
    }),
  ).rejects.toMatchObject({ ...CHECK, message: containing('the document differs') });
});

test('an agreement that names another major than its signature is refused', async () => {
  const { db, tenant, document, signatureId } = await signedOnly();
  await expect(
    agreementRow(db, {
      installation_id: tenant.installationId,
      signature_id: signatureId,
      document_id: document.documentId,
      major: 2,
    }),
  ).rejects.toMatchObject({ ...CHECK, message: containing('the major differs') });
});

test('an agreement for a signature that does not exist is left to the foreign key', async () => {
  const { db, tenant, document } = await signedOnly();
  await expect(
    agreementRow(db, {
      installation_id: tenant.installationId,
      signature_id: 987_654,
      document_id: document.documentId,
      major: 1,
    }),
  ).rejects.toMatchObject(FOREIGN_KEY);
});

test('a signature has at most one agreement', async () => {
  const { db, tenant, document, signatureId } = await signedOnly();
  await insertAgreement(db, tenant, document, signatureId);
  await expect(insertAgreement(db, tenant, document, signatureId)).rejects.toMatchObject(UNIQUE);
});

test('an agreement is insert-only: no column can be updated, and no row deleted or truncated', async () => {
  const { db, tenant, document, signatureId } = await signedOnly();
  await insertAgreement(db, tenant, document, signatureId);
  const refused = containing('corporate_agreements is immutable');
  for (const statement of [
    sql`update corporate_agreements set major = major`,
    sql`update corporate_agreements set created_at = created_at + interval '1 day'`,
    sql`update corporate_agreements set installation_id = installation_id + 1`,
    sql`delete from corporate_agreements`,
    sql`truncate corporate_agreements cascade`,
  ]) {
    await expect(statement.execute(db)).rejects.toMatchObject({ ...RESTRICT, message: refused });
  }
  expect(await db.selectFrom('corporate_agreements').select('id').execute()).toHaveLength(1);
});

test('the text of an agreement is limited to 200 characters of company and 100 of title, and neither may be blank', async () => {
  const { db, tenant, document, signatureId } = await signedOnly();
  const agreementId = await insertAgreement(db, tenant, document, signatureId);
  const text = (companyName: string, signatoryTitle: string) =>
    sql`insert into corporate_agreement_pii (agreement_id, company_name, signatory_title)
        values (${agreementId}, ${companyName}, ${signatoryTitle})`.execute(db);

  await expect(text('x'.repeat(201), 'CTO')).rejects.toMatchObject(CHECK);
  await expect(text('Acme', 'y'.repeat(101))).rejects.toMatchObject(CHECK);
  await expect(text('   ', 'CTO')).rejects.toMatchObject(CHECK);
  await expect(text('Acme', '')).rejects.toMatchObject(CHECK);
  await text('x'.repeat(200), 'y'.repeat(100));
  expect(await db.selectFrom('corporate_agreement_pii').select('agreement_id').execute()).toHaveLength(1);
});

test('the text belongs to one agreement that exists, once', async () => {
  const { db, tenant, document, signatureId } = await signedOnly();
  const agreementId = await insertAgreement(db, tenant, document, signatureId);
  await storeAgreementText(db, agreementId);
  await expect(storeAgreementText(db, agreementId)).rejects.toMatchObject(UNIQUE);
  await expect(storeAgreementText(db, agreementId + 1)).rejects.toMatchObject(FOREIGN_KEY);
});

test('the same person can sign the corporate document of two tenants, each with an agreement of its own', async () => {
  const { db } = await migratedTestDatabase();
  const first = await seedTenant(db, 1);
  const second = await seedTenant(db, 2);
  const person = await personWithId(db, SIGNATORY);
  const here = await signAgreement(db, { tenant: first, document: await publishCorporateDocument(db, first) }, person);
  const there = await signAgreement(
    db,
    { tenant: second, document: await publishCorporateDocument(db, second) },
    person,
  );
  expect(await db.selectFrom('corporate_agreements').select(['id', 'installation_id']).orderBy('id').execute()).toEqual(
    [
      { id: here.agreementId, installation_id: first.installationId },
      { id: there.agreementId, installation_id: second.installationId },
    ],
  );
});
