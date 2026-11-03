// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { RATIONALE_MAX_CODE_POINTS } from '../../shared/cla-version.ts';
import { nestedQuotes } from '../../shared/test-support.ts';
import { tenantChecksums } from '../adapters/db/tenant-fixture/test-support.ts';
import { publishVersion as seedVersion } from '../adapters/db/test-support.ts';
import { publishVersion } from './cla-publish.ts';
import {
  activeNumberOf,
  brokenBy,
  draftWith,
  publication,
  publishText,
  publishWorld,
  refuseAudit,
  versionsOf,
} from './publish-fixture/test-support.ts';

// The rules that refuse a publish of a version (E12-S04), one test for each, on PGlite. Every refusal is shown to leave the
// database exactly as it was: the checksums of every tenant table before and after are equal, so no version, pointer, draft or
// audit row moved. The numbers, the row and the audit row of a publish that succeeds are in cla-publish.test.ts.

test.each([
  ['an empty rationale', ''],
  ['a rationale of white space', ' \t\r\n '],
  ['a rationale of 2 001 characters', 'r'.repeat(RATIONALE_MAX_CODE_POINTS + 1)],
  ['a rationale with a NUL', 'a\u0000b'],
  ['a rationale with a lone surrogate', 'a\uD800b'],
] as const)('%s is invalid_rationale, and nothing is written', async (_label, rationale) => {
  const world = await publishWorld();
  const before = await tenantChecksums(world.db);
  const outcome = await brokenBy(
    publishVersion(world.db, world.scope, world.enqueuer, await publication(world, world.scoped, { rationale })),
  );
  expect(outcome).toEqual({ rule: 'invalid_rationale', details: undefined });
  expect(await tenantChecksums(world.db)).toEqual(before);
});

test('a rationale of exactly 2 000 characters is accepted and stored whole', async () => {
  const world = await publishWorld();
  const rationale = 'r'.repeat(RATIONALE_MAX_CODE_POINTS);
  await publishText(world, world.scoped, 'Terms\n', { rationale: `  ${rationale}  ` });
  expect((await versionsOf(world.db, world.scoped)).map((row) => row.rationale)).toEqual([rationale]);
});

test.each([
  ['a version the document does not have yet', 'scoped', 9_999, null],
  ['no version when the document has one', 'wide', null, 'version'],
  ['a version id the document does not point at', 'wide', 9_999, 'version'],
] as const)(
  'expecting %s is stale_active_version with the id the document points at, and nothing is written',
  async (_label, which, expected, active) => {
    const world = await publishWorld();
    const documentId = which === 'wide' ? world.wide : world.scoped;
    const before = await tenantChecksums(world.db);
    const outcome = await brokenBy(
      publishVersion(
        world.db,
        world.scope,
        world.enqueuer,
        await publication(world, documentId, { expectedActiveVersionId: expected }),
      ),
    );
    expect(outcome).toEqual({
      rule: 'stale_active_version',
      details: { activeVersionId: active === null ? null : world.t1.versionId },
    });
    expect(await tenantChecksums(world.db)).toEqual(before);
  },
);

test('the active version is checked before the draft: a publish that is stale in both ways is stale_active_version', async () => {
  const world = await publishWorld();
  const outcome = await brokenBy(
    publishVersion(
      world.db,
      world.scope,
      world.enqueuer,
      await publication(world, world.wide, { expectedActiveVersionId: null, source: { type: 'draft', revision: 9 } }),
    ),
  );
  expect(outcome?.rule).toBe('stale_active_version');
});

test.each([
  ['a revision that is not the draft', 'scoped', 7, 1],
  ['a draft that was never saved', 'wide', 1, null],
] as const)(
  '%s is draft_conflict with the revision the draft is at, and nothing is written',
  async (_label, which, revision, current) => {
    const world = await publishWorld();
    const documentId = which === 'wide' ? world.wide : world.scoped;
    const before = await tenantChecksums(world.db);
    const outcome = await brokenBy(
      publishVersion(
        world.db,
        world.scope,
        world.enqueuer,
        await publication(world, documentId, { source: { type: 'draft', revision }, acknowledgeResigning: true }),
      ),
    );
    expect(outcome).toEqual({ rule: 'draft_conflict', details: { currentRevision: current } });
    expect(await tenantChecksums(world.db)).toEqual(before);
  },
);

test('a draft that was saved over after the editor read it is not published: the revision the editor read is draft_conflict', async () => {
  const world = await publishWorld();
  const read = await draftWith(world, world.scoped, 'Read by the first admin\n');
  await draftWith(world, world.scoped, 'Saved over by the second admin\n');
  const outcome = await brokenBy(
    publishVersion(
      world.db,
      world.scope,
      world.enqueuer,
      await publication(world, world.scoped, { source: { type: 'draft', revision: read } }),
    ),
  );
  expect(outcome).toEqual({ rule: 'draft_conflict', details: { currentRevision: read + 1 } });
  expect(await versionsOf(world.db, world.scoped)).toEqual([]);
});

test('the first version must be major: a minor bump over a document with no version is first_version_must_be_major', async () => {
  const world = await publishWorld();
  const before = await tenantChecksums(world.db);
  const outcome = await brokenBy(
    publishVersion(world.db, world.scope, world.enqueuer, await publication(world, world.scoped, { bump: 'minor' })),
  );
  expect(outcome).toEqual({ rule: 'first_version_must_be_major', details: undefined });
  expect(await tenantChecksums(world.db)).toEqual(before);
  expect(await activeNumberOf(world.db, world.scoped)).toBeNull();
});

test('a minor bump whose canonical text is the active text is content_unchanged, however the line ends are spelt', async () => {
  const world = await publishWorld();
  await publishText(world, world.wide, 'Same wording\nsecond line\n', { bump: 'minor' });
  const revision = await draftWith(world, world.wide, '﻿Same wording\r\nsecond line\r\n\r\n');
  const before = await tenantChecksums(world.db);
  const outcome = await brokenBy(
    publishVersion(
      world.db,
      world.scope,
      world.enqueuer,
      await publication(world, world.wide, { bump: 'minor', source: { type: 'draft', revision } }),
    ),
  );
  expect(outcome).toEqual({ rule: 'content_unchanged', details: undefined });
  expect(await tenantChecksums(world.db)).toEqual(before);
});

test('a major bump with the text that is active is allowed on purpose: it forces signing again without a change of wording', async () => {
  const world = await publishWorld();
  await publishText(world, world.wide, 'Same wording\n', { bump: 'minor' });
  const again = await publishText(world, world.wide, 'Same wording\r\n', { bump: 'major', acknowledgeResigning: true });
  const versions = await versionsOf(world.db, world.wide);
  expect(versions.map((row) => `${row.major}.${row.minor}`)).toEqual(['1.0', '1.1', '2.0']);
  expect(versions[1]?.content_sha256).toBe(again.version.contentSha256);
});

test('a minor bump with different text is allowed, and so is one that differs in a trailing space only', async () => {
  const world = await publishWorld();
  await publishText(world, world.wide, 'Wording\n', { bump: 'minor' });
  await publishText(world, world.wide, 'Wording \n', { bump: 'minor' });
  expect(await activeNumberOf(world.db, world.wide)).toBe('1.2');
});

test.each([
  ['whitespace only', ' \n\t\n', 'content_empty'],
  ['a C0 control character', 'Terms\u0001\n', 'content_invalid_characters'],
  ['block quotes nested 51 levels', nestedQuotes(51), 'content_too_deeply_nested'],
] as const)(
  'a stored draft that breaks a rule of the text, %s, is refused with the rule and nothing is published',
  async (_label, text, rule) => {
    const world = await publishWorld();
    // Written past the service, as a draft that an older version of the code, or a person with the database, could have left.
    await world.db
      .updateTable('cla_drafts')
      .set({ content_md: text })
      .where('document_id', '=', world.scoped)
      .execute();
    const before = await tenantChecksums(world.db);
    const outcome = await brokenBy(
      publishVersion(world.db, world.scope, world.enqueuer, await publication(world, world.scoped)),
    );
    expect(outcome).toEqual({ rule, details: undefined });
    expect(await tenantChecksums(world.db)).toEqual(before);
  },
);

test('a document of another tenant is not_found, and nothing is written', async () => {
  const world = await publishWorld();
  const before = await tenantChecksums(world.db);
  const outcome = await brokenBy(
    publishVersion(
      world.db,
      world.scope,
      world.enqueuer,
      await publication(world, world.t2.documentId, { expectedActiveVersionId: world.t2.versionId }),
    ),
  );
  expect(outcome).toEqual({ rule: 'not_found', details: undefined });
  expect(await tenantChecksums(world.db)).toEqual(before);
});

test.each([
  ['minor', 1, 1],
  ['major', 2, 0],
] as const)(
  'a %s publish whose number %i.%i was taken by a row the lock could not see is version_conflict, and nothing else changes',
  async (bump, major, minor) => {
    const world = await publishWorld();
    // A row with that number that the pointer does not know about, written past the service.
    await seedVersion(world.db, world.wide, world.admin.id, { major, minor, text: 'Unseen\n' });
    const revision = await draftWith(world, world.wide, 'Wording\n');
    const before = await tenantChecksums(world.db);
    const outcome = await brokenBy(
      publishVersion(
        world.db,
        world.scope,
        world.enqueuer,
        await publication(world, world.wide, { bump, acknowledgeResigning: true, source: { type: 'draft', revision } }),
      ),
    );
    expect(outcome).toEqual({ rule: 'version_conflict', details: undefined });
    expect(await tenantChecksums(world.db)).toEqual(before);
    expect(await activeNumberOf(world.db, world.wide)).toBe('1.0');
  },
);

test('a publish whose audit row cannot be written is rolled back whole: no version, the pointer and the draft as they were', async () => {
  const world = await publishWorld();
  await refuseAudit(world.db);
  const before = await tenantChecksums(world.db);
  await expect(
    publishVersion(world.db, world.scope, world.enqueuer, await publication(world, world.scoped)),
  ).rejects.toThrow('audit refused');
  expect(await tenantChecksums(world.db)).toEqual(before);
});

test('a failure that is no rule of publishing is not turned into one: the database error comes out as it is', async () => {
  const world = await publishWorld();
  await refuseAudit(world.db);
  const attempt = publishVersion(world.db, world.scope, world.enqueuer, await publication(world, world.scoped));
  await expect(brokenBy(attempt)).rejects.toThrow('audit refused');
});
