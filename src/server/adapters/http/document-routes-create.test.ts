// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { documentResponseSchema } from '../../../shared/cla.ts';
import { recordAdminSeen } from '../../services/admin-ledger-queries.ts';
import { createDocument } from '../../services/cla-document-changes.ts';
import {
  auditRows,
  createAs,
  documentCount,
  documentsPath,
  documentWorld,
  errorCodeOf,
  HOSTILE_DOCUMENT_NAMES,
  nameOf,
  parsed,
  withoutRequestId,
} from './document-fixture/test-support.ts';

// POST /api/installations/:installationId/documents (E12-S01): who may create a document, what is stored and audited, and
// the answers for a request that breaks a rule. The rules of the name are in document-routes-names.test.ts, the limit in
// document-routes-limit.test.ts and the cross-tenant matrix of the route in cross-tenant-matrix.test.ts.

test('an org admin creates a document that covers the installation: 201, no cache, one audit row that names ids and the kind, not the name', async () => {
  const world = await documentWorld();
  const response = await createAs(world, 'admin1', world.t1.installationId, { name: 'Our CLA', kind: 'individual' });
  expect(response.statusCode).toBe(201);
  expect(response.headers['cache-control']).toBe('no-store');
  const { document } = parsed(response, documentResponseSchema);
  expect(document).toEqual({
    id: document.id,
    name: 'Our CLA',
    kind: 'individual',
    scope: 'installation',
    repositoryId: null,
    activeVersion: null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  });
  expect(new Date(document.createdAt).toISOString()).toBe(document.createdAt);
  const stored = await world.db
    .selectFrom('cla_documents')
    .selectAll()
    .where('id', '=', document.id)
    .executeTakeFirstOrThrow();
  expect(stored).toMatchObject({
    installation_id: world.t1.installationId,
    repository_id: null,
    name: 'Our CLA',
    kind: 'individual',
    active_version_id: null,
  });
  const audit = await auditRows(world, 'cla_document.created');
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    installation_id: world.t1.installationId,
    actor_github_id: world.people.admin1.githubId,
    subject_type: 'cla_document',
    subject_id: document.id,
    metadata: { document_id: document.id, repository_id: null, kind: 'individual' },
  });
  expect(JSON.stringify(audit[0]?.metadata)).not.toContain('Our CLA');
});

test('the admin of a repository creates a document for that repository: it is scoped to it and the audit row names the repository', async () => {
  const world = await documentWorld();
  const repositoryId = world.t1.scoped.repositoryId;
  const response = await createAs(world, 'repoAdmin1', world.t1.installationId, {
    name: 'Scoped CLA',
    kind: 'individual',
    repositoryId,
  });
  expect(response.statusCode).toBe(201);
  expect(parsed(response, documentResponseSchema).document).toMatchObject({
    name: 'Scoped CLA',
    scope: 'repository',
    repositoryId,
  });
  const [audit] = await auditRows(world, 'cla_document.created');
  expect(audit).toMatchObject({
    actor_github_id: world.people.repoAdmin1.githubId,
    metadata: { repository_id: repositoryId },
  });
});

test('an org admin passes the requirement of a repository: the document is created for the repository they name', async () => {
  const world = await documentWorld();
  const repositoryId = world.t1.plain.repositoryId;
  const response = await createAs(world, 'admin1', world.t1.installationId, {
    name: 'Plain repo CLA',
    kind: 'individual',
    repositoryId,
  });
  expect(response.statusCode).toBe(201);
  expect(parsed(response, documentResponseSchema).document.repositoryId).toBe(repositoryId);
});

test('a repo admin cannot create a document for the whole installation, nor for a repository they do not administer: 403 and nothing stored', async () => {
  const world = await documentWorld();
  const before = await documentCount(world);
  const wide = await createAs(world, 'repoAdmin1', world.t1.installationId, { name: 'Wide', kind: 'individual' });
  const other = await createAs(world, 'repoAdmin1', world.t1.installationId, {
    name: 'Other repository',
    kind: 'individual',
    repositoryId: world.t1.plain.repositoryId,
  });
  expect([wide.statusCode, other.statusCode]).toEqual([403, 403]);
  expect([errorCodeOf(wide), errorCodeOf(other)]).toEqual(['forbidden', 'forbidden']);
  expect(await documentCount(world)).toBe(before);
  expect(await auditRows(world, 'cla_document.created')).toEqual([]);
});

test("tenant 2's repository id in the body of tenant 1's path is the uniform 404, the answer for a repository that does not exist", async () => {
  const world = await documentWorld();
  const before = await documentCount(world);
  const body = { name: 'Crossed', kind: 'individual' };
  const foreign = await createAs(world, 'admin1', world.t1.installationId, {
    ...body,
    repositoryId: world.t2.scoped.repositoryId,
  });
  const unknown = await createAs(world, 'admin1', world.t1.installationId, { ...body, repositoryId: 987_654 });
  expect(foreign.statusCode).toBe(404);
  expect(errorCodeOf(foreign)).toBe('not_found');
  expect(withoutRequestId(foreign)).toBe(withoutRequestId(unknown));
  expect(await documentCount(world)).toBe(before);
});

test('a removed repository cannot be given a document: 404, the org admin included', async () => {
  const world = await documentWorld();
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-06-01T00:00:00Z') })
    .where('id', '=', world.t1.plain.repositoryId)
    .execute();
  const response = await createAs(world, 'admin1', world.t1.installationId, {
    name: 'Gone',
    kind: 'individual',
    repositoryId: world.t1.plain.repositoryId,
  });
  expect(response.statusCode).toBe(404);
});

test('a repository removed after the guard read it is the not_found rule of the service: nothing is stored or audited', async () => {
  const world = await documentWorld();
  const before = await documentCount(world);
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-06-01T00:00:00Z') })
    .where('id', '=', world.t1.plain.repositoryId)
    .execute();
  await expect(
    createDocument(world.db, { installationId: world.t1.installationId }, world.people.admin1.githubId, {
      name: 'Raced',
      kind: 'individual',
      repositoryId: world.t1.plain.repositoryId,
    }),
  ).rejects.toMatchObject({ rule: 'not_found' });
  expect(await documentCount(world)).toBe(before);
  expect(await auditRows(world, 'cla_document.created')).toEqual([]);
});

test('a suspended tenant refuses the creation with 409 installation_suspended, also for the admin the ledger remembers', async () => {
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
  const response = await createAs(world, 'admin1', world.t1.installationId, { name: 'Suspended', kind: 'individual' });
  expect(response.statusCode).toBe(409);
  expect(errorCodeOf(response)).toBe('installation_suspended');
  expect(await auditRows(world, 'cla_document.created')).toEqual([]);
});

test('the corporate kind is accepted by the schema and refused by the service while it is off: 422 kind_not_supported, nothing stored', async () => {
  const world = await documentWorld();
  const before = await documentCount(world);
  const response = await createAs(world, 'admin1', world.t1.installationId, { name: 'Corporate', kind: 'corporate' });
  expect(response.statusCode).toBe(422);
  expect(errorCodeOf(response)).toBe('kind_not_supported');
  expect(await documentCount(world)).toBe(before);
});

test.each([
  ['no body', undefined],
  ['an empty object', {}],
  ['a missing kind', { name: 'x' }],
  ['a missing name', { kind: 'individual' }],
  ['a name that is not text', { name: 7, kind: 'individual' }],
  ['a kind that is not one', { name: 'x', kind: 'team' }],
  ['a key nobody defined', { name: 'x', kind: 'individual', installationId: 1 }],
  ['a null repository', { name: 'x', kind: 'individual', repositoryId: null }],
  ['a zero repository', { name: 'x', kind: 'individual', repositoryId: 0 }],
  ['a negative repository', { name: 'x', kind: 'individual', repositoryId: -1 }],
  ['a fractional repository', { name: 'x', kind: 'individual', repositoryId: 1.5 }],
  ['a repository as text', { name: 'x', kind: 'individual', repositoryId: '3' }],
  ['a repository beyond the safe integers', { name: 'x', kind: 'individual', repositoryId: 1e20 }],
  ['an array', [{ name: 'x', kind: 'individual' }]],
])('a body with %s is 400 bad_request and stores nothing', async (_label, payload) => {
  const world = await documentWorld();
  const before = await documentCount(world);
  const admin = await world.login(world.people.admin1.githubId);
  const response = await world.app.inject({
    method: 'POST',
    url: documentsPath(world.t1.installationId),
    headers: { ...admin.headers, 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
  expect(response.statusCode).toBe(400);
  expect(errorCodeOf(response)).toBe('bad_request');
  expect(await documentCount(world)).toBe(before);
});

test('an installation that is not a plain positive integer is 400, and a request with no session is 401 before its body is read', async () => {
  const world = await documentWorld();
  const bad = await createAs(world, 'admin1', 0, { name: nameOf(1), kind: 'individual' });
  const anonymous = await createAs(world, null, world.t1.installationId, { not: 'a document' });
  expect([bad.statusCode, anonymous.statusCode]).toEqual([400, 401]);
});

test('a request from another site is refused before its body is read: 403 origin_not_allowed', async () => {
  const world = await documentWorld();
  const admin = await world.login(world.people.admin1.githubId);
  const response = await world.app.inject({
    method: 'POST',
    url: documentsPath(world.t1.installationId),
    headers: { ...admin.headers, origin: 'https://evil.example' },
    payload: { not: 'a document' },
  });
  expect(response.statusCode).toBe(403);
  expect(errorCodeOf(response)).toBe('origin_not_allowed');
});

test('two simultaneous requests for one name give exactly one 201 and one 409 document_name_taken: one document, one audit row', async () => {
  const world = await documentWorld();
  const before = await documentCount(world);
  const results = await Promise.all([
    createAs(world, 'admin1', world.t1.installationId, { name: 'Race', kind: 'individual' }),
    createAs(world, 'admin1', world.t1.installationId, { name: 'Race', kind: 'individual' }),
  ]);
  expect(results.map((result) => result.statusCode).toSorted((a, b) => a - b)).toEqual([201, 409]);
  const lost = results.find((result) => result.statusCode === 409);
  expect(lost === undefined ? null : errorCodeOf(lost)).toBe('document_name_taken');
  expect(await documentCount(world)).toBe(before + 1);
  expect(await auditRows(world, 'cla_document.created')).toHaveLength(1);
});

test('every hostile name is accepted and comes back exactly as it went in, in the answer and in the row, and none is in the audit rows', async () => {
  const world = await documentWorld();
  for (const name of HOSTILE_DOCUMENT_NAMES) {
    const response = await createAs(world, 'admin1', world.t1.installationId, { name, kind: 'individual' });
    expect(response.statusCode, name).toBe(201);
    const { document } = parsed(response, documentResponseSchema);
    expect(document.name, name).toBe(name);
    const stored = await world.db
      .selectFrom('cla_documents')
      .select('name')
      .where('id', '=', document.id)
      .executeTakeFirstOrThrow();
    expect(stored.name, name).toBe(name);
  }
  const audit = JSON.stringify(await auditRows(world, 'cla_document.created'));
  expect(HOSTILE_DOCUMENT_NAMES.filter((name) => audit.includes(name))).toEqual([]);
  expect(await auditRows(world, 'cla_document.created')).toHaveLength(HOSTILE_DOCUMENT_NAMES.length);
});
