// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { documentDetailResponseSchema } from '../../../shared/cla.ts';
import {
  documentsPath,
  documentWorld,
  errorCodeOf,
  parsed,
  withoutRequestId,
} from './document-fixture/test-support.ts';

// GET /api/installations/:installationId/documents/:documentId (E12-S01).

test('the document comes back with its active version, the hash of the text and no draft; the text itself is not part of it', async () => {
  const world = await documentWorld();
  const response = await world.ask('admin1', {
    method: 'GET',
    url: `${documentsPath(world.t1.installationId)}/${world.t1.documentId}`,
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const { document } = parsed(response, documentDetailResponseSchema);
  expect(document).toEqual({
    id: world.t1.documentId,
    name: 'Individual CLA',
    kind: 'individual',
    scope: 'installation',
    repositoryId: null,
    activeVersion: {
      id: world.t1.versionId,
      major: 1,
      minor: 0,
      contentSha256: world.t1.contentSha256,
      publishedAt: document.activeVersion?.publishedAt,
    },
    hasDraft: false,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  });
  expect(Object.keys(response.json<Record<string, Record<string, unknown>>>()['document'] ?? {})).not.toContain(
    'contentMd',
  );
});

test('a document without a version has no active version; the admin of its repository reads it, and the org admin too', async () => {
  const world = await documentWorld();
  const url = `${documentsPath(world.t1.installationId)}/${world.t1.scoped.documentId}`;
  const asRepoAdmin = await world.ask('repoAdmin1', { method: 'GET', url });
  const asOrgAdmin = await world.ask('admin1', { method: 'GET', url });
  expect([asRepoAdmin.statusCode, asOrgAdmin.statusCode]).toEqual([200, 200]);
  expect(parsed(asRepoAdmin, documentDetailResponseSchema).document).toMatchObject({
    id: world.t1.scoped.documentId,
    scope: 'repository',
    repositoryId: world.t1.scoped.repositoryId,
    activeVersion: null,
    hasDraft: false,
  });
});

test('a repo admin cannot read a document that covers the installation: 403', async () => {
  const world = await documentWorld();
  const response = await world.ask('repoAdmin1', {
    method: 'GET',
    url: `${documentsPath(world.t1.installationId)}/${world.t1.documentId}`,
  });
  expect([response.statusCode, errorCodeOf(response)]).toEqual([403, 'forbidden']);
});

test("a document is looked up by id and installation: tenant 2's id under tenant 1's path is the 404 of an unknown id", async () => {
  const world = await documentWorld();
  const read = (documentId: number) =>
    world.ask('admin1', { method: 'GET', url: `${documentsPath(world.t1.installationId)}/${documentId}` });
  const foreign = await read(world.t2.documentId);
  const unknown = await read(987_654);
  expect([foreign.statusCode, errorCodeOf(foreign)]).toEqual([404, 'not_found']);
  expect(withoutRequestId(foreign)).toBe(withoutRequestId(unknown));
});

test('the document of a removed repository is read by an org admin only', async () => {
  const world = await documentWorld();
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-06-01T00:00:00Z') })
    .where('id', '=', world.t1.scoped.repositoryId)
    .execute();
  const url = `${documentsPath(world.t1.installationId)}/${world.t1.scoped.documentId}`;
  const asOrgAdmin = await world.ask('admin1', { method: 'GET', url });
  const asRepoAdmin = await world.ask('repoAdmin1', { method: 'GET', url });
  expect([asOrgAdmin.statusCode, asRepoAdmin.statusCode]).toEqual([200, 404]);
});

test('a document id that is not plain digits is 400 bad_request', async () => {
  const world = await documentWorld();
  for (const id of ['0', '01', '-1', '1.5', 'abc', '1e3']) {
    const response = await world.ask('admin1', {
      method: 'GET',
      url: `${documentsPath(world.t1.installationId)}/${id}`,
    });
    expect([response.statusCode, errorCodeOf(response)], id).toEqual([400, 'bad_request']);
  }
});
