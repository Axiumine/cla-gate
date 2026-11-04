// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { auditRows, documentWorld, errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import {
  answerOf,
  attachAs,
  attachPath,
  pointAt,
  publish,
  repositoryState,
  setEnabled,
  storeDocument,
} from './repository-document-fixture/test-support.ts';

// PUT /api/repositories/:repositoryId/cla-document (E14-S02): who may attach and detach a CLA document and what the call stores
// and audits, on the real application over PGlite. The rules that refuse a call are in repository-document-rules.test.ts, the
// sweep it sends in repository-document-jobs.test.ts, the other tenant's ids in repository-document-tenants.test.ts.

test('the org admin attaches the installation-wide document to a repository: 200 changed, the pointer moves, one audit row, nothing cached', async () => {
  const world = await documentWorld();
  const { t1, people } = world;
  const before = await repositoryState(world, t1.plain.repositoryId);
  const response = await attachAs(world, 'admin1', t1.plain.repositoryId, t1.documentId);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(answerOf(response)).toEqual({ documentId: t1.documentId, changed: true });
  const after = await repositoryState(world, t1.plain.repositoryId);
  expect([after.cla_document_id, after.enabled]).toEqual([t1.documentId, false]);
  expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  const audit = await auditRows(world, 'repository.cla_document_attached');
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    installation_id: t1.installationId,
    actor_github_id: people.admin1.githubId,
    subject_type: 'repository',
    subject_id: t1.plain.githubRepoId,
    metadata: { repository_id: t1.plain.repositoryId, document_id: t1.documentId, previous_document_id: null },
  });
  expect(await auditRows(world, 'repository.cla_document_detached')).toEqual([]);
});

test('the admin of a repository attaches the repository document that is published, for that repository', async () => {
  const world = await documentWorld();
  const { t1, people } = world;
  await setEnabled(world, t1.scoped.repositoryId, false);
  await publish(world, t1.scoped.documentId);
  const response = await attachAs(world, 'repoAdmin1', t1.scoped.repositoryId, t1.scoped.documentId);
  expect(response.statusCode).toBe(200);
  expect(answerOf(response)).toEqual({ documentId: t1.scoped.documentId, changed: true });
  expect((await repositoryState(world, t1.scoped.repositoryId)).cla_document_id).toBe(t1.scoped.documentId);
  const [audit] = await auditRows(world, 'repository.cla_document_attached');
  expect(audit).toMatchObject({ actor_github_id: people.repoAdmin1.githubId });
});

test("the admin of a repository cannot attach the installation-wide document, which is the organisation's: 403 forbidden, nothing changes", async () => {
  const world = await documentWorld();
  await setEnabled(world, world.t1.scoped.repositoryId, false);
  const before = await tablesOf(world);
  const response = await attachAs(world, 'repoAdmin1', world.t1.scoped.repositoryId, world.t1.documentId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([403, 'forbidden']);
  expect(await tablesOf(world)).toEqual(before);
});

test('the admin of one repository gets 403 for another repository of the installation, with the document of either scope', async () => {
  const world = await documentWorld();
  const before = await tablesOf(world);
  const wide = await attachAs(world, 'repoAdmin1', world.t1.plain.repositoryId, world.t1.documentId);
  const own = await attachAs(world, 'repoAdmin1', world.t1.plain.repositoryId, world.t1.scoped.documentId);
  expect([wide.statusCode, own.statusCode]).toEqual([403, 403]);
  expect(await tablesOf(world)).toEqual(before);
});

test('the org admin attaches the repository document of a repository: an org admin passes both requirements', async () => {
  const world = await documentWorld();
  await setEnabled(world, world.t1.scoped.repositoryId, false);
  await publish(world, world.t1.scoped.documentId);
  const response = await attachAs(world, 'admin1', world.t1.scoped.repositoryId, world.t1.scoped.documentId);
  expect([response.statusCode, answerOf(response).changed]).toEqual([200, true]);
});

test('a document replaces the one attached: the audit row names both, and the old document stays as it was', async () => {
  const world = await documentWorld();
  const { t1 } = world;
  const second = await storeDocument(world, { name: 'Second wide CLA', published: true });
  await pointAt(world, t1.plain.repositoryId, t1.documentId);
  const response = await attachAs(world, 'admin1', t1.plain.repositoryId, second);
  expect([response.statusCode, answerOf(response)]).toEqual([200, { documentId: second, changed: true }]);
  const [audit] = await auditRows(world, 'repository.cla_document_attached');
  expect(audit?.metadata).toEqual({
    repository_id: t1.plain.repositoryId,
    document_id: second,
    previous_document_id: t1.documentId,
  });
  const kept = await world.db
    .selectFrom('cla_documents')
    .select('active_version_id')
    .where('id', '=', t1.documentId)
    .executeTakeFirstOrThrow();
  expect(kept.active_version_id).toBe(t1.versionId);
});

test('detaching follows the role of the document that is attached: the admin of the repository detaches its own document', async () => {
  const world = await documentWorld();
  const { t1, people } = world;
  await setEnabled(world, t1.scoped.repositoryId, false);
  await pointAt(world, t1.scoped.repositoryId, t1.scoped.documentId);
  const response = await attachAs(world, 'repoAdmin1', t1.scoped.repositoryId, null);
  expect([response.statusCode, answerOf(response)]).toEqual([200, { documentId: null, changed: true }]);
  expect((await repositoryState(world, t1.scoped.repositoryId)).cla_document_id).toBeNull();
  const audit = await auditRows(world, 'repository.cla_document_detached');
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    installation_id: t1.installationId,
    actor_github_id: people.repoAdmin1.githubId,
    subject_id: t1.scoped.githubRepoId,
    metadata: { repository_id: t1.scoped.repositoryId, document_id: null, previous_document_id: t1.scoped.documentId },
  });
  expect(await auditRows(world, 'repository.cla_document_attached')).toEqual([]);
});

test('the admin of a repository cannot detach the installation-wide document the organisation attached: 403, and it stays attached', async () => {
  const world = await documentWorld();
  await setEnabled(world, world.t1.scoped.repositoryId, false);
  await pointAt(world, world.t1.scoped.repositoryId, world.t1.documentId);
  const before = await tablesOf(world);
  const response = await attachAs(world, 'repoAdmin1', world.t1.scoped.repositoryId, null);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([403, 'forbidden']);
  expect(await tablesOf(world)).toEqual(before);
  const org = await attachAs(world, 'admin1', world.t1.scoped.repositoryId, null);
  expect([org.statusCode, answerOf(org).changed]).toEqual([200, true]);
});

test("the admin of a repository cannot replace the organisation's document by one of their own: a swap takes the old one away too", async () => {
  const world = await documentWorld();
  const { t1 } = world;
  await setEnabled(world, t1.scoped.repositoryId, false);
  await publish(world, t1.scoped.documentId);
  await pointAt(world, t1.scoped.repositoryId, t1.documentId);
  const before = await tablesOf(world);
  const refused = await attachAs(world, 'repoAdmin1', t1.scoped.repositoryId, t1.scoped.documentId);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([403, 'forbidden']);
  expect(await tablesOf(world)).toEqual(before);
  const allowed = await attachAs(world, 'admin1', t1.scoped.repositoryId, t1.scoped.documentId);
  expect([allowed.statusCode, answerOf(allowed).changed]).toEqual([200, true]);
});

test("with no document attached the policy is the organisation's: the admin of a repository cannot detach nothing, the org admin can", async () => {
  const world = await documentWorld();
  await setEnabled(world, world.t1.scoped.repositoryId, false);
  const refused = await attachAs(world, 'repoAdmin1', world.t1.scoped.repositoryId, null);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([403, 'forbidden']);
  const allowed = await attachAs(world, 'admin1', world.t1.scoped.repositoryId, null);
  expect([allowed.statusCode, answerOf(allowed)]).toEqual([200, { documentId: null, changed: false }]);
});

test('re-attaching the document that is attached is 200 changed false: no audit row, the repository row untouched', async () => {
  const world = await documentWorld();
  const { t1 } = world;
  const first = await attachAs(world, 'admin1', t1.plain.repositoryId, t1.documentId);
  expect(answerOf(first).changed).toBe(true);
  const stored = await repositoryState(world, t1.plain.repositoryId);
  const again = await attachAs(world, 'admin1', t1.plain.repositoryId, t1.documentId);
  expect([again.statusCode, answerOf(again)]).toEqual([200, { documentId: t1.documentId, changed: false }]);
  expect(await repositoryState(world, t1.plain.repositoryId)).toEqual(stored);
  expect(await auditRows(world, 'repository.cla_document_attached')).toHaveLength(1);
});

test('a person who holds no role in the installation, and an admin of another one, get the 404 of a repository that does not exist', async () => {
  const world = await documentWorld();
  const unknown = await attachAs(world, 'admin1', 987_654, world.t1.documentId);
  expect(unknown.statusCode).toBe(404);
  const before = await tablesOf(world);
  for (const who of ['member1', 'outsider', 'admin2'] as const) {
    const response = await attachAs(world, who, world.t1.plain.repositoryId, world.t1.documentId);
    expect(response.statusCode).toBe(404);
    expect(withoutRequestId(response)).toBe(withoutRequestId(unknown));
  }
  expect(await tablesOf(world)).toEqual(before);
});

test('a removed repository is not found, even for its org admin', async () => {
  const world = await documentWorld();
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t1.plain.repositoryId)
    .execute();
  const response = await attachAs(world, 'admin1', world.t1.plain.repositoryId, world.t1.documentId);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([404, 'not_found']);
});

test('without a session the call is 401, and nothing changes', async () => {
  const world = await documentWorld();
  const before = await tablesOf(world);
  const response = await attachAs(world, null, world.t1.plain.repositoryId, world.t1.documentId);
  expect(response.statusCode).toBe(401);
  expect(await tablesOf(world)).toEqual(before);
});

test.each([
  ['no Origin', { cookie: true, origin: false, token: true }, 'origin_not_allowed'],
  ['another Origin', { cookie: true, origin: 'https://evil.example', token: true }, 'origin_not_allowed'],
  ['no CSRF token', { cookie: true, origin: true, token: false }, 'csrf_invalid'],
])('the guards of E10 come first: %s is 403 %s, and the repository is untouched', async (_label, sent, code) => {
  const world = await documentWorld();
  const admin = await world.login(world.people.admin1.githubId);
  const origin = sent.origin === true ? world.origin : sent.origin;
  const response = await world.app.inject({
    method: 'PUT',
    url: attachPath(world.t1.plain.repositoryId),
    payload: { documentId: world.t1.documentId },
    headers: {
      cookie: admin.cookie,
      ...(origin === false ? {} : { origin }),
      ...(sent.token ? { 'x-csrf-token': admin.token } : {}),
    },
  });
  expect([response.statusCode, errorCodeOf(response)]).toEqual([403, code]);
  expect((await repositoryState(world, world.t1.plain.repositoryId)).cla_document_id).toBeNull();
});
