// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { addSignatures, majorOneOf, publishMajor } from '../../services/invalidation-fixture/test-support.ts';
import { sentJobs } from '../../services/jobs-fixture/test-support.ts';
import { errorCodeOf, tablesOf } from './document-fixture/test-support.ts';
import { suspendTenantOne } from './repository-document-fixture/test-support.ts';
import { previewAnswerOf, previewAs } from './signature-invalidate-fixture/test-support.ts';
import { enforceDocuments, revokeWorld } from './signature-revoke-fixture/test-support.ts';

// `GET /api/installations/:installationId/documents/:documentId/invalidation-preview?major=<n>` (E15-S04): the counts a maintainer
// sees before invalidating a major, and nothing else. Tenant 1's installation-wide document has one signature at major 1, the signer's
// (`t1.signatureId`); both repositories of the tenant enforce it. The roles are in signature-invalidate-roles.test.ts, the other
// tenant's ids in signature-invalidate-tenants.test.ts.

/** The revocation world with the repositories on and `extra` more signatures of tenant 1 at major 1. */
async function crowd(extra = 2) {
  const world = await revokeWorld();
  await enforceDocuments(world);
  await addSignatures(world.db, majorOneOf(world.t1), extra, 50_000);
  const target = { installationId: world.t1.installationId, documentId: world.t1.documentId };
  return { ...world, target };
}

test('the preview answers with the major, the signatures of it in force and the repositories that enforce the document, as counts only, nothing cached', async () => {
  const world = await crowd();
  const response = await previewAs(world, 'admin1', world.target);
  expect([response.statusCode, response.headers['cache-control']]).toEqual([200, 'no-store']);
  expect(previewAnswerOf(response)).toEqual({ major: 1, activeSignatures: 3, affectedRepositories: 2 });
  expect(Object.keys(response.json<object>())).toEqual(['major', 'activeSignatures', 'affectedRepositories']);
  expect(response.body).not.toContain(`login-${world.people.member1.githubId}`);
  expect(response.body).not.toContain('@');
});

test('the preview is a read: no row of any table changes, no audit row is written and no job is sent', async () => {
  const world = await crowd();
  const before = await tablesOf(world);
  await previewAs(world, 'admin1', world.target);
  expect(await tablesOf(world)).toEqual(before);
  expect(await world.db.selectFrom('audit_log').select('id').where('action', 'like', 'signature%').execute()).toEqual(
    [],
  );
  expect(await sentJobs(world.db)).toEqual([]);
});

test('the counts follow the state: a revoked signature, a disabled repository, another major and the other tenant are not counted for the major asked about', async () => {
  const world = await crowd();
  const { db, t1, target } = world;
  const [first] = await db.selectFrom('signatures').select('id').where('document_id', '=', t1.documentId).execute();
  await db
    .updateTable('signatures')
    .set({ revoked_at: sql<Date>`now()`, revoked_by: t1.publisherId, revoke_reason: 'other' })
    .where('id', '=', first?.id ?? 0)
    .execute();
  await db.updateTable('repositories').set({ enabled: false }).where('id', '=', t1.scoped.repositoryId).execute();
  await addSignatures(db, await publishMajor(db, t1, 2), 5, 60_000);
  const answers = [
    previewAnswerOf(await previewAs(world, 'admin1', target, 'major=1')),
    previewAnswerOf(await previewAs(world, 'admin1', target, 'major=2')),
    previewAnswerOf(await previewAs(world, 'admin1', target, 'major=3')),
  ];
  expect(answers).toEqual([
    { major: 1, activeSignatures: 2, affectedRepositories: 1 },
    { major: 2, activeSignatures: 5, affectedRepositories: 1 },
    { major: 3, activeSignatures: 0, affectedRepositories: 1 },
  ]);
});

test('a major with nothing in force is a preview of zero signatures and not an error: the screen shows that there is nothing to invalidate', async () => {
  const world = await crowd();
  const response = await previewAs(world, 'admin1', world.target, 'major=7');
  expect([response.statusCode, previewAnswerOf(response).activeSignatures]).toEqual([200, 0]);
});

const BAD_QUERIES = [
  ['no major', ''],
  ['an empty major', 'major='],
  ['major 0', 'major=0'],
  ['a major with a leading zero', 'major=01'],
  ['a negative major', 'major=-1'],
  ['a major with a sign', 'major=%2B1'],
  ['a major that is not a number', 'major=abc'],
  ['a major that is not whole', 'major=1.5'],
  ['a major in exponent form', 'major=1e3'],
  ['a major the column cannot hold', 'major=2147483648'],
  ['a major written twice', 'major=1&major=2'],
  ['a parameter nobody defined', 'major=1&limit=5'],
] as const;

test('a query without exactly one major in plain digits of 1 or more is 400 bad_request, whatever else it holds', async () => {
  const world = await crowd();
  for (const [label, query] of BAD_QUERIES) {
    const response = await previewAs(world, 'admin1', world.target, query);
    expect([label, response.statusCode, errorCodeOf(response)]).toEqual([label, 400, 'bad_request']);
  }
});

test('the preview of a suspended tenant is served to the admin the ledger remembers: it is a read', async () => {
  const world = await crowd();
  await suspendTenantOne(world);
  const response = await previewAs(world, 'admin1', world.target);
  expect([response.statusCode, previewAnswerOf(response).activeSignatures]).toEqual([200, 3]);
});

test('an unknown document is 404 not_found, and nobody signed in is 401', async () => {
  const world = await crowd();
  const unknown = await previewAs(world, 'admin1', { installationId: world.t1.installationId, documentId: 987_654 });
  const anonymous = await previewAs(world, null, world.target);
  expect([unknown.statusCode, errorCodeOf(unknown), anonymous.statusCode]).toEqual([404, 'not_found', 401]);
});
