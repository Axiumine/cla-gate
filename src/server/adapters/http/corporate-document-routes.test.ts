// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { currentCorporateConsent } from '../../../shared/consent.ts';
import { corporateDocumentResponseSchema } from '../../../shared/corporate.ts';
import { sha256 } from '../db/test-support.ts';
import {
  ANY_STRING,
  type CorporateWorld,
  corporateWorld,
  documentUrl,
  failureOf,
  getAs,
  UTC_INSTANT,
  withoutRequestId,
} from './corporate-fixture/test-support.ts';

// `GET /api/corporate/repositories/:githubRepoId/document` (E21-S02): the corporate CLA in force for a repository, for any signed-in
// person. The text is the stored source, never rendered on the server; the hash is the one the signing request sends back.

/** Changes the repository of tenant 1 and the document it points at, past the routes. */
async function change(world: CorporateWorld, set: { enabled?: boolean; corporate_document_id?: number | null }) {
  await world.db.updateTable('repositories').set(set).where('id', '=', world.t1.plain.repositoryId).execute();
}

test('any signed-in person reads the corporate CLA in force with its stored text, its hash and the corporate consent sentence', async () => {
  const world = await corporateWorld();
  const response = await getAs(world, world.ada, documentUrl(world.t1.plain.githubRepoId));
  expect(response.statusCode).toBe(200);
  const body = corporateDocumentResponseSchema.parse(response.json());
  expect(body).toEqual({
    repository: { githubRepoId: world.t1.plain.githubRepoId, fullName: 'org-1/repo' },
    document: { id: world.c1.document.documentId, name: 'Corporate CLA' },
    versionId: world.c1.document.versionId,
    major: 1,
    minor: 0,
    contentMd: ANY_STRING,
    contentSha256: world.c1.document.contentSha256,
    publishedAt: UTC_INSTANT,
    consent: currentCorporateConsent(),
  });
  expect(sha256(body.contentMd)).toBe(body.contentSha256);
  expect(response.headers['cache-control']).toBe('no-store');
});

test('a person who belongs to no organisation reads it too: the outsider of the matrix world', async () => {
  const world = await corporateWorld();
  const outsider = await world.login(world.people.outsider.githubId);
  expect((await getAs(world, outsider, documentUrl(world.t2.plain.githubRepoId))).statusCode).toBe(200);
});

test('a request with no session is a 401', async () => {
  const world = await corporateWorld();
  expect(failureOf(await getAs(world, null, documentUrl(world.t1.plain.githubRepoId)))).toEqual([401, 'unauthorized']);
});

test('a suspended installation is read as usual', async () => {
  const world = await corporateWorld();
  await world.db
    .updateTable('installations')
    .set({ suspended_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t1.installationId)
    .execute();
  expect((await getAs(world, world.ada, documentUrl(world.t1.plain.githubRepoId))).statusCode).toBe(200);
});

test.each([
  ['is not enabled', { enabled: false }],
  ['has no corporate document', { corporate_document_id: null }],
])('a repository that %s is a 404 corporate_cla_not_configured', async (_label, set) => {
  const world = await corporateWorld();
  await change(world, set);
  expect(failureOf(await getAs(world, world.ada, documentUrl(world.t1.plain.githubRepoId)))).toEqual([
    404,
    'corporate_cla_not_configured',
  ]);
});

test('a repository that has an individual CLA only is a 404 corporate_cla_not_configured', async () => {
  const world = await corporateWorld();
  expect(failureOf(await getAs(world, world.ada, documentUrl(world.t1.scoped.githubRepoId)))).toEqual([
    404,
    'corporate_cla_not_configured',
  ]);
});

test('an unknown repository, a removed one and those of tenants that are not served are the same 404 not_found', async () => {
  const world = await corporateWorld();
  const unknown = await getAs(world, world.ada, documentUrl(987_654));
  expect(failureOf(unknown)).toEqual([404, 'not_found']);
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t1.plain.repositoryId)
    .execute();
  await world.db
    .updateTable('installations')
    .set({ admission_status: 'rejected', admission_reason: 'policy_changed' })
    .where('id', '=', world.t2.installationId)
    .execute();
  const hidden = [
    await getAs(world, world.ada, documentUrl(world.t1.plain.githubRepoId)),
    await getAs(world, world.ada, documentUrl(world.t2.plain.githubRepoId)),
  ];
  expect(hidden.map(withoutRequestId)).toEqual(hidden.map(() => withoutRequestId(unknown)));
});

test('an uninstalled installation is a 404 not_found', async () => {
  const world = await corporateWorld();
  await world.db
    .updateTable('installations')
    .set({ deleted_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t1.installationId)
    .execute();
  expect(failureOf(await getAs(world, world.ada, documentUrl(world.t1.plain.githubRepoId)))).toEqual([
    404,
    'not_found',
  ]);
});

test.each(['0', '-1', '1.5', 'abc', '01', '1e3', '99999999999999999999'])(
  'the repository id %s is a 400 bad_request',
  async (id) => {
    const world = await corporateWorld();
    expect(failureOf(await getAs(world, world.ada, documentUrl(id)))).toEqual([400, 'bad_request']);
  },
);
