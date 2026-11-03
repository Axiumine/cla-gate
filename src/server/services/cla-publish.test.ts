// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { draftTextOf, tenantChecksums } from '../adapters/db/tenant-fixture/test-support.ts';
import { sha256 } from '../adapters/db/test-support.ts';
import { sha256Hex } from './cla-content.ts';
import { readDraft } from './cla-drafts.ts';
import { publishVersion } from './cla-publish.ts';
import {
  activeNumberOf,
  draftWith,
  publication,
  publishText,
  publishWorld,
  versionsOf,
} from './publish-fixture/test-support.ts';

// Publishing a version of a CLA (E12-S04), below the routes: the same outcomes, reached without a request. The statements are in
// cla-version-queries.ts and cla-version-writes.ts and are held to the tenant by the generated matrix of E11-S06. The rules that
// refuse a publish are in cla-publish-rules.test.ts, the jobs a major version sends in cla-publish-jobs.test.ts.

test('the first version of a document is 1.0: the row holds the canonical text, its hash, the publisher and the clean rationale', async () => {
  const world = await publishWorld();
  const { db, scope, admin, enqueuer, scoped } = world;
  const result = await publishVersion(
    db,
    scope,
    enqueuer,
    await publication(world, scoped, { rationale: '  First release \r\n' }),
  );
  expect(result).toMatchObject({
    requiresResigning: false,
    affectedSignatures: 0,
    version: { major: 1, minor: 0, contentSha256: sha256(draftTextOf(1)) },
  });
  expect(await versionsOf(db, scoped)).toEqual([
    {
      id: result.version.id,
      major: 1,
      minor: 0,
      content_md: draftTextOf(1),
      content_sha256: sha256(draftTextOf(1)),
      published_by: admin.id,
      rationale: 'First release',
    },
  ]);
});

test('the publish moves the pointer to the new row and stamps the document, consumes the draft, and appends one audit row of ids and counts', async () => {
  const world = await publishWorld();
  const { db, scope, admin, scoped, t1 } = world;
  await db
    .updateTable('cla_documents')
    .set({ updated_at: new Date('2026-01-01T00:00:00Z') })
    .execute();
  const { version } = await publishVersion(db, scope, world.enqueuer, await publication(world, scoped));
  const document = await db
    .selectFrom('cla_documents')
    .select(['active_version_id', 'updated_at'])
    .where('id', '=', scoped)
    .executeTakeFirstOrThrow();
  expect(document.active_version_id).toBe(version.id);
  expect(document.updated_at.getTime()).toBeGreaterThan(new Date('2026-06-01T00:00:00Z').getTime());
  expect(await readDraft(db, scope, scoped)).toBeNull();
  const audit = await db.selectFrom('audit_log').selectAll().where('action', '=', 'cla_version.published').execute();
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    installation_id: t1.installationId,
    actor_github_id: admin.githubId,
    subject_type: 'cla_version',
    subject_id: version.id,
    metadata: {
      document_id: scoped,
      version_id: version.id,
      major: 1,
      minor: 0,
      bump: 'major',
      affected_signatures: 0,
    },
  });
  expect(Object.keys(audit[0]?.metadata ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'affected_signatures',
    'bump',
    'document_id',
    'major',
    'minor',
    'version_id',
  ]);
});

test('the rationale and the text are in the version and nowhere else: not in the audit row, not in the other documents', async () => {
  const world = await publishWorld();
  const { db, scope, scoped } = world;
  await publishVersion(
    db,
    scope,
    world.enqueuer,
    await publication(world, scoped, { rationale: 'Secret-looking reason' }),
  );
  const audit = await db.selectFrom('audit_log').selectAll().where('action', '=', 'cla_version.published').execute();
  expect(JSON.stringify(audit)).not.toContain('Secret-looking');
  expect(JSON.stringify(audit)).not.toContain(draftTextOf(1).trim());
});

test('the numbers follow the active version: minor raises the minor, major raises the major and resets the minor, in any order', async () => {
  const world = await publishWorld();
  const { wide } = world;
  const numbers: (string | null)[] = [await activeNumberOf(world.db, wide)];
  const steps = [
    ['minor', false],
    ['minor', false],
    ['major', true],
    ['minor', false],
    ['major', true],
    ['major', false],
  ] as const;
  for (const [index, [bump, acknowledgeResigning]] of steps.entries()) {
    await publishText(world, wide, `Text number ${index}\n`, { bump, acknowledgeResigning });
    numbers.push(await activeNumberOf(world.db, wide));
  }
  expect(numbers).toEqual(['1.0', '1.1', '1.2', '2.0', '2.1', '3.0', '4.0']);
  expect((await versionsOf(world.db, wide)).map((row) => `${row.major}.${row.minor}`)).toEqual(numbers);
});

test('a minor publish writes no signature row and changes none, and the active major stays; a major publish changes the active major and nothing in signatures', async () => {
  const world = await publishWorld();
  const { db, wide } = world;
  const signatures = async () => (await tenantChecksums(db))['signatures'];
  const before = await signatures();
  await publishText(world, wide, 'Minor change\n', { bump: 'minor' });
  expect(await signatures()).toEqual(before);
  expect((await activeNumberOf(db, wide))?.split('.')[0]).toBe('1');
  const major = await publishText(world, wide, 'Major change\n', { bump: 'major', acknowledgeResigning: true });
  expect(await signatures()).toEqual(before);
  expect(major.version.major).toBe(2);
  expect((await activeNumberOf(db, wide))?.split('.')[0]).toBe('2');
});

test('the hash of the version is the hash of the canonical text, for text the database checks it on: emoji, CJK and combining marks', async () => {
  const world = await publishWorld();
  const text = 'Terms \u{1F469}‍\u{1F4BB} 同意 é\r\nLine two\r\n\r\n';
  const { version } = await publishText(world, world.scoped, text);
  const [row] = await versionsOf(world.db, world.scoped);
  expect(row?.content_md).toBe('Terms \u{1F469}‍\u{1F4BB} 同意 é\nLine two\n');
  expect(version.contentSha256).toBe(sha256Hex(row?.content_md ?? ''));
  expect(row?.content_sha256).toBe(version.contentSha256);
});

test('a hostile rationale is stored as typed', async () => {
  const world = await publishWorld();
  const hostile = '<script>alert(1)</script> =HYPERLINK("http://evil.example") @everyone [x](javascript:alert(1))';
  await publishText(world, world.scoped, 'Terms\n', { rationale: hostile });
  expect((await versionsOf(world.db, world.scoped)).map((row) => row.rationale)).toEqual([hostile]);
});

test('the draft that is published is the draft that was saved at that revision, whoever saved it', async () => {
  const world = await publishWorld();
  const revision = await draftWith(world, world.scoped, 'Newest wording\n');
  expect(revision).toBe(2);
  const { version } = await publishVersion(
    world.db,
    world.scope,
    world.enqueuer,
    await publication(world, world.scoped, { source: { type: 'draft', revision } }),
  );
  expect(version.contentSha256).toBe(sha256('Newest wording\n'));
});
