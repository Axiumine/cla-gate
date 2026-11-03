// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { versionResponseSchema } from '../../../shared/cla-history.ts';
import { publishVersionResponseSchema } from '../../../shared/cla-version.ts';
import { errorResponseSchema } from '../../../shared/errors.ts';
import {
  auditRows,
  type DocumentWorld,
  documentWorld,
  errorCodeOf,
  parsed,
  publishAs,
  publishTextAs,
  readDraftAs,
  readVersionAs,
  saveDraftAs,
  tablesOf,
  withoutRequestId,
} from './document-fixture/test-support.ts';

// POST /api/installations/:installationId/documents/:documentId/versions with the source `{ type: 'version' }` (E12-S06), a
// rollback, on the real application over PGlite: what it answers, what it leaves behind, and who may ask. The rules of the
// publish that a rollback shares are in document-version-routes-rules.test.ts; the service is in cla-publish-rollback.test.ts.

const wide = (world: DocumentWorld) => ({ installationId: world.t1.installationId, documentId: world.t1.documentId });
const scoped = (world: DocumentWorld) => ({
  installationId: world.t1.installationId,
  documentId: world.t1.scoped.documentId,
});

/** The body of a rollback to `versionId`, as a major version over `expectedActiveVersionId`; `over` changes any part. */
const rollback = (versionId: number, expectedActiveVersionId: number | null, over: object = {}) => ({
  source: { type: 'version', versionId },
  bump: 'major',
  rationale: 'The last wording was a mistake',
  expectedActiveVersionId,
  ...over,
});

/** The history 1.0 (seeded), 1.1 and 2.0 of tenant 1's installation-wide document, made through the routes; the version ids of 1.1 and 2.0. */
async function history(world: DocumentWorld): Promise<{ v11: number; v20: number }> {
  const minor = await publishTextAs(world, 'admin1', wide(world), { text: 'Wording of 1.1\n' });
  expect(minor.statusCode).toBe(201);
  const major = await publishTextAs(world, 'admin1', wide(world), {
    text: 'Wording of 2.0\n',
    bump: 'major',
    acknowledgeResigning: true,
  });
  expect(major.statusCode).toBe(201);
  return {
    v11: parsed(minor, publishVersionResponseSchema).version.id,
    v20: parsed(major, publishVersionResponseSchema).version.id,
  };
}

test('a rollback to 1.1 as a major version is 201 with 3.0, the hash of 1.1 and the text of 1.1 back from the version route; 1.1 is not the active one', async () => {
  const world = await documentWorld();
  const { v11, v20 } = await history(world);
  const response = await publishAs(world, 'admin1', wide(world), rollback(v11, v20));
  expect(response.statusCode).toBe(201);
  expect(response.headers['cache-control']).toBe('no-store');
  const answer = parsed(response, publishVersionResponseSchema);
  const old = parsed(await readVersionAs(world, 'admin1', wide(world), v11), versionResponseSchema).version;
  expect(answer).toMatchObject({
    version: { major: 3, minor: 0, contentSha256: old.contentSha256 },
    requiresResigning: true,
    affectedSignatures: 0,
  });
  const copy = parsed(
    await readVersionAs(world, 'admin1', wide(world), answer.version.id),
    versionResponseSchema,
  ).version;
  expect(copy).toMatchObject({
    contentMd: 'Wording of 1.1\n',
    active: true,
    rationale: 'The last wording was a mistake',
  });
  expect(copy.contentMd).toBe(old.contentMd);
  const oldAgain = parsed(await readVersionAs(world, 'admin1', wide(world), v11), versionResponseSchema).version;
  expect(oldAgain).toEqual({ ...old, active: false });
});

test('the audit row of a rollback names the version it copies, and holds neither the rationale nor the text', async () => {
  const world = await documentWorld();
  const { v11, v20 } = await history(world);
  const response = await publishAs(
    world,
    'admin1',
    wide(world),
    rollback(v11, v20, { rationale: 'Words of the admin' }),
  );
  const { version } = parsed(response, publishVersionResponseSchema);
  const rows = await auditRows(world, 'cla_version.published');
  expect(rows).toHaveLength(3);
  expect(rows.at(-1)).toMatchObject({
    actor_github_id: world.people.admin1.githubId,
    subject_id: version.id,
    metadata: { document_id: world.t1.documentId, version_id: version.id, major: 3, rolled_back_from_version_id: v11 },
  });
  expect(JSON.stringify(rows)).not.toContain('Words of the admin');
  expect(JSON.stringify(rows)).not.toContain('Wording of 1.1');
  expect(world.logs.text()).not.toContain('Words of the admin');
});

test('a rollback needs a rationale, like every publish: an empty one is 422 invalid_rationale and nothing is stored', async () => {
  const world = await documentWorld();
  const { v11, v20 } = await history(world);
  const before = await tablesOf(world);
  const response = await publishAs(world, 'admin1', wide(world), rollback(v11, v20, { rationale: '  ' }));
  expect([response.statusCode, errorCodeOf(response)]).toEqual([422, 'invalid_rationale']);
  expect(await tablesOf(world)).toEqual(before);
});

test('a rollback across majors as a minor version is 422 rollback_requires_major, and nothing is stored', async () => {
  const world = await documentWorld();
  const { v11, v20 } = await history(world);
  const before = await tablesOf(world);
  const response = await publishAs(world, 'admin1', wide(world), rollback(v11, v20, { bump: 'minor' }));
  expect([response.statusCode, errorCodeOf(response)]).toEqual([422, 'rollback_requires_major']);
  expect(await tablesOf(world)).toEqual(before);
});

test('a rollback to the active text as a minor version is 422 content_unchanged; as a major version it is 409 until the re-signing is confirmed, then 201', async () => {
  const world = await documentWorld();
  const first = await publishAs(
    world,
    'admin1',
    wide(world),
    rollback(world.t1.versionId, world.t1.versionId, { bump: 'minor' }),
  );
  expect([first.statusCode, errorCodeOf(first)]).toEqual([422, 'content_unchanged']);
  const request = rollback(world.t1.versionId, world.t1.versionId);
  const unconfirmed = await publishAs(world, 'admin1', wide(world), request);
  expect(unconfirmed.statusCode).toBe(409);
  expect(parsed(unconfirmed, errorResponseSchema).error).toMatchObject({
    code: 'resign_confirmation_required',
    details: { affectedSignatures: 1 },
  });
  const confirmed = await publishAs(world, 'admin1', wide(world), { ...request, acknowledgeResigning: true });
  expect(confirmed.statusCode).toBe(201);
  expect(parsed(confirmed, publishVersionResponseSchema)).toMatchObject({
    version: { major: 2, minor: 0 },
    requiresResigning: true,
    affectedSignatures: 1,
  });
});

test('a rollback over a version the admin has not seen is 409 stale_active_version with the id the document points at', async () => {
  const world = await documentWorld();
  const { v11, v20 } = await history(world);
  const response = await publishAs(world, 'admin1', wide(world), rollback(v11, v11));
  expect(response.statusCode).toBe(409);
  expect(parsed(response, errorResponseSchema).error).toMatchObject({
    code: 'stale_active_version',
    details: { activeVersionId: v20 },
  });
});

test('a rollback leaves the draft of the document as it is', async () => {
  const world = await documentWorld();
  const saved = await saveDraftAs(world, 'admin1', wide(world), {
    contentMd: 'Work in progress\n',
    expectedRevision: null,
  });
  expect(saved.statusCode).toBe(200);
  const response = await publishAs(
    world,
    'admin1',
    wide(world),
    rollback(world.t1.versionId, world.t1.versionId, { acknowledgeResigning: true }),
  );
  expect(response.statusCode).toBe(201);
  const draft = await readDraftAs(world, 'admin1', world.t1.installationId, world.t1.documentId);
  expect(draft.json<{ draft: { contentMd: string } }>().draft.contentMd).toBe('Work in progress\n');
});

test('a rollback to a version of tenant 2 is the 404 of a version that exists nowhere, byte for byte, and nothing is stored', async () => {
  const world = await documentWorld();
  const before = await tablesOf(world);
  const foreign = await publishAs(
    world,
    'admin1',
    wide(world),
    rollback(world.t2.versionId, world.t1.versionId, { acknowledgeResigning: true }),
  );
  const unknown = await publishAs(
    world,
    'admin1',
    wide(world),
    rollback(987_654, world.t1.versionId, { acknowledgeResigning: true }),
  );
  expect([foreign.statusCode, errorCodeOf(foreign)]).toEqual([404, 'not_found']);
  expect(withoutRequestId(foreign)).toBe(withoutRequestId(unknown));
  expect(await tablesOf(world)).toEqual(before);
});

test('a rollback to a version of another document of the same tenant is 404 too, and so is tenant 2 reaching for tenant 1', async () => {
  const world = await documentWorld();
  const sibling = await publishAs(world, 'admin1', scoped(world), {
    source: { type: 'draft', revision: 1 },
    bump: 'major',
    rationale: 'First',
    expectedActiveVersionId: null,
  });
  const siblingVersion = parsed(sibling, publishVersionResponseSchema).version.id;
  const before = await tablesOf(world);
  const own = { installationId: world.t2.installationId, documentId: world.t2.documentId };
  const attempts = [
    await publishAs(
      world,
      'admin1',
      wide(world),
      rollback(siblingVersion, world.t1.versionId, { acknowledgeResigning: true }),
    ),
    await publishAs(
      world,
      'admin2',
      own,
      rollback(world.t1.versionId, world.t2.versionId, { acknowledgeResigning: true }),
    ),
  ];
  expect(attempts.map((attempt) => [attempt.statusCode, errorCodeOf(attempt)])).toEqual([
    [404, 'not_found'],
    [404, 'not_found'],
  ]);
  expect(await tablesOf(world)).toEqual(before);
});

test('the role follows the scope of the document: the admin of the repository rolls back its own document, and not one of the installation', async () => {
  const world = await documentWorld();
  const first = await publishAs(world, 'repoAdmin1', scoped(world), {
    source: { type: 'draft', revision: 1 },
    bump: 'major',
    rationale: 'First',
    expectedActiveVersionId: null,
  });
  const firstId = parsed(first, publishVersionResponseSchema).version.id;
  const own = await publishAs(world, 'repoAdmin1', scoped(world), rollback(firstId, firstId));
  expect(own.statusCode).toBe(201);
  const before = await tablesOf(world);
  const wideAttempt = await publishAs(
    world,
    'repoAdmin1',
    wide(world),
    rollback(world.t1.versionId, world.t1.versionId, { acknowledgeResigning: true }),
  );
  expect([wideAttempt.statusCode, errorCodeOf(wideAttempt)]).toEqual([403, 'forbidden']);
  const member = await publishAs(world, 'member1', scoped(world), rollback(firstId, firstId));
  expect(member.statusCode).toBe(404);
  expect(await tablesOf(world)).toEqual(before);
});
