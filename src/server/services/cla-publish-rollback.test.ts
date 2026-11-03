// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AUDIT_ACTIONS } from '../../shared/audit.ts';
import { tenantChecksums } from '../adapters/db/tenant-fixture/test-support.ts';
import { CLA_TEXT, sha256 } from '../adapters/db/test-support.ts';
import { readDraft } from './cla-drafts.ts';
import { publishVersion } from './cla-publish.ts';
import {
  activeNumberOf,
  addSignature,
  brokenBy,
  draftWith,
  publication,
  publishText,
  publishWorld,
  versionRowsWithXmin,
  versionsOf,
} from './publish-fixture/test-support.ts';

// Publishing a copy of an old version, a rollback (E12-S06), below the routes. The installation-wide document of tenant 1 has
// version 1.0 (`CLA_TEXT`, which is not canonical) and one signature at major 1. A rollback is the publish of E12-S04 with the
// source `{ type: 'version' }`: the checks, the lock, the number, the audit row and the jobs are the same function (`publishWithin`),
// so the rules they share are tested in cla-publish-rules.test.ts, cla-publish-resigning.test.ts and cla-publish-jobs.test.ts, and
// here only what a copy changes. The jobs a rollback sends are in cla-publish-rollback-jobs.test.ts.

type World = Awaited<ReturnType<typeof publishWorld>>;

/** The history 1.0, 1.1 and 2.0 of the installation-wide document; the ids of 1.1 and 2.0 are returned. */
async function historyOfThree(world: World) {
  const minor = await publishText(world, world.wide, 'Edit inside the first major\n', { bump: 'minor' });
  const major = await publishText(world, world.wide, 'Wording of the second major\n', {
    bump: 'major',
    acknowledgeResigning: true,
  });
  return { v11: minor.version, v20: major.version };
}

/** A publish of the text of the version `versionId` over the version the document points at now; `over` changes any part. */
function rollbackTo(world: World, versionId: number, over: Parameters<typeof publication>[2] = {}) {
  return publication(world, world.wide, { source: { type: 'version', versionId }, ...over });
}

test('with the history 1.0, 1.1 and 2.0 a rollback to 1.1 as a major version is 3.0 with the hash of 1.1, 1.1 stays inactive, and no row of cla_versions was updated', async () => {
  const world = await publishWorld();
  const { v11 } = await historyOfThree(world);
  const before = await versionRowsWithXmin(world.db, world.wide);
  const result = await publishVersion(
    world.db,
    world.scope,
    world.enqueuer,
    await rollbackTo(world, v11.id, { rationale: 'The second major was a mistake' }),
  );
  expect(result).toMatchObject({
    requiresResigning: true,
    affectedSignatures: 0,
    version: { major: 3, minor: 0, contentSha256: v11.contentSha256 },
  });
  const after = await versionRowsWithXmin(world.db, world.wide);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after).toHaveLength(before.length + 1);
  expect(after.at(-1)).toMatchObject({
    id: result.version.id,
    content_md: 'Edit inside the first major\n',
    content_sha256: v11.contentSha256,
  });
  const document = await world.db
    .selectFrom('cla_documents')
    .select('active_version_id')
    .where('id', '=', world.wide)
    .executeTakeFirstOrThrow();
  expect(document.active_version_id).toBe(result.version.id);
  expect(document.active_version_id).not.toBe(v11.id);
  expect(await activeNumberOf(world.db, world.wide)).toBe('3.0');
  expect((await versionsOf(world.db, world.wide)).map((row) => `${row.major}.${row.minor}`)).toEqual([
    '1.0',
    '1.1',
    '2.0',
    '3.0',
  ]);
});

test('the copy is the text of the source byte for byte, not made canonical again: the text of a source that is not canonical keeps its hash', async () => {
  const world = await publishWorld();
  await historyOfThree(world);
  const { version } = await publishVersion(
    world.db,
    world.scope,
    world.enqueuer,
    await rollbackTo(world, world.t1.versionId, { acknowledgeResigning: true }),
  );
  expect(version.contentSha256).toBe(sha256(CLA_TEXT));
  const copy = (await versionsOf(world.db, world.wide)).at(-1);
  expect(copy).toMatchObject({ content_md: CLA_TEXT, content_sha256: sha256(CLA_TEXT), published_by: world.admin.id });
  expect(CLA_TEXT.endsWith('\n')).toBe(false);
});

test('the rationale of a rollback is its own, trimmed and stored; it is required, and it is never copied into the audit row', async () => {
  const world = await publishWorld();
  const { v11 } = await historyOfThree(world);
  const empty = await brokenBy(
    publishVersion(world.db, world.scope, world.enqueuer, await rollbackTo(world, v11.id, { rationale: '  ' })),
  );
  expect(empty).toEqual({ rule: 'invalid_rationale', details: undefined });
  await publishVersion(
    world.db,
    world.scope,
    world.enqueuer,
    await rollbackTo(world, v11.id, { rationale: '  Back to the wording we had  ' }),
  );
  expect((await versionsOf(world.db, world.wide)).at(-1)?.rationale).toBe('Back to the wording we had');
  const audit = await world.db
    .selectFrom('audit_log')
    .selectAll()
    .where('action', '=', 'cla_version.published')
    .execute();
  expect(JSON.stringify(audit)).not.toContain('Back to the wording');
});

test('the audit row of a rollback is the one of a publish with the id of the version it copies, an integer, and nothing else added', async () => {
  const world = await publishWorld();
  const { v11 } = await historyOfThree(world);
  const { version } = await publishVersion(world.db, world.scope, world.enqueuer, await rollbackTo(world, v11.id));
  const rows = await world.db
    .selectFrom('audit_log')
    .selectAll()
    .where('action', '=', 'cla_version.published')
    .orderBy('id', 'desc')
    .execute();
  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatchObject({
    installation_id: world.t1.installationId,
    actor_github_id: world.admin.githubId,
    subject_type: 'cla_version',
    subject_id: version.id,
    metadata: {
      document_id: world.wide,
      version_id: version.id,
      major: 3,
      minor: 0,
      bump: 'major',
      affected_signatures: 0,
      rolled_back_from_version_id: v11.id,
    },
  });
  expect(Object.keys(rows[0]?.metadata ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'affected_signatures',
    'bump',
    'document_id',
    'major',
    'minor',
    'rolled_back_from_version_id',
    'version_id',
  ]);
  expect(Object.keys(rows[1]?.metadata ?? {})).not.toContain('rolled_back_from_version_id');
  expect(AUDIT_ACTIONS.filter((action) => action.startsWith('cla_version.'))).toEqual(['cla_version.published']);
});

test('a rollback to the version that is active, as a major version, is allowed on purpose: it forces signing again, and says how many', async () => {
  const world = await publishWorld();
  const request = await rollbackTo(world, world.t1.versionId);
  const refused = await brokenBy(publishVersion(world.db, world.scope, world.enqueuer, request));
  expect(refused).toEqual({ rule: 'resign_confirmation_required', details: { affectedSignatures: 1 } });
  const published = await publishVersion(world.db, world.scope, world.enqueuer, {
    ...request,
    acknowledgeResigning: true,
  });
  expect(published).toMatchObject({
    requiresResigning: true,
    affectedSignatures: 1,
    version: { major: 2, minor: 0, contentSha256: sha256(CLA_TEXT) },
  });
  expect(await activeNumberOf(world.db, world.wide)).toBe('2.0');
});

test('the signatures a rollback makes stale are those of the active major that are not revoked, however many are revoked', async () => {
  const world = await publishWorld();
  const { v20 } = await historyOfThree(world);
  await addSignature(world, { documentId: world.wide, versionId: v20.id, major: 2, revoked: false });
  await addSignature(world, { documentId: world.wide, versionId: v20.id, major: 2, revoked: true });
  await addSignature(world, { documentId: world.wide, versionId: v20.id, major: 2, revoked: true });
  const request = await rollbackTo(world, world.t1.versionId);
  expect(await brokenBy(publishVersion(world.db, world.scope, world.enqueuer, request))).toEqual({
    rule: 'resign_confirmation_required',
    details: { affectedSignatures: 1 },
  });
  const published = await publishVersion(world.db, world.scope, world.enqueuer, {
    ...request,
    acknowledgeResigning: true,
  });
  expect(published).toMatchObject({ requiresResigning: true, affectedSignatures: 1, version: { major: 3, minor: 0 } });
});

test('a rollback with every signature of the active major revoked needs no confirmation', async () => {
  const world = await publishWorld();
  const { v20 } = await historyOfThree(world);
  await addSignature(world, { documentId: world.wide, versionId: v20.id, major: 2, revoked: true });
  const published = await publishVersion(
    world.db,
    world.scope,
    world.enqueuer,
    await rollbackTo(world, world.t1.versionId),
  );
  expect(published).toMatchObject({ requiresResigning: true, affectedSignatures: 0, version: { major: 3, minor: 0 } });
});

test('a rollback inside the active major as a minor version is allowed: the number follows the minor, nobody signs again, and no signature is touched', async () => {
  const world = await publishWorld();
  await publishText(world, world.wide, 'Edit one\n', { bump: 'minor' });
  const two = await publishText(world, world.wide, 'Edit two\n', { bump: 'minor' });
  const signatures = (await tenantChecksums(world.db))['signatures'];
  const published = await publishVersion(
    world.db,
    world.scope,
    world.enqueuer,
    await rollbackTo(world, world.t1.versionId, { bump: 'minor' }),
  );
  expect(published).toMatchObject({
    requiresResigning: false,
    affectedSignatures: 0,
    version: { major: 1, minor: 3, contentSha256: sha256(CLA_TEXT) },
  });
  expect(published.version.contentSha256).not.toBe(two.version.contentSha256);
  expect((await tenantChecksums(world.db))['signatures']).toEqual(signatures);
  expect(await activeNumberOf(world.db, world.wide)).toBe('1.3');
});

test('a rollback to a version of another major as a minor version is rollback_requires_major, and nothing is written', async () => {
  const world = await publishWorld();
  await historyOfThree(world);
  const before = await tenantChecksums(world.db);
  const outcome = await brokenBy(
    publishVersion(
      world.db,
      world.scope,
      world.enqueuer,
      await rollbackTo(world, world.t1.versionId, { bump: 'minor' }),
    ),
  );
  expect(outcome).toEqual({ rule: 'rollback_requires_major', details: undefined });
  expect(await tenantChecksums(world.db)).toEqual(before);
  expect(await activeNumberOf(world.db, world.wide)).toBe('2.0');
});

test('a rollback to the text that is already active as a minor version is content_unchanged', async () => {
  const world = await publishWorld();
  const { v20 } = await historyOfThree(world);
  const before = await tenantChecksums(world.db);
  const outcome = await brokenBy(
    publishVersion(world.db, world.scope, world.enqueuer, await rollbackTo(world, v20.id, { bump: 'minor' })),
  );
  expect(outcome).toEqual({ rule: 'content_unchanged', details: undefined });
  expect(await tenantChecksums(world.db)).toEqual(before);
});

test('the other major is decided before the text: the text of 1.1 under 2.0 as a minor version is rollback_requires_major', async () => {
  const world = await publishWorld();
  const { v11 } = await historyOfThree(world);
  await publishText(world, world.wide, 'Edit inside the first major\n', { bump: 'major', acknowledgeResigning: true });
  const outcome = await brokenBy(
    publishVersion(world.db, world.scope, world.enqueuer, await rollbackTo(world, v11.id, { bump: 'minor' })),
  );
  expect(outcome).toEqual({ rule: 'rollback_requires_major', details: undefined });
});

test('a document with no active version has nothing to roll back to as a minor version: first_version_must_be_major comes first', async () => {
  const world = await publishWorld();
  const before = await tenantChecksums(world.db);
  const outcome = await brokenBy(
    publishVersion(
      world.db,
      world.scope,
      world.enqueuer,
      await publication(world, world.scoped, { source: { type: 'version', versionId: 1 }, bump: 'minor' }),
    ),
  );
  expect(outcome).toEqual({ rule: 'first_version_must_be_major', details: undefined });
  expect(await tenantChecksums(world.db)).toEqual(before);
});

test('a rollback names the version the person saw as active, like every publish: another one is stale_active_version', async () => {
  const world = await publishWorld();
  const { v11, v20 } = await historyOfThree(world);
  const before = await tenantChecksums(world.db);
  const outcome = await brokenBy(
    publishVersion(
      world.db,
      world.scope,
      world.enqueuer,
      await rollbackTo(world, v11.id, { expectedActiveVersionId: v11.id }),
    ),
  );
  expect(outcome).toEqual({ rule: 'stale_active_version', details: { activeVersionId: v20.id } });
  expect(await tenantChecksums(world.db)).toEqual(before);
});

test.each([
  ['a version of tenant 2', (world: World) => world.t2.versionId],
  ['a version of another document of the same tenant', (_world: World, sibling: number) => sibling],
  ['a version id that exists nowhere', () => 987_654],
] as const)('a rollback source that is %s is not_found, and nothing is written', async (_label, versionIdOf) => {
  const world = await publishWorld();
  const sibling = await publishText(world, world.scoped, 'Terms of the repository\n');
  const before = await tenantChecksums(world.db);
  const outcome = await brokenBy(
    publishVersion(
      world.db,
      world.scope,
      world.enqueuer,
      await rollbackTo(world, versionIdOf(world, sibling.version.id), { acknowledgeResigning: true }),
    ),
  );
  expect(outcome).toEqual({ rule: 'not_found', details: undefined });
  expect(await tenantChecksums(world.db)).toEqual(before);
  expect(world.enqueuer.calls).toEqual([]);
});

test('a rollback keeps the draft: it is the work of somebody else, and the publish that consumes a draft is the one made from it', async () => {
  const world = await publishWorld();
  const revision = await draftWith(world, world.wide, 'Work in progress\n');
  await publishVersion(
    world.db,
    world.scope,
    world.enqueuer,
    await rollbackTo(world, world.t1.versionId, { acknowledgeResigning: true }),
  );
  expect(await readDraft(world.db, world.scope, world.wide)).toMatchObject({
    contentMd: 'Work in progress\n',
    revision,
  });
});
