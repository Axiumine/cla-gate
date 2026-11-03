// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { documentDetailResponseSchema, draftResponseSchema } from '../../../shared/cla.ts';
import { draftTextOf } from '../db/tenant-fixture/test-support.ts';
import {
  auditRows,
  discardDraftAs,
  documentsPath,
  documentWorld,
  errorCodeOf,
  parsed,
  readDraftAs,
  saveDraftAs,
  withoutRequestId,
} from './document-fixture/test-support.ts';

// DELETE /api/installations/:installationId/documents/:documentId/draft (E12-S03).

test('the org admin discards a draft: 204 with no body, the draft is gone, hasDraft is false, and one audit row names the document and the revision', async () => {
  const world = await documentWorld();
  const { installationId } = world.t1;
  const documentId = world.t1.scoped.documentId;
  await saveDraftAs(world, 'admin1', { installationId, documentId }, { contentMd: 'Two\n', expectedRevision: 1 });
  const response = await discardDraftAs(world, 'admin1', installationId, documentId);
  expect(response.statusCode).toBe(204);
  expect(response.body).toBe('');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(parsed(await readDraftAs(world, 'admin1', installationId, documentId), draftResponseSchema)).toEqual({
    draft: null,
  });
  const detail = await world.ask('admin1', { method: 'GET', url: `${documentsPath(installationId)}/${documentId}` });
  expect(parsed(detail, documentDetailResponseSchema).document.hasDraft).toBe(false);
  const audit = await auditRows(world, 'cla_draft.discarded');
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    installation_id: installationId,
    actor_github_id: world.people.admin1.githubId,
    subject_type: 'cla_document',
    subject_id: documentId,
    metadata: { document_id: documentId, revision: 2 },
  });
  expect(JSON.stringify(audit)).not.toContain('Two');
});

test('the document says hasDraft while a draft is saved', async () => {
  const world = await documentWorld();
  const url = `${documentsPath(world.t1.installationId)}/${world.t1.scoped.documentId}`;
  const detail = await world.ask('admin1', { method: 'GET', url });
  expect(parsed(detail, documentDetailResponseSchema).document.hasDraft).toBe(true);
});

test('discarding when no draft exists is 204 too, writes no audit row and changes no row, however often it is repeated', async () => {
  const world = await documentWorld();
  const before = await world.db.selectFrom('cla_drafts').selectAll().orderBy('document_id').execute();
  for (let times = 0; times < 3; times++) {
    const response = await discardDraftAs(world, 'admin1', world.t1.installationId, world.t1.documentId);
    expect(response.statusCode).toBe(204);
  }
  expect(await world.db.selectFrom('cla_drafts').selectAll().orderBy('document_id').execute()).toEqual(before);
  expect(await auditRows(world, 'cla_draft.discarded')).toEqual([]);
});

test('a second discard of the same draft is 204 with no second audit row, and the next save is a creation at revision 1', async () => {
  const world = await documentWorld();
  const { installationId } = world.t1;
  const documentId = world.t1.scoped.documentId;
  expect((await discardDraftAs(world, 'admin1', installationId, documentId)).statusCode).toBe(204);
  expect((await discardDraftAs(world, 'admin1', installationId, documentId)).statusCode).toBe(204);
  expect(await auditRows(world, 'cla_draft.discarded')).toHaveLength(1);
  const saved = await saveDraftAs(
    world,
    'admin1',
    { installationId, documentId },
    { contentMd: 'New\n', expectedRevision: null },
  );
  expect([saved.statusCode, saved.json<{ draft: { revision: number } }>().draft.revision]).toEqual([200, 1]);
});

test('the admin of the repository discards the draft of its document, and may not discard the one of a document that covers the installation', async () => {
  const world = await documentWorld();
  const { installationId } = world.t1;
  await saveDraftAs(
    world,
    'admin1',
    { installationId, documentId: world.t1.documentId },
    { contentMd: 'Wide\n', expectedRevision: null },
  );
  const allowed = await discardDraftAs(world, 'repoAdmin1', installationId, world.t1.scoped.documentId);
  const refused = await discardDraftAs(world, 'repoAdmin1', installationId, world.t1.documentId);
  expect([allowed.statusCode, refused.statusCode, errorCodeOf(refused)]).toEqual([204, 403, 'forbidden']);
  const left = await world.db
    .selectFrom('cla_drafts')
    .select('document_id')
    .where('installation_id', '=', installationId)
    .execute();
  expect(left).toEqual([{ document_id: world.t1.documentId }]);
});

test("tenant 2's admin, a member and an outsider get the 404 of an unknown document, nobody gets 401, and the draft stays", async () => {
  const world = await documentWorld();
  const unknown = await discardDraftAs(world, 'admin1', world.t1.installationId, 987_654);
  expect([unknown.statusCode, errorCodeOf(unknown)]).toEqual([404, 'not_found']);
  for (const who of ['admin2', 'member1', 'outsider'] as const) {
    const response = await discardDraftAs(world, who, world.t1.installationId, world.t1.scoped.documentId);
    expect(response.statusCode, who).toBe(404);
    expect(withoutRequestId(response), who).toBe(withoutRequestId(unknown));
  }
  expect((await discardDraftAs(world, null, world.t1.installationId, world.t1.scoped.documentId)).statusCode).toBe(401);
  const stored = await world.db
    .selectFrom('cla_drafts')
    .select('content_md')
    .where('document_id', '=', world.t1.scoped.documentId)
    .executeTakeFirstOrThrow();
  expect(stored.content_md).toBe(draftTextOf(1));
});

test("tenant 2's document under tenant 1's path is a 404 and its draft stays", async () => {
  const world = await documentWorld();
  const response = await discardDraftAs(world, 'admin1', world.t1.installationId, world.t2.scoped.documentId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([404, 'not_found']);
  const kept = await world.db
    .selectFrom('cla_drafts')
    .select('content_md')
    .where('document_id', '=', world.t2.scoped.documentId)
    .executeTakeFirstOrThrow();
  expect(kept.content_md).toBe(draftTextOf(2));
});

test('a discard never changes the active version of the document', async () => {
  const world = await documentWorld();
  await discardDraftAs(world, 'admin1', world.t1.installationId, world.t1.scoped.documentId);
  const wide = await world.db
    .selectFrom('cla_documents')
    .select('active_version_id')
    .where('id', '=', world.t1.documentId)
    .executeTakeFirstOrThrow();
  expect(wide.active_version_id).toBe(world.t1.versionId);
});
