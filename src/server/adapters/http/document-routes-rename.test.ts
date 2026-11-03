// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { documentDetailResponseSchema } from '../../../shared/cla.ts';
import {
  auditRows,
  type DocumentWorld,
  documentsPath,
  documentWorld,
  errorCodeOf,
  fillDocuments,
  HOSTILE_DOCUMENT_NAMES,
  nameOf,
  parsed,
} from './document-fixture/test-support.ts';

// PATCH /api/installations/:installationId/documents/:documentId (E12-S01).

const renameAs = (world: DocumentWorld, who: 'admin1' | 'admin2' | 'repoAdmin1', url: string, payload: object) =>
  world.ask(who, { method: 'PATCH', url, payload });

test('an org admin renames the document: 200, the new name, an updated_at later than before, one audit row with the id only', async () => {
  const world = await documentWorld();
  const url = `${documentsPath(world.t1.installationId)}/${world.t1.documentId}`;
  const before = await world.db
    .selectFrom('cla_documents')
    .select('updated_at')
    .where('id', '=', world.t1.documentId)
    .executeTakeFirstOrThrow();
  const response = await renameAs(world, 'admin1', url, { name: '  Renamed   CLA ' });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const { document } = parsed(response, documentDetailResponseSchema);
  expect(document).toMatchObject({ id: world.t1.documentId, name: 'Renamed CLA', hasDraft: false });
  expect(document.activeVersion?.id).toBe(world.t1.versionId);
  expect(new Date(document.updatedAt).getTime()).toBeGreaterThan(before.updated_at.getTime());
  expect(document.createdAt < document.updatedAt).toBe(true);
  const stored = await world.db
    .selectFrom('cla_documents')
    .select('name')
    .where('id', '=', world.t1.documentId)
    .executeTakeFirstOrThrow();
  expect(stored.name).toBe('Renamed CLA');
  const audit = await auditRows(world, 'cla_document.renamed');
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    installation_id: world.t1.installationId,
    actor_github_id: world.people.admin1.githubId,
    subject_type: 'cla_document',
    subject_id: world.t1.documentId,
    metadata: { document_id: world.t1.documentId },
  });
  expect(JSON.stringify(audit)).not.toContain('Renamed');
});

test('the admin of the repository renames its document; they cannot rename the one that covers the installation', async () => {
  const world = await documentWorld();
  const own = `${documentsPath(world.t1.installationId)}/${world.t1.scoped.documentId}`;
  const wide = `${documentsPath(world.t1.installationId)}/${world.t1.documentId}`;
  const allowed = await renameAs(world, 'repoAdmin1', own, { name: 'Repository terms' });
  const refused = await renameAs(world, 'repoAdmin1', wide, { name: 'Not for you' });
  expect(allowed.statusCode).toBe(200);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([403, 'forbidden']);
  expect(await auditRows(world, 'cla_document.renamed')).toHaveLength(1);
});

test('renaming to the name the document has changes nothing: 200, the same updated_at, no audit row', async () => {
  const world = await documentWorld();
  const url = `${documentsPath(world.t1.installationId)}/${world.t1.documentId}`;
  const before = await world.db
    .selectFrom('cla_documents')
    .select('updated_at')
    .where('id', '=', world.t1.documentId)
    .executeTakeFirstOrThrow();
  const response = await renameAs(world, 'admin1', url, { name: ' Individual   CLA' });
  expect(response.statusCode).toBe(200);
  expect(parsed(response, documentDetailResponseSchema).document.name).toBe('Individual CLA');
  const after = await world.db
    .selectFrom('cla_documents')
    .select('updated_at')
    .where('id', '=', world.t1.documentId)
    .executeTakeFirstOrThrow();
  expect(after.updated_at).toEqual(before.updated_at);
  expect(await auditRows(world, 'cla_document.renamed')).toEqual([]);
});

test('a name used by another document of the scope is 409 document_name_taken; the document and the audit log stay as they were', async () => {
  const world = await documentWorld();
  await fillDocuments(world, world.t1.installationId, 1);
  const wide = `${documentsPath(world.t1.installationId)}/${world.t1.documentId}`;
  const taken = await renameAs(world, 'admin1', wide, { name: nameOf(1) });
  const free = await renameAs(world, 'admin1', wide, { name: 'Free name' });
  const stored = await world.db
    .selectFrom('cla_documents')
    .select('name')
    .where('id', '=', world.t1.documentId)
    .executeTakeFirstOrThrow();
  expect([taken.statusCode, errorCodeOf(taken)]).toEqual([409, 'document_name_taken']);
  expect(free.statusCode).toBe(200);
  expect(stored.name).toBe('Free name');
  expect(await auditRows(world, 'cla_document.renamed')).toHaveLength(1);
});

test('a name another scope uses is free: the repository document and the installation one may share a name, and so may two tenants', async () => {
  const world = await documentWorld();
  await fillDocuments(world, world.t1.installationId, 1);
  const sameAsRepository = await renameAs(
    world,
    'admin1',
    `${documentsPath(world.t1.installationId)}/${world.t1.documentId}`,
    { name: 'Repository CLA' },
  );
  const sameAsOtherTenant = await renameAs(
    world,
    'admin2',
    `${documentsPath(world.t2.installationId)}/${world.t2.documentId}`,
    { name: nameOf(1) },
  );
  expect([sameAsRepository.statusCode, sameAsOtherTenant.statusCode]).toEqual([200, 200]);
});

test('a name that cannot be one is 422 invalid_name, and a body that is not a rename is 400', async () => {
  const world = await documentWorld();
  const url = `${documentsPath(world.t1.installationId)}/${world.t1.documentId}`;
  const invalid = await renameAs(world, 'admin1', url, { name: 'a\nb' });
  const empty = await renameAs(world, 'admin1', url, { name: '   ' });
  const extra = await renameAs(world, 'admin1', url, { name: 'x', kind: 'corporate' });
  const missing = await renameAs(world, 'admin1', url, {});
  expect([invalid, empty, extra, missing].map((response) => response.statusCode)).toEqual([422, 422, 400, 400]);
  expect([errorCodeOf(invalid), errorCodeOf(extra)]).toEqual(['invalid_name', 'bad_request']);
  expect(await auditRows(world, 'cla_document.renamed')).toEqual([]);
});

test('every hostile name is accepted as a new name and comes back as it went in', async () => {
  const world = await documentWorld();
  const url = `${documentsPath(world.t1.installationId)}/${world.t1.documentId}`;
  for (const name of HOSTILE_DOCUMENT_NAMES) {
    const response = await renameAs(world, 'admin1', url, { name });
    expect(response.statusCode, name).toBe(200);
    expect(parsed(response, documentDetailResponseSchema).document.name, name).toBe(name);
  }
});

test("tenant 2's document under tenant 1's path is the 404 of an unknown id, and nothing changes", async () => {
  const world = await documentWorld();
  const before = await world.db
    .selectFrom('cla_documents')
    .select('name')
    .where('id', '=', world.t2.documentId)
    .executeTakeFirstOrThrow();
  const response = await renameAs(world, 'admin1', `${documentsPath(world.t1.installationId)}/${world.t2.documentId}`, {
    name: 'Taken over',
  });
  const after = await world.db
    .selectFrom('cla_documents')
    .select('name')
    .where('id', '=', world.t2.documentId)
    .executeTakeFirstOrThrow();
  expect([response.statusCode, errorCodeOf(response)]).toEqual([404, 'not_found']);
  expect(after).toEqual(before);
});

test('the identity of a document does not change with its name: the kind and the installation stay', async () => {
  const world = await documentWorld();
  await renameAs(world, 'admin1', `${documentsPath(world.t1.installationId)}/${world.t1.documentId}`, {
    name: 'Moved',
  });
  const row = await world.db
    .selectFrom('cla_documents')
    .select(['installation_id', 'kind', 'repository_id', 'active_version_id'])
    .where('id', '=', world.t1.documentId)
    .executeTakeFirstOrThrow();
  expect(row).toEqual({
    installation_id: world.t1.installationId,
    kind: 'individual',
    repository_id: null,
    active_version_id: world.t1.versionId,
  });
});
