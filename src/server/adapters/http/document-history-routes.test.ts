// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { versionListResponseSchema, versionResponseSchema, versionSummarySchema } from '../../../shared/cla-history.ts';
import { sha256 } from '../db/test-support.ts';
import {
  type DocumentWorld,
  discardDraftAs,
  documentWorld,
  errorCodeOf,
  HOSTILE_DOCUMENT_NAMES,
  listVersionsAs,
  parsed,
  publishTextAs,
  readVersionAs,
  storeVersion,
  tablesOf,
  withoutRequestId,
} from './document-fixture/test-support.ts';

// GET .../documents/:documentId/versions and GET .../versions/:versionId (E12-S05): who may read the history, what the two
// answers hold and that the strings come back as they were stored, on the real application over PGlite. The pages are in
// document-history-pages.test.ts, the other tenant in document-history-tenants.test.ts, the stored hash in
// document-history-integrity.test.ts.

const wide = (world: DocumentWorld) => ({ installationId: world.t1.installationId, documentId: world.t1.documentId });
const scoped = (world: DocumentWorld) => ({
  installationId: world.t1.installationId,
  documentId: world.t1.scoped.documentId,
});

test('the org admin reads the history of the installation-wide document: the versions newest first, each with its publisher, rationale, hash, active flag and signatures, and nothing cached', async () => {
  const world = await documentWorld();
  const published = await publishTextAs(world, 'admin1', wide(world), {
    text: 'Typo fixed\n',
    rationale: ' Fixed a typo ',
  });
  expect(published.statusCode).toBe(201);
  const response = await listVersionsAs(world, 'admin1', wide(world));
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const page = parsed(response, versionListResponseSchema);
  const [second, first] = page.versions;
  expect(page.nextCursor).toBeNull();
  expect(page.versions).toHaveLength(2);
  expect(second).toEqual({
    id: published.json<{ version: { id: number } }>().version.id,
    major: 1,
    minor: 1,
    contentSha256: sha256('Typo fixed\n'),
    publishedBy: { githubId: world.people.admin1.githubId, login: world.people.admin1.login },
    rationale: 'Fixed a typo',
    publishedAt: second?.publishedAt,
    active: true,
    signatureCount: 0,
  });
  expect(first).toEqual({
    id: world.t1.versionId,
    major: 1,
    minor: 0,
    contentSha256: world.t1.contentSha256,
    publishedBy: { githubId: 1001, login: 'publisher-1' },
    rationale: 'test',
    publishedAt: first?.publishedAt,
    active: false,
    signatureCount: 1,
  });
  expect(response.body).not.toContain('contentMd');
  expect(response.body).not.toContain('Typo fixed');
});

test('one version comes back with the same fields and its exact text, the canonical one that was stored, and the text hashes to the hash', async () => {
  const world = await documentWorld();
  const published = await publishTextAs(world, 'admin1', wide(world), {
    text: '\uFEFFTerms  \r\nof the project\r\n\r\n\r\n',
  });
  const id = published.json<{ version: { id: number } }>().version.id;
  const response = await readVersionAs(world, 'admin1', wide(world), id);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const { version } = parsed(response, versionResponseSchema);
  expect(version.contentMd).toBe('Terms  \nof the project\n');
  expect(sha256(version.contentMd)).toBe(version.contentSha256);
  const listed = parsed(await listVersionsAs(world, 'admin1', wide(world)), versionListResponseSchema);
  expect(listed.versions[0]).toEqual(versionSummarySchema.parse(version));
  const seeded = parsed(await readVersionAs(world, 'admin1', wide(world), world.t1.versionId), versionResponseSchema);
  expect(seeded.version).toMatchObject({ major: 1, minor: 0, active: false, signatureCount: 1 });
});

test('a read changes no row of any tenant table and writes no audit row', async () => {
  const world = await documentWorld();
  const before = await tablesOf(world);
  const list = await listVersionsAs(world, 'admin1', wide(world));
  const one = await readVersionAs(world, 'admin1', wide(world), world.t1.versionId);
  expect([list.statusCode, one.statusCode]).toEqual([200, 200]);
  expect(await tablesOf(world)).toEqual(before);
});

test('the admin of a repository reads the history of the document of that repository, and the org admin does too', async () => {
  const world = await documentWorld();
  const published = await publishTextAs(world, 'repoAdmin1', scoped(world), {
    text: 'Repository terms\n',
    bump: 'major',
  });
  const id = published.json<{ version: { id: number } }>().version.id;
  for (const who of ['repoAdmin1', 'admin1'] as const) {
    const list = await listVersionsAs(world, who, scoped(world));
    const one = await readVersionAs(world, who, scoped(world), id);
    expect([list.statusCode, one.statusCode], who).toEqual([200, 200]);
    expect(parsed(list, versionListResponseSchema).versions.map((version) => version.id)).toEqual([id]);
    expect(parsed(one, versionResponseSchema).version.contentMd).toBe('Repository terms\n');
  }
});

test.each([
  ['the admin of a repository', 'repoAdmin1', 403],
  ['a member of the organisation', 'member1', 404],
  ['a person GitHub knows nothing about', 'outsider', 404],
  ["the admin of another tenant's organisation", 'admin2', 404],
  ['nobody', null, 401],
] as const)('%s does not read the history of the installation-wide document', async (_label, who, status) => {
  const world = await documentWorld();
  const list = await listVersionsAs(world, who, wide(world));
  const one = await readVersionAs(world, who, wide(world), world.t1.versionId);
  expect([list.statusCode, one.statusCode]).toEqual([status, status]);
  expect(list.body).not.toContain(world.t1.contentSha256);
  expect(one.body).not.toContain(world.t1.contentSha256);
});

test('reads use the cached role: the second read asks GitHub nothing, where a second write asks again', async () => {
  const world = await documentWorld();
  await listVersionsAs(world, 'admin1', wide(world));
  const afterFirst = world.roles.calls.length;
  expect(afterFirst).toBeGreaterThan(0);
  await readVersionAs(world, 'admin1', wide(world), world.t1.versionId);
  await listVersionsAs(world, 'admin1', wide(world));
  expect(world.roles.calls).toHaveLength(afterFirst);
  await discardDraftAs(world, 'admin1', world.t1.installationId, world.t1.documentId);
  const afterWrite = world.roles.calls.length;
  await discardDraftAs(world, 'admin1', world.t1.installationId, world.t1.documentId);
  expect(world.roles.calls.length).toBeGreaterThan(afterWrite);
});

test('the rationales of the hostile corpus come back from the list and from the version exactly as they were stored, and so does a login', async () => {
  const world = await documentWorld();
  const ids = await Promise.all(
    HOSTILE_DOCUMENT_NAMES.map((rationale, index) =>
      storeVersion(world, world.t1.documentId, { major: 1, minor: index + 1, text: `Hostile ${index}\n`, rationale }),
    ),
  );
  await world.db
    .updateTable('users')
    .set({ login: '<script>alert(1)</script>' })
    .where('id', '=', world.t1.publisherId)
    .execute();
  const page = parsed(await listVersionsAs(world, 'admin1', wide(world), '?limit=100'), versionListResponseSchema);
  expect(page.versions.map((version) => version.rationale)).toEqual([...HOSTILE_DOCUMENT_NAMES.toReversed(), 'test']);
  expect(new Set(page.versions.map((version) => version.publishedBy.login))).toEqual(
    new Set(['<script>alert(1)</script>']),
  );
  for (const [index, id] of ids.entries()) {
    const one = parsed(await readVersionAs(world, 'admin1', wide(world), id), versionResponseSchema);
    expect(one.version.rationale).toBe(HOSTILE_DOCUMENT_NAMES.at(index));
  }
});

test('a hostile rationale published through the route is stored, listed and read back unchanged', async () => {
  const world = await documentWorld();
  const hostile = '<img src=x onerror=alert(1)> =HYPERLINK("http://evil.example","x") [x](javascript:alert(1))';
  const published = await publishTextAs(world, 'admin1', wide(world), { text: 'Typo fixed\n', rationale: hostile });
  const id = published.json<{ version: { id: number } }>().version.id;
  expect(parsed(await readVersionAs(world, 'admin1', wide(world), id), versionResponseSchema).version.rationale).toBe(
    hostile,
  );
  expect(
    parsed(await listVersionsAs(world, 'admin1', wide(world)), versionListResponseSchema).versions[0]?.rationale,
  ).toBe(hostile);
});

test('a version id that is not a positive integer in plain digits is 400 bad_request, after the guard has let the admin of the tenant in', async () => {
  const world = await documentWorld();
  for (const versionId of ['0', '01', '-1', '1.5', '1e3', 'abc', '0x10', '99999999999999999999']) {
    const response = await readVersionAs(world, 'admin1', wide(world), versionId);
    expect([response.statusCode, errorCodeOf(response)], versionId).toEqual([400, 'bad_request']);
  }
  const stranger = await readVersionAs(world, 'admin2', wide(world), 'abc');
  expect(stranger.statusCode).toBe(404);
});

test('a version id that names no version, and the id of a version of another document, are the same 404', async () => {
  const world = await documentWorld();
  const ofAnother = await storeVersion(world, world.t1.scoped.documentId, {
    major: 1,
    minor: 0,
    text: 'Repository wording\n',
    rationale: 'Only the repository',
  });
  const unknown = await readVersionAs(world, 'admin1', wide(world), 987_654);
  const foreignDocument = await readVersionAs(world, 'admin1', wide(world), ofAnother);
  expect([unknown.statusCode, errorCodeOf(unknown)]).toEqual([404, 'not_found']);
  expect(withoutRequestId(foreignDocument)).toBe(withoutRequestId(unknown));
  expect(foreignDocument.body).not.toContain('Repository wording');
  const ownDocument = await readVersionAs(world, 'admin1', scoped(world), ofAnother);
  expect(ownDocument.statusCode).toBe(200);
});
