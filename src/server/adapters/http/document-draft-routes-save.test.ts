// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { draftResponseSchema, savedDraftResponseSchema } from '../../../shared/cla.ts';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { draftTextOf } from '../db/tenant-fixture/test-support.ts';
import {
  auditRows,
  type DocumentWorld,
  documentWorld,
  errorCodeOf,
  parsed,
  readDraftAs,
  saveDraftAs,
} from './document-fixture/test-support.ts';

// PUT /api/installations/:installationId/documents/:documentId/draft (E12-S03): the sequential cases, on PGlite. The two
// simultaneous saves are in document-draft-race.test.ts, which needs a real server.

const wide = (world: DocumentWorld) => ({ installationId: world.t1.installationId, documentId: world.t1.documentId });
const scoped = (world: DocumentWorld) => ({
  installationId: world.t1.installationId,
  documentId: world.t1.scoped.documentId,
});

test('the first save of a document creates the draft: 200, revision 1, the time, no text in the answer, and it is not cached', async () => {
  const world = await documentWorld();
  const response = await saveDraftAs(world, 'admin1', wide(world), { contentMd: 'Terms\n', expectedRevision: null });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const { draft } = parsed(response, savedDraftResponseSchema);
  const stored = await world.db
    .selectFrom('cla_drafts')
    .selectAll()
    .where('document_id', '=', world.t1.documentId)
    .executeTakeFirstOrThrow();
  expect(draft).toEqual({ revision: 1, updatedAt: stored.updated_at.toISOString() });
  expect(Object.keys(response.json<Record<string, Record<string, unknown>>>()['draft'] ?? {})).not.toContain(
    'contentMd',
  );
  expect(stored).toMatchObject({
    installation_id: world.t1.installationId,
    content_md: 'Terms\n',
    updated_by: world.people.admin1.userId,
  });
});

test('a save that names the revision it read replaces the text and raises the revision by one, each time', async () => {
  const world = await documentWorld();
  const target = wide(world);
  const revisions: number[] = [];
  let expected: number | null = null;
  for (const text of ['One\n', 'Two\n', 'Three\n']) {
    const response = await saveDraftAs(world, 'admin1', target, { contentMd: text, expectedRevision: expected });
    expect(response.statusCode).toBe(200);
    expected = parsed(response, savedDraftResponseSchema).draft.revision;
    revisions.push(expected);
  }
  expect(revisions).toEqual([1, 2, 3]);
  const read = await readDraftAs(world, 'admin1', target.installationId, target.documentId);
  expect(parsed(read, draftResponseSchema).draft).toMatchObject({ contentMd: 'Three\n', revision: 3 });
});

test('the text is stored canonical: a byte order mark goes, CRLF and CR become LF, one final LF stays', async () => {
  const world = await documentWorld();
  await saveDraftAs(world, 'admin1', wide(world), { contentMd: '﻿a\r\nb\rc\n\n\n', expectedRevision: null });
  const stored = await world.db
    .selectFrom('cla_drafts')
    .select('content_md')
    .where('document_id', '=', world.t1.documentId)
    .executeTakeFirstOrThrow();
  expect(stored.content_md).toBe('a\nb\nc\n');
});

test('the draft is shared by the admins of its scope: the admin of the repository saves over the org admin, and the last saver is recorded', async () => {
  const world = await documentWorld();
  const target = scoped(world);
  const first = await saveDraftAs(world, 'admin1', target, { contentMd: 'By the org admin\n', expectedRevision: 1 });
  const second = await saveDraftAs(world, 'repoAdmin1', target, {
    contentMd: 'By the repo admin\n',
    expectedRevision: 2,
  });
  expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
  const stored = await world.db
    .selectFrom('cla_drafts')
    .select(['content_md', 'revision', 'updated_by'])
    .where('document_id', '=', target.documentId)
    .executeTakeFirstOrThrow();
  expect(stored).toEqual({
    content_md: 'By the repo admin\n',
    revision: 3,
    updated_by: world.people.repoAdmin1.userId,
  });
});

test('a repo admin cannot save the draft of a document that covers the installation: 403, and nothing is stored', async () => {
  const world = await documentWorld();
  const response = await saveDraftAs(world, 'repoAdmin1', wide(world), {
    contentMd: 'Not mine\n',
    expectedRevision: null,
  });
  expect([response.statusCode, errorCodeOf(response)]).toEqual([403, 'forbidden']);
  expect(await world.db.selectFrom('cla_drafts').select('document_id').execute()).toHaveLength(2);
  expect(await auditRows(world, 'cla_draft.saved')).toEqual([]);
});

test('a save that read an older revision is 409 draft_conflict with the current revision, and the draft and the audit log are as they were', async () => {
  const world = await documentWorld();
  const target = scoped(world);
  await saveDraftAs(world, 'admin1', target, { contentMd: 'Newer\n', expectedRevision: 1 });
  const before = await world.db.selectFrom('cla_drafts').selectAll().orderBy('document_id').execute();
  const response = await saveDraftAs(world, 'repoAdmin1', target, { contentMd: 'Stale\n', expectedRevision: 1 });
  expect(response.statusCode).toBe(409);
  expect(parsed(response, errorResponseSchema).error).toMatchObject({
    code: 'draft_conflict',
    details: { currentRevision: 2 },
  });
  expect(await world.db.selectFrom('cla_drafts').selectAll().orderBy('document_id').execute()).toEqual(before);
  expect(await auditRows(world, 'cla_draft.saved')).toHaveLength(1);
});

test.each([
  ['a creation when a draft exists', 'scoped', null, 1],
  ['a revision when no draft exists', 'wide', 4, null],
] as const)('%s is 409 draft_conflict and names the current revision', async (_label, which, expected, current) => {
  const world = await documentWorld();
  const response = await saveDraftAs(world, 'admin1', which === 'wide' ? wide(world) : scoped(world), {
    contentMd: 'Late\n',
    expectedRevision: expected,
  });
  expect(response.statusCode).toBe(409);
  expect(parsed(response, errorResponseSchema).error).toMatchObject({
    code: 'draft_conflict',
    details: { currentRevision: current },
  });
});

test('two saves in a row with the same revision: the first is 200 and the second 409, whoever sends them', async () => {
  const world = await documentWorld();
  const target = scoped(world);
  const statuses = [
    (await saveDraftAs(world, 'admin1', target, { contentMd: 'First\n', expectedRevision: 1 })).statusCode,
    (await saveDraftAs(world, 'repoAdmin1', target, { contentMd: 'Second\n', expectedRevision: 1 })).statusCode,
  ];
  expect(statuses).toEqual([200, 409]);
  const read = await readDraftAs(world, 'admin1', target.installationId, target.documentId);
  expect(parsed(read, draftResponseSchema).draft?.contentMd).toBe('First\n');
});

test('each save appends cla_draft.saved with the document and the new revision, the actor and no text; a refused save appends none', async () => {
  const world = await documentWorld();
  const target = wide(world);
  await saveDraftAs(world, 'admin1', target, { contentMd: 'Hidden wording\n', expectedRevision: null });
  await saveDraftAs(world, 'admin1', target, { contentMd: 'More hidden wording\n', expectedRevision: 1 });
  await saveDraftAs(world, 'admin1', target, { contentMd: 'Refused\n', expectedRevision: 1 });
  await saveDraftAs(world, 'admin1', target, { contentMd: '', expectedRevision: 2 });
  const audit = await auditRows(world, 'cla_draft.saved');
  expect(audit.map((row) => row.metadata)).toEqual([
    { document_id: target.documentId, revision: 1 },
    { document_id: target.documentId, revision: 2 },
  ]);
  expect(audit[0]).toMatchObject({
    installation_id: world.t1.installationId,
    actor_github_id: world.people.admin1.githubId,
    subject_type: 'cla_document',
    subject_id: target.documentId,
  });
  expect(JSON.stringify(audit)).not.toContain('wording');
});

test.each([
  ['an empty text', '', 'content_empty'],
  ['a text of white space', ' \n \t\n', 'content_empty'],
  ['a NUL', 'a\u0000b\n', 'content_invalid_characters'],
  ['a lone surrogate', 'a\uDC00b\n', 'content_invalid_characters'],
  ['a text of 204 801 bytes', `${'a'.repeat(204_800)}\n`, 'content_too_large'],
] as const)('%s is 422 with its own code, and the answer repeats none of the text', async (_label, text, code) => {
  const world = await documentWorld();
  const response = await saveDraftAs(world, 'admin1', wide(world), { contentMd: text, expectedRevision: null });
  expect([response.statusCode, errorCodeOf(response)]).toEqual([422, code]);
  expect(response.body).not.toContain('aaaa');
  expect(await world.db.selectFrom('cla_drafts').select('document_id').execute()).toHaveLength(2);
});

test('the largest text, 204 800 bytes whose every character JSON escapes, is saved', async () => {
  const world = await documentWorld();
  const text = `${'"'.repeat(204_799)}\n`;
  const response = await saveDraftAs(world, 'admin1', wide(world), { contentMd: text, expectedRevision: null });
  expect(response.statusCode).toBe(200);
  const read = await readDraftAs(world, 'admin1', world.t1.installationId, world.t1.documentId);
  expect(parsed(read, draftResponseSchema).draft?.contentMd).toBe(text);
});

test.each([
  ['no expectedRevision', { contentMd: 'a\n' }],
  ['no contentMd', { expectedRevision: null }],
  ['an unknown key', { contentMd: 'a\n', expectedRevision: null, rationale: 'x' }],
  ['a revision of zero', { contentMd: 'a\n', expectedRevision: 0 }],
  ['a revision as text', { contentMd: 'a\n', expectedRevision: '1' }],
  ['a revision beyond the column', { contentMd: 'a\n', expectedRevision: 2_147_483_648 }],
  ['a text that is not a string', { contentMd: ['a'], expectedRevision: null }],
])('a body with %s is 400 bad_request and nothing is stored', async (_label, payload) => {
  const world = await documentWorld();
  const response = await saveDraftAs(world, 'admin1', wide(world), payload);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
  expect(await world.db.selectFrom('cla_drafts').select('document_id').execute()).toHaveLength(2);
});

test("tenant 2's admin, a member, an outsider and nobody are refused before the body is read, and nothing is stored", async () => {
  const world = await documentWorld();
  const before = await world.db.selectFrom('cla_drafts').selectAll().orderBy('document_id').execute();
  const statuses: number[] = [];
  for (const who of ['admin2', 'member1', 'outsider', null] as const) {
    // A body that would be a 400 or a 422: the guard answers first, so the person learns nothing about how it is read.
    const response = await saveDraftAs(world, who, scoped(world), { contentMd: '', unknown: true });
    statuses.push(response.statusCode);
  }
  expect(statuses).toEqual([404, 404, 404, 401]);
  expect(await world.db.selectFrom('cla_drafts').selectAll().orderBy('document_id').execute()).toEqual(before);
});

test("tenant 2's document under tenant 1's path is a 404, and tenant 2's draft keeps its text", async () => {
  const world = await documentWorld();
  const response = await saveDraftAs(
    world,
    'admin1',
    { installationId: world.t1.installationId, documentId: world.t2.scoped.documentId },
    { contentMd: 'Overwritten\n', expectedRevision: 1 },
  );
  expect([response.statusCode, errorCodeOf(response)]).toEqual([404, 'not_found']);
  const stored = await world.db
    .selectFrom('cla_drafts')
    .select(['content_md', 'revision'])
    .where('document_id', '=', world.t2.scoped.documentId)
    .executeTakeFirstOrThrow();
  expect(stored).toEqual({ content_md: draftTextOf(2), revision: 1 });
});

test('a save never changes the active version, the name or the time of its document', async () => {
  const world = await documentWorld();
  const read = () =>
    world.db
      .selectFrom('cla_documents')
      .selectAll()
      .where('installation_id', '=', world.t1.installationId)
      .orderBy('id')
      .execute();
  const before = await read();
  await saveDraftAs(world, 'admin1', wide(world), { contentMd: 'Draft\n', expectedRevision: null });
  await saveDraftAs(world, 'admin1', scoped(world), { contentMd: 'Draft\n', expectedRevision: 1 });
  expect(await read()).toEqual(before);
});
