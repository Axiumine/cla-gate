// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { CLA_TEXT_MAX_BYTES } from '../../shared/cla-text.ts';
import { draftTextOf, tenantChecksums, twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { readDocument } from './cla-documents.ts';
import { findDraftedDocumentIds } from './cla-draft-queries.ts';
import { discardDraft, readDraft, saveDraft } from './cla-drafts.ts';
import { ClaRuleError } from './cla-rule-error.ts';

// The draft of a CLA text (E12-S03), below the routes: the same outcomes, reached without a request. The statements are in
// cla-draft-queries.ts and cla-draft-writes.ts and are held to the tenant by the generated matrix of E11-S06.

async function world() {
  const { db } = await migratedTestDatabase();
  const seeded = await twoTenants(db);
  const scope = { installationId: seeded.t1.installationId };
  const admin = { id: seeded.people.admin1.userId, githubId: seeded.people.admin1.githubId };
  const other = { id: seeded.people.repoAdmin1.userId, githubId: seeded.people.repoAdmin1.githubId };
  // The wide document of tenant 1 has no draft; the scoped one has the draft of the fixture.
  return { db, ...seeded, scope, admin, other, wide: seeded.t1.documentId, scoped: seeded.t1.scoped.documentId };
}

/** What a call broke: the rule and its details, or `null` when it broke none. */
async function brokenBy(attempt: Promise<unknown>): Promise<{ rule: string; details: unknown } | null> {
  try {
    await attempt;
    return null;
  } catch (error) {
    if (error instanceof ClaRuleError) {
      return { rule: error.rule, details: error.details };
    }
    throw error;
  }
}

/** Makes every insert into the audit log fail, so that what is saved with an audit row can be shown to be saved with it or not at all. */
async function refuseAudit(db: Awaited<ReturnType<typeof world>>['db']): Promise<void> {
  await sql`create function fail_audit() returns trigger language plpgsql as $$ begin raise exception 'audit refused'; end $$`.execute(
    db,
  );
  await sql`create trigger fail_audit before insert on audit_log for each row execute function fail_audit()`.execute(
    db,
  );
}

test('the first save creates the draft at revision 1 with the canonical text, and appends one audit row with the ids and no text', async () => {
  const { db, scope, admin, wide, t1 } = await world();
  const saved = await saveDraft(db, scope, admin, {
    documentId: wide,
    contentMd: '﻿Terms\r\nof the project\r\n\r\n\r\n',
    expectedRevision: null,
  });
  expect(saved.revision).toBe(1);
  expect(await readDraft(db, scope, wide)).toEqual({
    contentMd: 'Terms\nof the project\n',
    revision: 1,
    updatedAt: saved.updatedAt,
  });
  const audit = await db.selectFrom('audit_log').selectAll().where('action', '=', 'cla_draft.saved').execute();
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    installation_id: t1.installationId,
    actor_github_id: admin.githubId,
    subject_type: 'cla_document',
    subject_id: wide,
    metadata: { document_id: wide, revision: 1 },
  });
  expect(JSON.stringify(audit)).not.toContain('Terms');
});

test('a save that names the revision it read replaces the text, raises the revision by one and records who saved', async () => {
  const { db, scope, admin, other, wide } = await world();
  await saveDraft(db, scope, admin, { documentId: wide, contentMd: 'One\n', expectedRevision: null });
  const second = await saveDraft(db, scope, other, { documentId: wide, contentMd: 'Two\n', expectedRevision: 1 });
  expect(second.revision).toBe(2);
  const stored = await db
    .selectFrom('cla_drafts')
    .select(['content_md', 'revision', 'updated_by'])
    .where('document_id', '=', wide)
    .executeTakeFirstOrThrow();
  expect(stored).toEqual({ content_md: 'Two\n', revision: 2, updated_by: other.id });
  const audit = await db
    .selectFrom('audit_log')
    .select('metadata')
    .where('action', '=', 'cla_draft.saved')
    .orderBy('id')
    .execute();
  expect(audit.map((row) => row.metadata)).toEqual([
    { document_id: wide, revision: 1 },
    { document_id: wide, revision: 2 },
  ]);
});

test('a save with the same revision twice in a row has one winner: the second is a draft_conflict that names the current revision', async () => {
  const { db, scope, admin, other, wide } = await world();
  await saveDraft(db, scope, admin, { documentId: wide, contentMd: 'One\n', expectedRevision: null });
  const first = await brokenBy(
    saveDraft(db, scope, admin, { documentId: wide, contentMd: 'Mine\n', expectedRevision: 1 }),
  );
  const second = await brokenBy(
    saveDraft(db, scope, other, { documentId: wide, contentMd: 'Theirs\n', expectedRevision: 1 }),
  );
  expect([first, second]).toEqual([null, { rule: 'draft_conflict', details: { currentRevision: 2 } }]);
  expect((await readDraft(db, scope, wide))?.contentMd).toBe('Mine\n');
});

test.each([
  ['a creation when a draft exists', false, null, 1],
  ['a stale revision', false, 7, 1],
  ['a revision when no draft exists', true, 3, null],
] as const)(
  '%s is a draft_conflict with the current revision, and nothing is stored or audited',
  async (_label, onWide, expected, current) => {
    const seeded = await world();
    const { db, scope, admin } = seeded;
    const before = await tenantChecksums(db);
    const outcome = await brokenBy(
      saveDraft(db, scope, admin, {
        documentId: onWide ? seeded.wide : seeded.scoped,
        contentMd: 'Late\n',
        expectedRevision: expected,
      }),
    );
    expect(outcome).toEqual({ rule: 'draft_conflict', details: { currentRevision: current } });
    expect(await tenantChecksums(db)).toEqual(before);
  },
);

test.each([
  ['an empty text', '', 'content_empty'],
  ['white space only', ' \n\t\r\n', 'content_empty'],
  ['a NUL', 'Terms\u0000\n', 'content_invalid_characters'],
  ['a lone surrogate', 'Terms\uD800\n', 'content_invalid_characters'],
  ['a text of 204 801 bytes', `${'Q'.repeat(CLA_TEXT_MAX_BYTES)}\n`, 'content_too_large'],
] as const)(
  '%s is refused with its rule, nothing of the text in the error, and nothing stored',
  async (_label, text, rule) => {
    const { db, scope, admin, wide } = await world();
    const before = await tenantChecksums(db);
    const outcome = await brokenBy(
      saveDraft(db, scope, admin, { documentId: wide, contentMd: text, expectedRevision: null }),
    );
    expect(outcome?.rule).toBe(rule);
    expect(JSON.stringify(outcome)).not.toMatch(/Terms|QQQQ/);
    expect(await tenantChecksums(db)).toEqual(before);
  },
);

test('a text of exactly 204 800 bytes is saved', async () => {
  const { db, scope, admin, wide } = await world();
  const text = `${'a'.repeat(CLA_TEXT_MAX_BYTES - 1)}\n`;
  const saved = await saveDraft(db, scope, admin, { documentId: wide, contentMd: text, expectedRevision: null });
  expect([saved.revision, (await readDraft(db, scope, wide))?.contentMd.length]).toEqual([1, CLA_TEXT_MAX_BYTES]);
});

test("another tenant's document and an unknown one are not_found for a save, and the draft of a foreign document is not read", async () => {
  const { db, scope, admin, t2 } = await world();
  const before = await tenantChecksums(db);
  const outcomes = [
    await brokenBy(
      saveDraft(db, scope, admin, { documentId: t2.scoped.documentId, contentMd: 'x\n', expectedRevision: 1 }),
    ),
    await brokenBy(
      saveDraft(db, scope, admin, { documentId: t2.documentId, contentMd: 'x\n', expectedRevision: null }),
    ),
    await brokenBy(saveDraft(db, scope, admin, { documentId: 987_654, contentMd: 'x\n', expectedRevision: null })),
  ];
  expect(outcomes).toEqual(Array.from({ length: 3 }, () => ({ rule: 'not_found', details: undefined })));
  expect(await readDraft(db, scope, t2.scoped.documentId)).toBeNull();
  expect(await tenantChecksums(db)).toEqual(before);
});

test('a draft never changes its document: the active version, the name and updated_at stay as they were', async () => {
  const { db, scope, admin, wide, t1 } = await world();
  const read = () =>
    db.selectFrom('cla_documents').selectAll().where('installation_id', '=', t1.installationId).orderBy('id').execute();
  const before = await read();
  await saveDraft(db, scope, admin, { documentId: wide, contentMd: 'Draft\n', expectedRevision: null });
  await saveDraft(db, scope, admin, { documentId: wide, contentMd: 'Draft 2\n', expectedRevision: 1 });
  await discardDraft(db, scope, admin.githubId, wide);
  expect(await read()).toEqual(before);
  expect(before.find((row) => row.id === wide)?.active_version_id).toBe(t1.versionId);
});

test('the draft and its audit row are saved together or not at all: when the audit row cannot be written, the draft is not stored', async () => {
  const { db, scope, admin, wide } = await world();
  await refuseAudit(db);
  const before = await tenantChecksums(db);
  await expect(
    saveDraft(db, scope, admin, { documentId: wide, contentMd: 'Lost\n', expectedRevision: null }),
  ).rejects.toThrow('audit refused');
  expect(await tenantChecksums(db)).toEqual(before);
});

test('the discard and its audit row go together too: when the audit row cannot be written, the draft is still there', async () => {
  const { db, scope, admin, scoped } = await world();
  await refuseAudit(db);
  const before = await tenantChecksums(db);
  await expect(discardDraft(db, scope, admin.githubId, scoped)).rejects.toThrow('audit refused');
  expect(await tenantChecksums(db)).toEqual(before);
  expect((await readDraft(db, scope, scoped))?.revision).toBe(1);
});

test('a discard removes the draft and appends cla_draft.discarded with the document and the revision that was discarded', async () => {
  const { db, scope, admin, scoped, t1 } = await world();
  await discardDraft(db, scope, admin.githubId, scoped);
  expect(await readDraft(db, scope, scoped)).toBeNull();
  const audit = await db.selectFrom('audit_log').selectAll().where('action', '=', 'cla_draft.discarded').execute();
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    installation_id: t1.installationId,
    actor_github_id: admin.githubId,
    subject_type: 'cla_document',
    subject_id: scoped,
    metadata: { document_id: scoped, revision: 1 },
  });
  expect(JSON.stringify(audit)).not.toContain(draftTextOf(1).trim());
});

test('a discard when no draft exists changes nothing and records nothing, however often it is repeated', async () => {
  const { db, scope, admin, wide, t2 } = await world();
  const before = await tenantChecksums(db);
  await discardDraft(db, scope, admin.githubId, wide);
  await discardDraft(db, scope, admin.githubId, 987_654);
  await discardDraft(db, scope, admin.githubId, t2.scoped.documentId);
  expect(await tenantChecksums(db)).toEqual(before);
});

test('after a discard the next save is a creation again, at revision 1', async () => {
  const { db, scope, admin, scoped } = await world();
  await discardDraft(db, scope, admin.githubId, scoped);
  const saved = await saveDraft(db, scope, admin, { documentId: scoped, contentMd: 'Again\n', expectedRevision: null });
  expect(saved.revision).toBe(1);
});

test('a document is read with hasDraft true when a draft is saved and false when it is not', async () => {
  const { db, scope, wide, scoped } = await world();
  expect(await readDocument(db, scope, scoped)).toMatchObject({ id: scoped, hasDraft: true });
  expect(await readDocument(db, scope, wide)).toMatchObject({ id: wide, hasDraft: false });
});

test("the documents that have a draft are found by id, within the tenant: none for no ids, and not another tenant's documents (E18-S05)", async () => {
  const { db, scope, wide, scoped, t2 } = await world();
  expect(await findDraftedDocumentIds(db, scope, [])).toEqual(new Set());
  expect(await findDraftedDocumentIds(db, scope, [wide, scoped])).toEqual(new Set([scoped]));
  expect(await findDraftedDocumentIds(db, scope, [t2.documentId, t2.scoped.documentId])).toEqual(new Set());
  expect(await findDraftedDocumentIds(db, { installationId: t2.installationId }, [t2.scoped.documentId])).toEqual(
    new Set([t2.scoped.documentId]),
  );
});
