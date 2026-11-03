// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { CLA_TEXT, sha256 } from '../adapters/db/test-support.ts';
import { listVersionPage, readVersion, VersionIntegrityError } from './cla-history.ts';
import { recordingLog, signVersion } from './history-fixture/test-support.ts';
import { brokenBy, type PublishWorld, publishText, publishWorld } from './publish-fixture/test-support.ts';

// The history of a document and the exact text of a version (E12-S05), below the routes: the same outcomes, reached without a
// request. The statements are in cla-history-queries.ts and are held to the tenant by the generated matrix of E11-S06.

const FIRST_PAGE = { limit: 100, from: null };

/** The numbers of the versions of the document, newest first, as `major.minor`. */
async function numbersOf(world: PublishWorld, documentId: number): Promise<string[]> {
  const page = await listVersionPage(world.db, world.scope, documentId, FIRST_PAGE);
  return page.versions.map((version) => `${version.major}.${version.minor}`);
}

/** The document with versions 1.0, 1.1, 1.2, 2.0 and 2.1, published through the service. */
async function documentWithFiveVersions(world: PublishWorld): Promise<void> {
  await publishText(world, world.wide, 'one point one\n', { bump: 'minor' });
  await publishText(world, world.wide, 'one point two\n', { bump: 'minor' });
  await publishText(world, world.wide, 'two\n', { acknowledgeResigning: true });
  await publishText(world, world.wide, 'two point one\n', { bump: 'minor' });
}

test('the versions come newest number first with who published each, why, the hash, whether it is the active one and its signatures', async () => {
  const world = await publishWorld();
  const minor = await publishText(world, world.wide, 'Typo fixed\n', { bump: 'minor', rationale: 'Fixed a typo' });
  const major = await publishText(world, world.wide, 'New terms\n', {
    acknowledgeResigning: true,
    rationale: 'Second line\nof reasons',
  });
  await signVersion(world, minor.version, 50_001);
  const page = await listVersionPage(world.db, world.scope, world.wide, FIRST_PAGE);
  expect(page.next).toBeNull();
  expect(page.versions).toEqual([
    {
      id: major.version.id,
      major: 2,
      minor: 0,
      contentSha256: sha256('New terms\n'),
      publishedBy: { githubId: world.admin.githubId, login: `login-${world.admin.githubId}` },
      rationale: 'Second line\nof reasons',
      publishedAt: major.version.publishedAt,
      active: true,
      signatureCount: 0,
    },
    {
      id: minor.version.id,
      major: 1,
      minor: 1,
      contentSha256: sha256('Typo fixed\n'),
      publishedBy: { githubId: world.admin.githubId, login: `login-${world.admin.githubId}` },
      rationale: 'Fixed a typo',
      publishedAt: minor.version.publishedAt,
      active: false,
      signatureCount: 1,
    },
    {
      id: world.t1.versionId,
      major: 1,
      minor: 0,
      contentSha256: world.t1.contentSha256,
      publishedBy: { githubId: 1001, login: 'publisher-1' },
      rationale: 'test',
      publishedAt: page.versions[2]?.publishedAt,
      active: false,
      signatureCount: 1,
    },
  ]);
});

test('the signatures of a version are those on exactly that version that are not revoked: a signature of the major on another version, and a revoked one, do not count', async () => {
  const world = await publishWorld();
  const minor = await publishText(world, world.wide, 'Typo fixed\n', { bump: 'minor' });
  await signVersion(world, minor.version, 50_001);
  await signVersion(world, minor.version, 50_002);
  const counts = async () =>
    (await listVersionPage(world.db, world.scope, world.wide, FIRST_PAGE)).versions.map(
      (version) => version.signatureCount,
    );
  expect(await counts()).toEqual([2, 1]);
  await world.db
    .updateTable('signatures')
    .set({ revoked_at: sql`now()`, revoked_by: world.admin.id, revoke_reason: 'signer_request' })
    .where('version_id', '=', world.t1.versionId)
    .execute();
  expect(await counts()).toEqual([2, 0]);
  await world.db
    .updateTable('signatures')
    .set({ revoked_at: sql`now()`, revoked_by: world.admin.id, revoke_reason: 'legal_request' })
    .where('version_id', '=', minor.version.id)
    .where(
      'user_id',
      '=',
      (await world.db.selectFrom('users').select('id').where('github_id', '=', 50_001).executeTakeFirstOrThrow()).id,
    )
    .execute();
  expect(await counts()).toEqual([1, 0]);
});

test('a publisher whose personal data was erased shows the login erased-<id>, and the numeric id stays', async () => {
  const world = await publishWorld();
  await publishText(world, world.wide, 'Typo fixed\n', { bump: 'minor' });
  await sql`select erase_signer_pii(${world.admin.githubId}, 9999, ${world.scope.installationId})`.execute(world.db);
  const page = await listVersionPage(world.db, world.scope, world.wide, FIRST_PAGE);
  expect(page.versions.map((version) => version.publishedBy)).toEqual([
    { githubId: world.admin.githubId, login: `erased-${world.admin.githubId}` },
    { githubId: 1001, login: 'publisher-1' },
  ]);
});

test('a document with no version has an empty history', async () => {
  const world = await publishWorld();
  expect(await listVersionPage(world.db, world.scope, world.scoped, FIRST_PAGE)).toEqual({ versions: [], next: null });
});

test.each([
  [1, ['2.1', '2.0', '1.2', '1.1', '1.0']],
  [2, ['2.1', '2.0', '1.2', '1.1', '1.0']],
  [3, ['2.1', '2.0', '1.2', '1.1', '1.0']],
  [5, ['2.1', '2.0', '1.2', '1.1', '1.0']],
])(
  'pages of %i follow the positions through the five versions in order, none skipped and none repeated',
  async (limit, all) => {
    const world = await publishWorld();
    await documentWithFiveVersions(world);
    const seen: string[] = [];
    let pages = 0;
    let from: { major: number; minor: number } | null = null;
    do {
      const page = await listVersionPage(world.db, world.scope, world.wide, { limit, from });
      expect(page.versions.length).toBeLessThanOrEqual(limit);
      seen.push(...page.versions.map((version) => `${version.major}.${version.minor}`));
      from = page.next;
      pages += 1;
    } while (from !== null);
    expect(seen).toEqual(all);
    expect(pages).toBe(Math.ceil(5 / limit));
  },
);

test('the position of the next page is the first version of that page, so a page starts at its own number', async () => {
  const world = await publishWorld();
  await documentWithFiveVersions(world);
  const first = await listVersionPage(world.db, world.scope, world.wide, { limit: 2, from: null });
  expect(first.next).toEqual({ major: 1, minor: 2 });
  const second = await listVersionPage(world.db, world.scope, world.wide, { limit: 2, from: first.next });
  expect(second.versions.map((version) => `${version.major}.${version.minor}`)).toEqual(['1.2', '1.1']);
  expect(await numbersOf(world, world.wide)).toEqual(['2.1', '2.0', '1.2', '1.1', '1.0']);
});

test("the history of tenant 1 holds none of tenant 2's versions, although both have version 1.0 with the same text and hash", async () => {
  const world = await publishWorld();
  expect(world.t2.contentSha256).toBe(world.t1.contentSha256);
  const own = await listVersionPage(world.db, world.scope, world.wide, FIRST_PAGE);
  const foreign = await listVersionPage(world.db, world.scope, world.t2.documentId, FIRST_PAGE);
  const second = await listVersionPage(
    world.db,
    { installationId: world.t2.installationId },
    world.t2.documentId,
    FIRST_PAGE,
  );
  expect(own.versions.map((version) => version.id)).toEqual([world.t1.versionId]);
  expect(foreign).toEqual({ versions: [], next: null });
  expect(second.versions.map((version) => version.id)).toEqual([world.t2.versionId]);
  expect(second.versions[0]?.signatureCount).toBe(1);
});

test('a version is read with the exact text it was published with, which is the stored text and no other', async () => {
  const world = await publishWorld();
  const { version } = await publishText(world, world.wide, 'Terms  \r\nof the project\r\n\r\n', { bump: 'minor' });
  const { log, logged } = recordingLog();
  const read = await readVersion(world.db, world.scope, { documentId: world.wide, versionId: version.id }, { log });
  expect(read).toMatchObject({
    id: version.id,
    major: 1,
    minor: 1,
    contentMd: 'Terms  \nof the project\n',
    contentSha256: sha256('Terms  \nof the project\n'),
    active: true,
    signatureCount: 0,
  });
  const seeded = await readVersion(
    world.db,
    world.scope,
    { documentId: world.wide, versionId: world.t1.versionId },
    { log },
  );
  expect(seeded).toMatchObject({ contentMd: CLA_TEXT, active: false, signatureCount: 1 });
  expect(logged).toEqual([]);
});

test.each([
  ['an id that exists nowhere', (w: PublishWorld) => ({ documentId: w.wide, versionId: 987_654 })],
  [
    'a version of another document of the tenant',
    (w: PublishWorld) => ({ documentId: w.scoped, versionId: w.t1.versionId }),
  ],
  [
    "a version of tenant 2 under tenant 1's document",
    (w: PublishWorld) => ({ documentId: w.wide, versionId: w.t2.versionId }),
  ],
  [
    "tenant 2's document and version",
    (w: PublishWorld) => ({ documentId: w.t2.documentId, versionId: w.t2.versionId }),
  ],
  [
    "tenant 2's document with tenant 1's version",
    (w: PublishWorld) => ({ documentId: w.t2.documentId, versionId: w.t1.versionId }),
  ],
])('%s is not_found', async (_label, ids) => {
  const world = await publishWorld();
  const { log, logged } = recordingLog();
  const outcome = await brokenBy(readVersion(world.db, world.scope, ids(world), { log }));
  expect(outcome).toEqual({ rule: 'not_found', details: undefined });
  expect(logged).toEqual([]);
});

test('a text that does not hash to its stored hash is not served: the error is not a rule, and the log line holds the ids and nothing of the row', async () => {
  const world = await publishWorld();
  const stored = await readVersion(
    world.db,
    world.scope,
    { documentId: world.wide, versionId: world.t1.versionId },
    { log: recordingLog().log },
  );
  const { log, logged } = recordingLog();
  const tampered = { findVersion: () => Promise.resolve({ ...stored, contentMd: 'Tampered wording\n' }) };
  const failure = await readVersion(
    world.db,
    world.scope,
    { documentId: world.wide, versionId: world.t1.versionId },
    { log, reads: tampered },
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(VersionIntegrityError);
  expect(failure).toMatchObject({ message: 'the stored text of a version does not match its hash' });
  expect(logged).toEqual([
    [
      { installationId: world.scope.installationId, documentId: world.wide, versionId: world.t1.versionId },
      'cla_version_integrity_failed',
    ],
  ]);
  const everything = JSON.stringify([logged, String(failure)]);
  expect(everything).not.toContain('Tampered');
  expect(everything).not.toContain(world.t1.contentSha256);
});

test('a row whose text does hash to its hash goes through the same check and is served, and nothing is logged', async () => {
  const world = await publishWorld();
  const stored = await readVersion(
    world.db,
    world.scope,
    { documentId: world.wide, versionId: world.t1.versionId },
    { log: recordingLog().log },
  );
  const { log, logged } = recordingLog();
  const served = await readVersion(
    world.db,
    world.scope,
    { documentId: world.wide, versionId: world.t1.versionId },
    { log, reads: { findVersion: () => Promise.resolve(stored) } },
  );
  expect(served).toEqual(stored);
  expect(logged).toEqual([]);
});
