// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { repositoryCorporateDocumentResponseSchema } from '../../../shared/corporate.ts';
import { createJobsTable, fakeEnqueuer } from '../../services/jobs-fixture/test-support.ts';
import {
  type CorporateWorld,
  choiceUrl,
  corporateWorld,
  documentUrl,
  failureOf,
  getAs,
  storeCorporateDocument,
  withoutRequestId,
} from './corporate-fixture/test-support.ts';
import { suspendTenantOne } from './repository-document-fixture/test-support.ts';

// `PUT /api/installations/:installationId/repositories/:repositoryId/corporate-document` (E21-S02): an org admin chooses the
// corporate CLA of a repository, or removes the choice. The repository of the world starts with the corporate document `c1`.

/** The world with the fake queue: the repository of the world enforces the CLA, so a change of its corporate CLA sends a sweep. */
async function choiceWorld() {
  const world = await corporateWorld({}, { enqueuer: fakeEnqueuer() });
  await createJobsTable(world.db);
  return world;
}

/** Sends `payload` as `who` to the choice of the corporate CLA of the plain repository of tenant 1 (or of `repositoryId`). */
function choose(
  world: CorporateWorld,
  who: Parameters<CorporateWorld['ask']>[0],
  payload: object,
  repositoryId?: number,
) {
  return world.ask(who, {
    method: 'PUT',
    url: choiceUrl(world.t1.installationId, repositoryId ?? world.t1.plain.repositoryId),
    payload,
  });
}

/** The corporate document the plain repository of tenant 1 points at. */
async function pointer(world: CorporateWorld) {
  const row = await world.db
    .selectFrom('repositories')
    .select('corporate_document_id')
    .where('id', '=', world.t1.plain.repositoryId)
    .executeTakeFirstOrThrow();
  return row.corporate_document_id;
}

const auditRows = (world: CorporateWorld) =>
  world.db
    .selectFrom('audit_log')
    .selectAll()
    .where('action', '=', 'repository.corporate_document_set')
    .orderBy('id')
    .execute();

test('an org admin takes another corporate document: 200 with the document and changed true, one audit row of ids only', async () => {
  const world = await choiceWorld();
  const other = await storeCorporateDocument(world, { name: 'Corporate CLA 2' });
  const response = await choose(world, 'admin1', { documentId: other });
  expect(response.statusCode).toBe(200);
  expect(repositoryCorporateDocumentResponseSchema.parse(response.json())).toEqual({
    documentId: other,
    changed: true,
  });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(await pointer(world)).toBe(other);
  const rows = await auditRows(world);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    installation_id: world.t1.installationId,
    actor_github_id: world.people.admin1.githubId,
    subject_type: 'repository',
    subject_id: world.t1.plain.githubRepoId,
    metadata: {
      repository_id: world.t1.plain.repositoryId,
      document_id: other,
      previous_document_id: world.c1.document.documentId,
    },
  });
});

test('the same choice again is 200 with changed false and writes no audit row', async () => {
  const world = await choiceWorld();
  const response = await choose(world, 'admin1', { documentId: world.c1.document.documentId });
  expect(repositoryCorporateDocumentResponseSchema.parse(response.json())).toEqual({
    documentId: world.c1.document.documentId,
    changed: false,
  });
  expect(await auditRows(world)).toEqual([]);
});

test('null removes the choice: the repository has no corporate CLA, the audit row names the one it had, and the page says so', async () => {
  const world = await choiceWorld();
  const response = await choose(world, 'admin1', { documentId: null });
  expect(repositoryCorporateDocumentResponseSchema.parse(response.json())).toEqual({ documentId: null, changed: true });
  expect(await pointer(world)).toBeNull();
  const [row] = await auditRows(world);
  expect(row?.metadata).toMatchObject({ document_id: null, previous_document_id: world.c1.document.documentId });
  expect(failureOf(await getAs(world, world.ada, documentUrl(world.t1.plain.githubRepoId)))).toEqual([
    404,
    'corporate_cla_not_configured',
  ]);
  expect(
    repositoryCorporateDocumentResponseSchema.parse((await choose(world, 'admin1', { documentId: null })).json())
      .changed,
  ).toBe(false);
});

test('a corporate document of the repository itself may be taken, and the document that is still a draft is taken too', async () => {
  const world = await choiceWorld();
  const scopedHere = await storeCorporateDocument(world, {
    name: 'Scoped here',
    repositoryId: world.t1.plain.repositoryId,
  });
  const draft = await storeCorporateDocument(world, { name: 'Draft only' });
  expect((await choose(world, 'admin1', { documentId: scopedHere })).statusCode).toBe(200);
  expect(await pointer(world)).toBe(scopedHere);
  expect((await choose(world, 'admin1', { documentId: draft })).statusCode).toBe(200);
  expect(failureOf(await getAs(world, world.ada, documentUrl(world.t1.plain.githubRepoId)))).toEqual([
    404,
    'corporate_cla_not_configured',
  ]);
});

test('every document the repository may not take is the same 422 document_not_corporate, and nothing changes', async () => {
  const world = await choiceWorld();
  const elsewhere = await storeCorporateDocument(world, {
    name: 'Scoped elsewhere',
    repositoryId: world.t1.scoped.repositoryId,
  });
  const unknown = await choose(world, 'admin1', { documentId: 987_654 });
  expect(failureOf(unknown)).toEqual([422, 'document_not_corporate']);
  const refused = [
    await choose(world, 'admin1', { documentId: world.t1.documentId }),
    await choose(world, 'admin1', { documentId: world.t1.scoped.documentId }),
    await choose(world, 'admin1', { documentId: world.c2.document.documentId }),
    await choose(world, 'admin1', { documentId: elsewhere }),
  ];
  expect(refused.map(withoutRequestId)).toEqual(refused.map(() => withoutRequestId(unknown)));
  expect(refused.map((response) => response.statusCode)).toEqual([422, 422, 422, 422]);
  expect(await pointer(world)).toBe(world.c1.document.documentId);
  expect(await auditRows(world)).toEqual([]);
});

test.each([
  ['the admin of one repository of the organisation', 'repoAdmin1', 403, 'forbidden'],
  ['a plain member', 'member1', 404, 'not_found'],
  ['a person GitHub knows nothing about', 'outsider', 404, 'not_found'],
  ['the org admin of another tenant', 'admin2', 404, 'not_found'],
  ['nobody', null, 401, 'unauthorized'],
] as const)('%s cannot choose it, and nothing changes', async (_label, who, status, code) => {
  const world = await choiceWorld();
  const other = await storeCorporateDocument(world, { name: 'Corporate CLA 2' });
  const response = await choose(world, who, { documentId: other });
  expect(failureOf(response)).toEqual([status, code]);
  expect(await pointer(world)).toBe(world.c1.document.documentId);
});

test('a repository of another tenant under this tenant’s path is the 404 of an unknown repository', async () => {
  const world = await choiceWorld();
  const unknown = await choose(world, 'admin1', { documentId: world.c1.document.documentId }, 987_654);
  const crossed = await choose(
    world,
    'admin1',
    { documentId: world.c1.document.documentId },
    world.t2.plain.repositoryId,
  );
  expect(failureOf(crossed)).toEqual([404, 'not_found']);
  expect(withoutRequestId(crossed)).toBe(withoutRequestId(unknown));
  const t2Pointer = await world.db
    .selectFrom('repositories')
    .select('corporate_document_id')
    .where('id', '=', world.t2.plain.repositoryId)
    .executeTakeFirstOrThrow();
  expect(t2Pointer.corporate_document_id).toBe(world.c2.document.documentId);
});

test('the choice of a suspended installation is a 409 installation_suspended, and nothing changes', async () => {
  const world = await choiceWorld();
  await suspendTenantOne(world);
  const response = await choose(world, 'admin1', { documentId: null });
  expect(failureOf(response)).toEqual([409, 'installation_suspended']);
  expect(await pointer(world)).toBe(world.c1.document.documentId);
});

test.each([
  ['an empty body', {}],
  ['a text id', { documentId: '1' }],
  ['a zero id', { documentId: 0 }],
  ['a negative id', { documentId: -1 }],
  ['a fractional id', { documentId: 1.5 }],
  ['a key the schema does not know', { documentId: null, extra: 1 }],
  ['an array', []],
])('%s is a 400 bad_request and nothing changes', async (_label, payload) => {
  const world = await choiceWorld();
  expect(failureOf(await choose(world, 'admin1', payload))).toEqual([400, 'bad_request']);
  expect(await pointer(world)).toBe(world.c1.document.documentId);
});

test('a failure writing the audit row rolls the choice back: 500, the pointer is the old one, and a retry succeeds', async () => {
  const world = await choiceWorld();
  await sql`create function inject_failure() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`.execute(
    world.db,
  );
  await sql`create trigger inject_failure before insert on audit_log for each row execute function inject_failure()`.execute(
    world.db,
  );
  const failed = await choose(world, 'admin1', { documentId: null });
  expect(failureOf(failed)).toEqual([500, 'internal_server_error']);
  expect(await pointer(world)).toBe(world.c1.document.documentId);
  await sql`drop trigger inject_failure on audit_log`.execute(world.db);
  expect((await choose(world, 'admin1', { documentId: null })).statusCode).toBe(200);
  expect(await pointer(world)).toBeNull();
});
