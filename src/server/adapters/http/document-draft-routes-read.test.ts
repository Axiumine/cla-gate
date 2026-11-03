// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { draftResponseSchema } from '../../../shared/cla.ts';
import { draftTextOf } from '../db/tenant-fixture/test-support.ts';
import {
  documentWorld,
  errorCodeOf,
  parsed,
  readDraftAs,
  saveDraftAs,
  withoutRequestId,
} from './document-fixture/test-support.ts';

// GET /api/installations/:installationId/documents/:documentId/draft (E12-S03).

test('a document with no draft answers 200 with draft null, and the answer is not cached', async () => {
  const world = await documentWorld();
  const response = await readDraftAs(world, 'admin1', world.t1.installationId, world.t1.documentId);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toEqual({ draft: null });
});

test('a document with a draft answers with its text, its revision and when it was saved', async () => {
  const world = await documentWorld();
  const response = await readDraftAs(world, 'admin1', world.t1.installationId, world.t1.scoped.documentId);
  expect(response.statusCode).toBe(200);
  const { draft } = parsed(response, draftResponseSchema);
  const stored = await world.db
    .selectFrom('cla_drafts')
    .select('updated_at')
    .where('document_id', '=', world.t1.scoped.documentId)
    .executeTakeFirstOrThrow();
  expect(draft).toEqual({ contentMd: draftTextOf(1), revision: 1, updatedAt: stored.updated_at.toISOString() });
});

test('the draft shown is the canonical text of the last save, with its revision', async () => {
  const world = await documentWorld();
  const target = { installationId: world.t1.installationId, documentId: world.t1.documentId };
  await saveDraftAs(world, 'admin1', target, { contentMd: '﻿One\r\n\r\n', expectedRevision: null });
  await saveDraftAs(world, 'admin1', target, { contentMd: 'Two\r\nlines\r\n', expectedRevision: 1 });
  const response = await readDraftAs(world, 'admin1', target.installationId, target.documentId);
  expect(parsed(response, draftResponseSchema).draft).toMatchObject({ contentMd: 'Two\nlines\n', revision: 2 });
});

test('the admin of the repository reads the draft of its document, and so does the org admin; the draft is shared, not copied', async () => {
  const world = await documentWorld();
  const asRepoAdmin = await readDraftAs(world, 'repoAdmin1', world.t1.installationId, world.t1.scoped.documentId);
  const asOrgAdmin = await readDraftAs(world, 'admin1', world.t1.installationId, world.t1.scoped.documentId);
  expect([asRepoAdmin.statusCode, asOrgAdmin.statusCode]).toEqual([200, 200]);
  expect(asRepoAdmin.body).toBe(asOrgAdmin.body);
});

test('a repo admin cannot read the draft of a document that covers the installation: 403', async () => {
  const world = await documentWorld();
  const response = await readDraftAs(world, 'repoAdmin1', world.t1.installationId, world.t1.documentId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([403, 'forbidden']);
});

test("tenant 2's admin, a member and an outsider get the 404 of an unknown document, byte for byte, and read no text", async () => {
  const world = await documentWorld();
  const unknown = await readDraftAs(world, 'admin1', world.t1.installationId, 987_654);
  expect([unknown.statusCode, errorCodeOf(unknown)]).toEqual([404, 'not_found']);
  for (const who of ['admin2', 'member1', 'outsider'] as const) {
    const response = await readDraftAs(world, who, world.t1.installationId, world.t1.scoped.documentId);
    expect(response.statusCode, who).toBe(404);
    expect(withoutRequestId(response), who).toBe(withoutRequestId(unknown));
    expect(response.body, who).not.toContain(draftTextOf(1).trim());
  }
});

test("a document is looked up by id and installation: tenant 2's document under tenant 1's path is a 404, and so is the reverse", async () => {
  const world = await documentWorld();
  const unknown = await readDraftAs(world, 'admin1', world.t1.installationId, 987_654);
  const foreign = await readDraftAs(world, 'admin1', world.t1.installationId, world.t2.scoped.documentId);
  const reverse = await readDraftAs(world, 'admin2', world.t2.installationId, world.t1.scoped.documentId);
  expect([foreign.statusCode, reverse.statusCode]).toEqual([404, 404]);
  expect(withoutRequestId(foreign)).toBe(withoutRequestId(unknown));
  expect(foreign.body).not.toContain(draftTextOf(2).trim());
  expect(reverse.body).not.toContain(draftTextOf(1).trim());
});

test('nobody signed in gets 401, and the text is not in the answer', async () => {
  const world = await documentWorld();
  const response = await readDraftAs(world, null, world.t1.installationId, world.t1.scoped.documentId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([401, 'unauthorized']);
  expect(response.body).not.toContain(draftTextOf(1).trim());
});

test('the draft of the document of a removed repository is read by an org admin only', async () => {
  const world = await documentWorld();
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-06-01T00:00:00Z') })
    .where('id', '=', world.t1.scoped.repositoryId)
    .execute();
  const asOrgAdmin = await readDraftAs(world, 'admin1', world.t1.installationId, world.t1.scoped.documentId);
  const asRepoAdmin = await readDraftAs(world, 'repoAdmin1', world.t1.installationId, world.t1.scoped.documentId);
  expect([asOrgAdmin.statusCode, asRepoAdmin.statusCode]).toEqual([200, 404]);
});

test('a document id that is not plain digits is 400 bad_request', async () => {
  const world = await documentWorld();
  for (const id of ['0', '01', '-1', '1.5', 'abc', '1e3']) {
    const response = await world.ask('admin1', {
      method: 'GET',
      url: `/api/installations/${world.t1.installationId}/documents/${id}/draft`,
    });
    expect([response.statusCode, errorCodeOf(response)], id).toEqual([400, 'bad_request']);
  }
});
