// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import {
  type DocumentWorld,
  documentWorld,
  errorCodeOf,
  parsed,
  publishAs,
  saveDraftAs,
  tablesOf,
} from './document-fixture/test-support.ts';

// What the publish route answers when the request breaks a rule (E12-S04): the status and the code of each rule, the details
// that tell the person what to do, and the proof that a refused publish leaves every tenant table as it was.

const wide = (world: DocumentWorld) => ({ installationId: world.t1.installationId, documentId: world.t1.documentId });
const scoped = (world: DocumentWorld) => ({
  installationId: world.t1.installationId,
  documentId: world.t1.scoped.documentId,
});

const ok = (over: object = {}) => ({
  source: { type: 'draft', revision: 1 },
  bump: 'major',
  rationale: 'Because',
  expectedActiveVersionId: null,
  ...over,
});

const BAD_BODIES: readonly (readonly [string, object])[] = [
  ['an unknown key', ok({ installationId: 2 })],
  ['an unknown key in the source', ok({ source: { type: 'draft', revision: 1, versionId: 3 } })],
  ['no source', { bump: 'major', rationale: 'x', expectedActiveVersionId: null }],
  ['no bump', { source: { type: 'draft', revision: 1 }, rationale: 'x', expectedActiveVersionId: null }],
  ['no rationale', { source: { type: 'draft', revision: 1 }, bump: 'major', expectedActiveVersionId: null }],
  [
    'no expected version, which the first version names as null',
    { source: { type: 'draft', revision: 1 }, bump: 'major', rationale: 'x' },
  ],
  ['a bump that is neither', ok({ bump: 'patch' })],
  ['the source of a later story', ok({ source: { type: 'version', versionId: 3 } })],
  ['a revision of zero', ok({ source: { type: 'draft', revision: 0 } })],
  ['a revision as text', ok({ source: { type: 'draft', revision: '1' } })],
  ['an expected version as text', ok({ expectedActiveVersionId: '3' })],
  ['an expected version of zero', ok({ expectedActiveVersionId: 0 })],
  ['a rationale that is not text', ok({ rationale: 5 })],
  ['a confirmation as text', ok({ acknowledgeResigning: 'true' })],
  ['an array', [ok()]],
  ['an empty object', {}],
];

test('a body that is not a publish is 400 bad_request whatever is wrong with it, and nothing is stored', async () => {
  const world = await documentWorld();
  const before = await tablesOf(world);
  for (const [label, payload] of BAD_BODIES) {
    const response = await publishAs(world, 'admin1', scoped(world), payload);
    expect([label, response.statusCode, errorCodeOf(response)]).toEqual([label, 400, 'bad_request']);
  }
  expect(await tablesOf(world)).toEqual(before);
});

const BAD_RATIONALES: readonly (readonly [string, string])[] = [
  ['an empty rationale', ''],
  ['a rationale of white space', '   '],
  ['a rationale of 2 001 characters', 'r'.repeat(2001)],
  ['a rationale of 2 001 emoji', '\u{1F600}'.repeat(2001)],
  ['a rationale with a NUL', 'a\u0000b'],
  ['a rationale with a bell', 'a\u0007b'],
  ['a rationale with a lone surrogate', 'a\uD800b'],
];

test('a rationale that cannot be one is 422 invalid_rationale, whatever is wrong with it, and nothing is stored', async () => {
  const world = await documentWorld();
  const before = await tablesOf(world);
  for (const [label, rationale] of BAD_RATIONALES) {
    const response = await publishAs(world, 'admin1', scoped(world), ok({ rationale }));
    expect([label, response.statusCode, errorCodeOf(response)]).toEqual([label, 422, 'invalid_rationale']);
  }
  expect(await tablesOf(world)).toEqual(before);
});

test('a publish over a version the admin has not seen is 409 stale_active_version with the id the document points at', async () => {
  const world = await documentWorld();
  const before = await tablesOf(world);
  const response = await publishAs(world, 'admin1', wide(world), ok({ expectedActiveVersionId: null }));
  expect(response.statusCode).toBe(409);
  expect(parsed(response, errorResponseSchema).error).toMatchObject({
    code: 'stale_active_version',
    details: { activeVersionId: world.t1.versionId },
  });
  expect(await tablesOf(world)).toEqual(before);
});

test('a first version that expects one is 409 stale_active_version with no active version', async () => {
  const world = await documentWorld();
  const response = await publishAs(world, 'admin1', scoped(world), ok({ expectedActiveVersionId: world.t1.versionId }));
  expect(parsed(response, errorResponseSchema).error).toMatchObject({
    code: 'stale_active_version',
    details: { activeVersionId: null },
  });
});

test('a draft at another revision than the one named is 409 draft_conflict with the revision it is at', async () => {
  const world = await documentWorld();
  const before = await tablesOf(world);
  const response = await publishAs(world, 'admin1', scoped(world), ok({ source: { type: 'draft', revision: 5 } }));
  expect(response.statusCode).toBe(409);
  expect(parsed(response, errorResponseSchema).error).toMatchObject({
    code: 'draft_conflict',
    details: { currentRevision: 1 },
  });
  expect(await tablesOf(world)).toEqual(before);
});

test('a document with no draft is 409 draft_conflict with no current revision', async () => {
  const world = await documentWorld();
  const response = await publishAs(world, 'admin1', wide(world), ok({ expectedActiveVersionId: world.t1.versionId }));
  expect(parsed(response, errorResponseSchema).error).toMatchObject({
    code: 'draft_conflict',
    details: { currentRevision: null },
  });
});

test('the first version with a minor bump is 422 first_version_must_be_major', async () => {
  const world = await documentWorld();
  const response = await publishAs(world, 'admin1', scoped(world), ok({ bump: 'minor' }));
  expect([response.statusCode, errorCodeOf(response)]).toEqual([422, 'first_version_must_be_major']);
});

test('a minor bump with the text that is active is 422 content_unchanged; a major bump with it is 201', async () => {
  const world = await documentWorld();
  const first = await publishAs(world, 'admin1', scoped(world), ok());
  const activeId = first.json<{ version: { id: number } }>().version.id;
  const saved = await saveDraftAs(world, 'admin1', scoped(world), {
    contentMd: 'Draft of the repository terms of tenant 1\r\n\r\n',
    expectedRevision: null,
  });
  const revision = saved.json<{ draft: { revision: number } }>().draft.revision;
  const minor = await publishAs(
    world,
    'admin1',
    scoped(world),
    ok({ bump: 'minor', source: { type: 'draft', revision }, expectedActiveVersionId: activeId }),
  );
  expect([minor.statusCode, errorCodeOf(minor)]).toEqual([422, 'content_unchanged']);
  const major = await publishAs(
    world,
    'admin1',
    scoped(world),
    ok({ source: { type: 'draft', revision }, expectedActiveVersionId: activeId }),
  );
  expect(major.statusCode).toBe(201);
});

test('a major bump over signatures, not confirmed, is 409 resign_confirmation_required with the count, and nothing is written', async () => {
  const world = await documentWorld();
  await saveDraftAs(world, 'admin1', wide(world), { contentMd: 'New terms\n', expectedRevision: null });
  const before = await tablesOf(world);
  const response = await publishAs(world, 'admin1', wide(world), ok({ expectedActiveVersionId: world.t1.versionId }));
  expect(response.statusCode).toBe(409);
  expect(parsed(response, errorResponseSchema).error).toMatchObject({
    code: 'resign_confirmation_required',
    details: { affectedSignatures: 1 },
  });
  expect(await tablesOf(world)).toEqual(before);
});

test('the same request with the confirmation is 201: the admin resubmits what they were shown', async () => {
  const world = await documentWorld();
  await saveDraftAs(world, 'admin1', wide(world), { contentMd: 'New terms\n', expectedRevision: null });
  const request = ok({ expectedActiveVersionId: world.t1.versionId });
  expect((await publishAs(world, 'admin1', wide(world), request)).statusCode).toBe(409);
  const again = await publishAs(world, 'admin1', wide(world), { ...request, acknowledgeResigning: true });
  expect(again.statusCode).toBe(201);
});

test('a text the stored draft cannot be published as, such as one that is only white space, is 422 with the rule of the text and nothing of it', async () => {
  const world = await documentWorld();
  await world.db
    .updateTable('cla_drafts')
    .set({ content_md: ' \n' })
    .where('document_id', '=', world.t1.scoped.documentId)
    .execute();
  const response = await publishAs(world, 'admin1', scoped(world), ok());
  expect([response.statusCode, errorCodeOf(response)]).toEqual([422, 'content_empty']);
});

test('a version cannot be published twice from one draft: the second request finds no draft and the document one version', async () => {
  const world = await documentWorld();
  const first = await publishAs(world, 'admin1', scoped(world), ok());
  const second = await publishAs(world, 'admin1', scoped(world), ok());
  expect(first.statusCode).toBe(201);
  expect([second.statusCode, errorCodeOf(second)]).toEqual([409, 'stale_active_version']);
  expect(
    await world.db
      .selectFrom('cla_versions')
      .select('id')
      .where('document_id', '=', world.t1.scoped.documentId)
      .execute(),
  ).toHaveLength(1);
});
