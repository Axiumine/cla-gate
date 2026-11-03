// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { publishVersionResponseSchema } from '../../../shared/cla-version.ts';
import { tenantChecksums } from '../db/tenant-fixture/test-support.ts';
import {
  auditRows,
  type DocumentWorld,
  documentWorld,
  errorCodeOf,
  parsed,
  publishAs,
  readDraftAs,
  saveDraftAs,
  withoutRequestId,
} from './document-fixture/test-support.ts';

// POST /api/installations/:installationId/documents/:documentId/versions (E12-S04): who may publish, what the answer holds and
// what the publish leaves behind, on the real application over PGlite. The rules that refuse a publish are in
// document-version-routes-rules.test.ts, the jobs a major version sends and the limits of the body in
// document-version-routes-jobs.test.ts, the two simultaneous publishes in document-version-race.test.ts.

const wide = (world: DocumentWorld) => ({ installationId: world.t1.installationId, documentId: world.t1.documentId });
const scoped = (world: DocumentWorld) => ({
  installationId: world.t1.installationId,
  documentId: world.t1.scoped.documentId,
});

/** A publish of the draft at revision 1 as a major version over the version the document has (`expectedActiveVersionId`). */
const body = (expectedActiveVersionId: number | null, over: object = {}) => ({
  source: { type: 'draft', revision: 1 },
  bump: 'major',
  rationale: 'Because',
  expectedActiveVersionId,
  ...over,
});

test('the admin of the organisation publishes the first version of a repository document: 201 with 1.0, the hash, no text and no rationale, and nothing cached', async () => {
  const world = await documentWorld();
  const response = await publishAs(world, 'admin1', scoped(world), body(null));
  expect(response.statusCode).toBe(201);
  expect(response.headers['cache-control']).toBe('no-store');
  const answer = parsed(response, publishVersionResponseSchema);
  const stored = await world.db
    .selectFrom('cla_versions')
    .selectAll()
    .where('document_id', '=', world.t1.scoped.documentId)
    .executeTakeFirstOrThrow();
  expect(answer).toEqual({
    version: {
      id: stored.id,
      major: 1,
      minor: 0,
      contentSha256: stored.content_sha256,
      publishedAt: stored.published_at.toISOString(),
    },
    requiresResigning: false,
    affectedSignatures: 0,
  });
  expect(Object.keys(answer.version).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'contentSha256',
    'id',
    'major',
    'minor',
    'publishedAt',
  ]);
  expect(stored).toMatchObject({ major: 1, minor: 0, rationale: 'Because', published_by: world.people.admin1.userId });
  expect(response.body).not.toContain('Because');
});

test('the admin of the repository publishes the version of its own document: the role follows the scope of the document', async () => {
  const world = await documentWorld();
  const response = await publishAs(world, 'repoAdmin1', scoped(world), body(null));
  expect(response.statusCode).toBe(201);
  const stored = await world.db
    .selectFrom('cla_versions')
    .select('published_by')
    .where('document_id', '=', world.t1.scoped.documentId)
    .executeTakeFirstOrThrow();
  expect(stored.published_by).toBe(world.people.repoAdmin1.userId);
});

test('a major version over signatures, confirmed, is 201 with requiresResigning and the number of signatures it makes stale', async () => {
  const world = await documentWorld();
  await saveDraftAs(world, 'admin1', wide(world), { contentMd: 'New terms\n', expectedRevision: null });
  const response = await publishAs(world, 'admin1', wide(world), {
    ...body(world.t1.versionId),
    acknowledgeResigning: true,
  });
  expect(response.statusCode).toBe(201);
  expect(parsed(response, publishVersionResponseSchema)).toMatchObject({
    version: { major: 2, minor: 0 },
    requiresResigning: true,
    affectedSignatures: 1,
  });
});

test('the publish consumes the draft and the document then reads as published, with its draft gone', async () => {
  const world = await documentWorld();
  await publishAs(world, 'admin1', scoped(world), body(null));
  const draft = await readDraftAs(world, 'admin1', world.t1.installationId, world.t1.scoped.documentId);
  expect(draft.json()).toEqual({ draft: null });
  const read = await world.ask('admin1', {
    method: 'GET',
    url: `/api/installations/${world.t1.installationId}/documents/${world.t1.scoped.documentId}`,
  });
  expect(read.json<{ document: { hasDraft: boolean; activeVersion: { major: number } } }>().document).toMatchObject({
    hasDraft: false,
    activeVersion: { major: 1 },
  });
});

test('the audit row names the actor, the version and the ids and counts of the publish, and holds neither the rationale nor the text', async () => {
  const world = await documentWorld();
  const response = await publishAs(world, 'repoAdmin1', scoped(world), body(null, { rationale: 'Words of the admin' }));
  const { version } = parsed(response, publishVersionResponseSchema);
  const rows = await auditRows(world, 'cla_version.published');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    installation_id: world.t1.installationId,
    actor_github_id: world.people.repoAdmin1.githubId,
    subject_type: 'cla_version',
    subject_id: version.id,
    metadata: {
      document_id: world.t1.scoped.documentId,
      version_id: version.id,
      major: 1,
      minor: 0,
      bump: 'major',
      affected_signatures: 0,
    },
  });
  expect(JSON.stringify(rows)).not.toContain('Words of the admin');
  expect(JSON.stringify(rows)).not.toContain('Draft of the repository terms');
  expect(world.logs.text()).not.toContain('Words of the admin');
});

test('a hostile rationale is stored as typed and never comes back in an answer', async () => {
  const world = await documentWorld();
  const hostile = '<img src=x onerror=alert(1)> =cmd|calc [x](javascript:alert(1)) @everyone';
  const response = await publishAs(world, 'admin1', scoped(world), body(null, { rationale: hostile }));
  expect(response.statusCode).toBe(201);
  expect(response.body).not.toContain('onerror');
  const stored = await world.db
    .selectFrom('cla_versions')
    .select('rationale')
    .where('document_id', '=', world.t1.scoped.documentId)
    .executeTakeFirstOrThrow();
  expect(stored.rationale).toBe(hostile);
});

test('the admin of a repository cannot publish a document that covers the installation: 403, and nothing is stored', async () => {
  const world = await documentWorld();
  await saveDraftAs(world, 'admin1', wide(world), { contentMd: 'Terms\n', expectedRevision: null });
  const before = await tenantChecksums(world.db);
  const response = await publishAs(world, 'repoAdmin1', wide(world), body(world.t1.versionId));
  expect([response.statusCode, errorCodeOf(response)]).toEqual([403, 'forbidden']);
  expect(await tenantChecksums(world.db)).toEqual(before);
});

test.each([
  ['a plain member of the organisation', 'member1'],
  ['someone who knows nothing of it', 'outsider'],
] as const)('%s is 404 on a document of the organisation, and nothing is stored', async (_label, who) => {
  const world = await documentWorld();
  const before = await tenantChecksums(world.db);
  const response = await publishAs(world, who, scoped(world), body(null));
  expect(response.statusCode).toBe(404);
  expect(await tenantChecksums(world.db)).toEqual(before);
});

test("the admin of another tenant gets the answer of a document that does not exist for tenant 1's document, byte for byte, and nothing is stored", async () => {
  const world = await documentWorld();
  const before = await tenantChecksums(world.db);
  const foreign = await publishAs(world, 'admin2', wide(world), body(world.t1.versionId));
  const unknown = await publishAs(
    world,
    'admin2',
    { installationId: world.t2.installationId, documentId: 987_654 },
    body(null),
  );
  expect(foreign.statusCode).toBe(404);
  expect(withoutRequestId(foreign)).toBe(withoutRequestId(unknown));
  expect(await tenantChecksums(world.db)).toEqual(before);
});

test('tenant 2 document id under the path of tenant 1 is 404 for the admin of tenant 1', async () => {
  const world = await documentWorld();
  const response = await publishAs(
    world,
    'admin1',
    { installationId: world.t1.installationId, documentId: world.t2.documentId },
    body(world.t2.versionId),
  );
  expect(response.statusCode).toBe(404);
  expect(await world.db.selectFrom('cla_versions').select('id').execute()).toHaveLength(2);
});

test('nobody signed in is 401, and nothing is stored', async () => {
  const world = await documentWorld();
  const before = await tenantChecksums(world.db);
  const response = await publishAs(world, null, scoped(world), body(null));
  expect([response.statusCode, errorCodeOf(response)]).toEqual([401, 'unauthorized']);
  expect(await tenantChecksums(world.db)).toEqual(before);
});
