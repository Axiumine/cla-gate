// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { publishVersion, sha256 } from '../db/test-support.ts';
import {
  bodyFor,
  type CorporateWorld,
  corporateWorld,
  createdOf,
  detailsOf,
  documentUrl,
  failureOf,
  getAs,
  NOTHING_WRITTEN,
  postAgreement,
  watchRows,
  withoutRequestId,
} from './corporate-fixture/test-support.ts';

// The checks of the signing request after the body was read (E21-S02), in order: the repository and its tenant, a corporate CLA in
// force, the version, its hash, then the texts and the typed name. Every refusal is the standard error body, never echoes what the
// person typed, and writes nothing.

/** Sends `body` as Ada, expects the refusal `[status, code]`, and checks that no row was written. Answers the response. */
async function refused(world: CorporateWorld, body: unknown, expected: readonly [status: number, code: string]) {
  const written = await watchRows(world.db);
  const response = await postAgreement(world, world.ada, body);
  expect(failureOf(response)).toEqual(expected);
  expect(await written()).toEqual(NOTHING_WRITTEN);
  return response;
}

/** Publishes version 2.0 of the corporate document of tenant 1 and points the document at it. Answers its id and hash. */
async function publishSecondMajor(world: CorporateWorld) {
  const { db, c1 } = world;
  const text = 'Corporate terms, second major';
  const version = await publishVersion(db, c1.document.documentId, c1.tenant.publisherId, { major: 2, minor: 0, text });
  await db
    .updateTable('cla_documents')
    .set({ active_version_id: version.id })
    .where('id', '=', c1.document.documentId)
    .execute();
  return { versionId: version.id, contentSha256: sha256(text) };
}

test('an unknown repository is a 404 not_found', async () => {
  const world = await corporateWorld();
  await refused(world, bodyFor(world.c1, { githubRepoId: 987_654 }), [404, 'not_found']);
});

test('a repository that GitHub no longer lists for its installation is a 404 not_found', async () => {
  const world = await corporateWorld();
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t1.plain.repositoryId)
    .execute();
  await refused(world, bodyFor(world.c1), [404, 'not_found']);
});

test.each([
  ['an uninstalled installation', { deleted_at: new Date('2026-10-01T00:00:00Z') }],
  [
    'one the admission policy rejected',
    { admission_status: 'rejected' as const, admission_reason: 'policy_changed' as const },
  ],
])('a repository of %s is the very 404 of a repository that does not exist', async (_label, change) => {
  const world = await corporateWorld();
  const unknown = await refused(world, bodyFor(world.c1, { githubRepoId: 987_654 }), [404, 'not_found']);
  await world.db.updateTable('installations').set(change).where('id', '=', world.t1.installationId).execute();
  const hidden = await refused(world, bodyFor(world.c1), [404, 'not_found']);
  expect(withoutRequestId(hidden)).toBe(withoutRequestId(unknown));
});

test('a suspended installation is a 409 installation_suspended for the write and the page is still served', async () => {
  const world = await corporateWorld();
  await world.db
    .updateTable('installations')
    .set({ suspended_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t1.installationId)
    .execute();
  await refused(world, bodyFor(world.c1), [409, 'installation_suspended']);
  expect((await getAs(world, world.ada, documentUrl(world.t1.plain.githubRepoId))).statusCode).toBe(200);
});

test('a repository that is not enabled, or has no corporate CLA, is a 404 corporate_cla_not_configured', async () => {
  const world = await corporateWorld();
  const { db, t1 } = world;
  await db.updateTable('repositories').set({ enabled: false }).where('id', '=', t1.plain.repositoryId).execute();
  await refused(world, bodyFor(world.c1), [404, 'corporate_cla_not_configured']);
  await db
    .updateTable('repositories')
    .set({ enabled: true, corporate_document_id: null })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  await refused(world, bodyFor(world.c1), [404, 'corporate_cla_not_configured']);
});

test('a corporate document with no published version is a 404 corporate_cla_not_configured', async () => {
  const world = await corporateWorld();
  const { db, t1 } = world;
  const draft = await db
    .insertInto('cla_documents')
    .values({
      installation_id: t1.installationId,
      repository_id: null,
      name: 'Corporate draft only',
      kind: 'corporate',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .updateTable('repositories')
    .set({ corporate_document_id: draft.id })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  await refused(world, bodyFor(world.c1), [404, 'corporate_cla_not_configured']);
});

test('a version that is not the one in force is a 409 version_outdated with the version in force, and nothing the person typed', async () => {
  const world = await corporateWorld();
  const current = await publishSecondMajor(world);
  const response = await refused(world, bodyFor(world.c1, { companyName: 'zzzz Corp' }), [409, 'version_outdated']);
  expect(detailsOf(response)).toEqual({
    current: { versionId: current.versionId, major: 2, minor: 0, contentSha256: current.contentSha256 },
  });
  expect(response.body).not.toContain('zzzz');
});

test('a version of another tenant is a 409 version_outdated, and no more is said of it than of a version that exists nowhere', async () => {
  const world = await corporateWorld();
  const unknown = await refused(world, bodyFor(world.c1, { versionId: 987_654 }), [409, 'version_outdated']);
  const crossed = await refused(world, bodyFor(world.c1, { versionId: world.c2.document.versionId }), [
    409,
    'version_outdated',
  ]);
  expect(withoutRequestId(crossed)).toBe(withoutRequestId(unknown));
});

test('the right version with a hash that is not its hash is a 422 hash_mismatch', async () => {
  const world = await corporateWorld();
  const response = await refused(world, bodyFor(world.c1, { contentSha256: sha256('zzzz other text') }), [
    422,
    'hash_mismatch',
  ]);
  expect(detailsOf(response)).toBeUndefined();
});

test('the version is judged before the texts: a stale page with an empty company name is version_outdated', async () => {
  const world = await corporateWorld();
  await publishSecondMajor(world);
  await refused(world, bodyFor(world.c1, { companyName: '' }), [409, 'version_outdated']);
});

test('the version in force is signed after a second major was published', async () => {
  const world = await corporateWorld();
  const current = await publishSecondMajor(world);
  const agreement = createdOf(
    await postAgreement(
      world,
      world.ada,
      bodyFor(world.c1, { versionId: current.versionId, contentSha256: current.contentSha256 }),
    ),
  );
  expect(agreement).toMatchObject({ versionId: current.versionId, major: 2 });
});

test('authority that is not confirmed is a 422 validation_failed naming the field and nothing else', async () => {
  const world = await corporateWorld();
  const response = await refused(world, bodyFor(world.c1, { authorityConfirmed: false, companyName: 'zzzz' }), [
    422,
    'validation_failed',
  ]);
  expect(detailsOf(response)).toEqual({ field: 'authorityConfirmed' });
  expect(response.body).not.toContain('zzzz');
});

test('a typed name that fails after good texts is the name rule, and after bad texts the text rule comes first', async () => {
  const world = await corporateWorld();
  await refused(world, bodyFor(world.c1, { typedName: '' }), [422, 'invalid_name']);
  const both = await refused(world, bodyFor(world.c1, { typedName: '', companyName: ' ' }), [422, 'validation_failed']);
  expect(detailsOf(both)).toEqual({ field: 'companyName' });
});
