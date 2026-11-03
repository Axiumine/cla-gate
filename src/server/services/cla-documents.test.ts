// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { tenantChecksums, twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase, rowId } from '../adapters/db/test-support.ts';
import { createDocument, renameDocument } from './cla-document-changes.ts';
import { listDocumentPage, readDocument, readRepositoryDocuments } from './cla-documents.ts';
import { ClaRuleError } from './cla-rule-error.ts';

// The rules of the documents of a tenant (E12-S01), below the routes: the same outcomes, reached without a request. The
// reading is in cla-documents.ts, creating and renaming in cla-document-changes.ts, the error in cla-rule-error.ts.

const ACTOR = parseGithubId(31_001);

async function world() {
  const { db } = await migratedTestDatabase();
  return { db, ...(await twoTenants(db)) };
}

/** The rule a call broke, or `null` when it did not break one. */
async function ruleOf(attempt: Promise<unknown>): Promise<string | null> {
  try {
    await attempt;
    return null;
  } catch (error) {
    if (error instanceof ClaRuleError) {
      return error.rule;
    }
    throw error;
  }
}

test('a rule error names its rule and nothing else', () => {
  const error = new ClaRuleError('document_name_taken');
  expect(error).toBeInstanceOf(Error);
  expect([error.rule, error.message, error.name]).toEqual([
    'document_name_taken',
    'document_name_taken',
    'ClaRuleError',
  ]);
});

test('a document is created with a cleaned name and an audit row in the same transaction, both or neither', async () => {
  const { db, t1 } = await world();
  const scope = { installationId: t1.installationId };
  const document = await createDocument(db, scope, ACTOR, {
    name: '  Our   CLA ',
    kind: 'individual',
    repositoryId: null,
  });
  expect(document).toMatchObject({ name: 'Our CLA', kind: 'individual', repositoryId: null, activeVersion: null });
  const audit = await db.selectFrom('audit_log').selectAll().where('action', '=', 'cla_document.created').execute();
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    installation_id: t1.installationId,
    actor_github_id: ACTOR,
    subject_type: 'cla_document',
    subject_id: document.id,
    metadata: { document_id: document.id, repository_id: null, kind: 'individual' },
  });
});

test('a failure after the insert rolls the document back: when the audit row cannot be written, no document is left', async () => {
  const { db, t1 } = await world();
  await sql`create function fail_audit() returns trigger language plpgsql as $$ begin raise exception 'audit refused'; end $$`.execute(
    db,
  );
  await sql`create trigger fail_audit before insert on audit_log for each row execute function fail_audit()`.execute(
    db,
  );
  const before = await tenantChecksums(db);
  await expect(
    createDocument(db, { installationId: t1.installationId }, ACTOR, {
      name: 'Lost',
      kind: 'individual',
      repositoryId: null,
    }),
  ).rejects.toThrow('audit refused');
  expect(await tenantChecksums(db)).toEqual(before);
});

test('the corporate kind, a name that is not one and a taken name are each the rule they break, and nothing is stored', async () => {
  const { db, t1 } = await world();
  const scope = { installationId: t1.installationId };
  const before = await tenantChecksums(db);
  const attempts = [
    createDocument(db, scope, ACTOR, { name: 'Corporate', kind: 'corporate', repositoryId: null }),
    createDocument(db, scope, ACTOR, { name: '\n', kind: 'individual', repositoryId: null }),
    createDocument(db, scope, ACTOR, { name: 'Individual CLA', kind: 'individual', repositoryId: null }),
    createDocument(db, scope, ACTOR, { name: 'Elsewhere', kind: 'individual', repositoryId: 987_654 }),
  ];
  expect(await Promise.all(attempts.map(ruleOf))).toEqual([
    'kind_not_supported',
    'invalid_name',
    'document_name_taken',
    'not_found',
  ]);
  expect(await tenantChecksums(db)).toEqual(before);
});

test('an error that is not a rule is thrown as it is: a tenant that does not exist is the foreign key of the database', async () => {
  const { db } = await world();
  await expect(
    createDocument(db, { installationId: rowId(987_654) }, ACTOR, {
      name: 'x',
      kind: 'individual',
      repositoryId: null,
    }),
  ).rejects.toMatchObject({ code: '23503' });
});

test('the 101st document of a tenant is the rule document_limit_reached', async () => {
  const { db, t1 } = await world();
  const scope = { installationId: t1.installationId };
  const rows = Array.from({ length: 97 }, (_unused, index) => ({
    installation_id: t1.installationId,
    repository_id: null,
    name: `Filler ${index}`,
    kind: 'individual' as const,
    active_version_id: null,
  }));
  await db.insertInto('cla_documents').values(rows).execute();
  expect(
    await ruleOf(createDocument(db, scope, ACTOR, { name: 'Last', kind: 'individual', repositoryId: null })),
  ).toBeNull();
  expect(await ruleOf(createDocument(db, scope, ACTOR, { name: 'Over', kind: 'individual', repositoryId: null }))).toBe(
    'document_limit_reached',
  );
});

test('a document is read with its draft flag, false while no draft can exist; an unknown one or another tenant is not_found', async () => {
  const { db, t1, t2 } = await world();
  const scope = { installationId: t1.installationId };
  expect(await readDocument(db, scope, t1.documentId)).toMatchObject({ id: t1.documentId, hasDraft: false });
  expect(await ruleOf(readDocument(db, scope, t2.documentId))).toBe('not_found');
  expect(await ruleOf(readDocument(db, scope, 987_654))).toBe('not_found');
});

test('a page holds the limit and says where the next starts: that is the document after the last of the page', async () => {
  const { db, t1 } = await world();
  const scope = { installationId: t1.installationId };
  const first = await listDocumentPage(db, scope, { limit: 1, from: null });
  expect(first.documents.map((document) => document.name)).toEqual(['Individual CLA']);
  expect(first.next).toEqual({ name: 'Repository CLA', id: t1.scoped.documentId });
  const second = await listDocumentPage(db, scope, { limit: 1, from: first.next });
  expect(second.documents.map((document) => document.name)).toEqual(['Repository CLA']);
  expect(second.next).toBeNull();
  const all = await listDocumentPage(db, scope, { limit: 2, from: null });
  expect(all.next).toBeNull();
});

test('the documents of a repository are read, and a repository that is not the tenant is not_found', async () => {
  const { db, t1, t2 } = await world();
  const scope = { installationId: t1.installationId };
  const shown = await readRepositoryDocuments(db, scope, t1.scoped.repositoryId);
  expect(shown.repositoryScoped.map((document) => document.id)).toEqual([t1.scoped.documentId]);
  expect(shown.installationScoped.map((document) => document.id)).toEqual([t1.documentId]);
  expect(await ruleOf(readRepositoryDocuments(db, scope, t2.scoped.repositoryId))).toBe('not_found');
});

test('a rename audits the id and moves the name; the same name is a no-op with no audit row; a taken name or a bad one is a rule', async () => {
  const { db, t1, t2 } = await world();
  const scope = { installationId: t1.installationId };
  const same = await renameDocument(db, scope, ACTOR, { documentId: t1.documentId, name: ' Individual  CLA ' });
  expect(same.name).toBe('Individual CLA');
  expect(await db.selectFrom('audit_log').select('id').where('action', '=', 'cla_document.renamed').execute()).toEqual(
    [],
  );
  const renamed = await renameDocument(db, scope, ACTOR, { documentId: t1.documentId, name: 'New' });
  expect(renamed).toMatchObject({ id: t1.documentId, name: 'New', hasDraft: false });
  const [audit] = await db.selectFrom('audit_log').selectAll().where('action', '=', 'cla_document.renamed').execute();
  expect(audit).toMatchObject({ subject_id: t1.documentId, metadata: { document_id: t1.documentId } });
  await createDocument(db, scope, ACTOR, { name: 'Other', kind: 'individual', repositoryId: null });
  expect(await ruleOf(renameDocument(db, scope, ACTOR, { documentId: t1.documentId, name: 'Other' }))).toBe(
    'document_name_taken',
  );
  expect(await ruleOf(renameDocument(db, scope, ACTOR, { documentId: t1.documentId, name: '\t' }))).toBe(
    'invalid_name',
  );
  expect(await ruleOf(renameDocument(db, scope, ACTOR, { documentId: t2.documentId, name: 'Foreign' }))).toBe(
    'not_found',
  );
  expect(await ruleOf(renameDocument(db, scope, ACTOR, { documentId: 987_654, name: 'Nobody' }))).toBe('not_found');
});
