// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { recordAdminSeen } from '../../services/admin-ledger-queries.ts';
import { auditRows, documentWorld, errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import {
  answerOf,
  attachAs,
  attachBody,
  attachPath,
  pointAt,
  publish,
  repositoryState,
  setEnabled,
  storeDocument,
} from './repository-document-fixture/test-support.ts';

// The rules that refuse a change of the CLA a repository enforces (E14-S02): which documents can be attached, that a detach waits for
// enforcement to be off, what a body may hold, and a tenant that is away. Each refusal leaves every tenant table as it was.

test("a document that cannot be attached is 422 document_not_attachable, whatever the reason: unknown, another tenant's, another repository's, corporate", async () => {
  const world = await documentWorld();
  const { t1, t2 } = world;
  const otherRepositoryDocument = await storeDocument(world, {
    name: 'Document of the plain repository',
    repositoryId: t1.plain.repositoryId,
    published: true,
  });
  const corporate = await storeDocument(world, { name: 'Corporate CLA', kind: 'corporate', published: true });
  const ids = [987_654, t2.documentId, t2.scoped.documentId, otherRepositoryDocument, corporate];
  const before = await tablesOf(world);
  const answers: Awaited<ReturnType<typeof attachAs>>[] = [];
  for (const documentId of ids) {
    answers.push(await attachAs(world, 'admin1', t1.scoped.repositoryId, documentId));
  }
  expect(answers.map((answer) => [answer.statusCode, errorCodeOf(answer)])).toEqual(
    ids.map(() => [422, 'document_not_attachable']),
  );
  expect(new Set(answers.map(withoutRequestId)).size).toBe(1);
  expect(await tablesOf(world)).toEqual(before);
});

test('the admin of a repository is told the same 422 for a document that cannot be attached, so the answer separates no tenant', async () => {
  const world = await documentWorld();
  await setEnabled(world, world.t1.scoped.repositoryId, false);
  const foreign = await attachAs(world, 'repoAdmin1', world.t1.scoped.repositoryId, world.t2.documentId);
  const unknown = await attachAs(world, 'repoAdmin1', world.t1.scoped.repositoryId, 987_654);
  expect([foreign.statusCode, unknown.statusCode]).toEqual([422, 422]);
  expect(withoutRequestId(foreign)).toBe(withoutRequestId(unknown));
});

test('a document of the tenant that was never published is 409 document_unpublished, and nothing changes', async () => {
  const world = await documentWorld();
  const { t1 } = world;
  await setEnabled(world, t1.scoped.repositoryId, false);
  const wide = await storeDocument(world, { name: 'Unpublished wide CLA' });
  const before = await tablesOf(world);
  const own = await attachAs(world, 'admin1', t1.scoped.repositoryId, t1.scoped.documentId);
  const other = await attachAs(world, 'admin1', t1.plain.repositoryId, wide);
  expect([own.statusCode, errorCodeOf(own)]).toEqual([409, 'document_unpublished']);
  expect([other.statusCode, errorCodeOf(other)]).toEqual([409, 'document_unpublished']);
  expect(await tablesOf(world)).toEqual(before);
  expect(await auditRows(world, 'repository.cla_document_attached')).toEqual([]);
});

test("the role is judged before the publication: the admin of a repository learns nothing about the state of the organisation's documents", async () => {
  const world = await documentWorld();
  const wide = await storeDocument(world, { name: 'Unpublished wide CLA' });
  await setEnabled(world, world.t1.scoped.repositoryId, false);
  const response = await attachAs(world, 'repoAdmin1', world.t1.scoped.repositoryId, wide);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([403, 'forbidden']);
});

test('a repository that enforces the CLA cannot lose it: 409 repository_enabled, the document stays and no audit row is written', async () => {
  const world = await documentWorld();
  const { t1 } = world;
  await pointAt(world, t1.plain.repositoryId, t1.documentId);
  await setEnabled(world, t1.plain.repositoryId, true);
  const before = await tablesOf(world);
  const response = await attachAs(world, 'admin1', t1.plain.repositoryId, null);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([409, 'repository_enabled']);
  expect(await tablesOf(world)).toEqual(before);
  await setEnabled(world, t1.plain.repositoryId, false);
  const detached = await attachAs(world, 'admin1', t1.plain.repositoryId, null);
  expect([detached.statusCode, answerOf(detached).changed]).toEqual([200, true]);
  expect(await auditRows(world, 'repository.cla_document_detached')).toHaveLength(1);
});

test('detaching from a repository that has no document is 200 changed false, also while it is marked as enforcing: there is nothing to take away', async () => {
  const world = await documentWorld();
  const { t1 } = world;
  const before = await tablesOf(world);
  const response = await attachAs(world, 'admin1', t1.scoped.repositoryId, null);
  expect([response.statusCode, answerOf(response)]).toEqual([200, { documentId: null, changed: false }]);
  expect(await tablesOf(world)).toEqual(before);
});

test.each([
  ['an empty object', {}],
  ['a string id', { documentId: '5' }],
  ['a zero id', { documentId: 0 }],
  ['a negative id', { documentId: -3 }],
  ['a fractional id', { documentId: 1.5 }],
  ['an unsafe integer', { documentId: 2 ** 60 }],
  ['a boolean', { documentId: true }],
  ['an installation id next to the document', { documentId: 5, installationId: 1 }],
  ['an array', [5]],
])('a body of %s is 400 bad_request, and nothing changes', async (_label, body) => {
  const world = await documentWorld();
  const before = await tablesOf(world);
  const response = await attachBody(world, 'admin1', world.t1.plain.repositoryId, body);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
  expect(await tablesOf(world)).toEqual(before);
});

test('a call with no body at all is 400 bad_request', async () => {
  const world = await documentWorld();
  const admin = await world.login(world.people.admin1.githubId);
  const response = await world.app.inject({
    method: 'PUT',
    url: attachPath(world.t1.plain.repositoryId),
    headers: admin.headers,
  });
  expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
  expect((await repositoryState(world, world.t1.plain.repositoryId)).cla_document_id).toBeNull();
});

test.each([['abc'], ['0'], ['007'], ['-1'], ['1.5']])(
  'a repository id of %s in the path is 400 bad_request',
  async (repositoryId) => {
    const world = await documentWorld();
    const response = await attachAs(world, 'admin1', repositoryId, world.t1.documentId);
    expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
  },
);

test('a suspended installation refuses the call with 409 installation_suspended, also for the org admin the ledger remembers, and changes nothing', async () => {
  const world = await documentWorld();
  const now = world.clock.now();
  await recordAdminSeen(world.db, { installationId: world.t1.installationId }, world.people.admin1.githubId, {
    seenAt: now,
    refreshAtOrBefore: now,
  });
  await world.db
    .updateTable('installations')
    .set({ suspended_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t1.installationId)
    .execute();
  const before = await tablesOf(world);
  const attach = await attachAs(world, 'admin1', world.t1.plain.repositoryId, world.t1.documentId);
  const detach = await attachAs(world, 'admin1', world.t1.plain.repositoryId, null);
  expect([attach.statusCode, errorCodeOf(attach)]).toEqual([409, 'installation_suspended']);
  expect([detach.statusCode, errorCodeOf(detach)]).toEqual([409, 'installation_suspended']);
  expect(await tablesOf(world)).toEqual(before);
});

test('a document published after the call that found it unpublished can be attached by the next one', async () => {
  const world = await documentWorld();
  const { t1 } = world;
  await setEnabled(world, t1.scoped.repositoryId, false);
  const refused = await attachAs(world, 'repoAdmin1', t1.scoped.repositoryId, t1.scoped.documentId);
  expect(refused.statusCode).toBe(409);
  await publish(world, t1.scoped.documentId);
  const allowed = await attachAs(world, 'repoAdmin1', t1.scoped.repositoryId, t1.scoped.documentId);
  expect([allowed.statusCode, answerOf(allowed).changed]).toEqual([200, true]);
});
