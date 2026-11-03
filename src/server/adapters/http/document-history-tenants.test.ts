// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { versionListResponseSchema, versionResponseSchema } from '../../../shared/cla-history.ts';
import {
  documentWorld,
  errorCodeOf,
  listVersionsAs,
  parsed,
  readVersionAs,
  tablesOf,
  withoutRequestId,
} from './document-fixture/test-support.ts';

// The history of a document with two tenants (E12-S05, cross-tenant tests): both have version 1.0 of an installation-wide
// document with the same text and so the same hash, and each sees its own and nothing of the other. The matrix of E11-S06 runs
// both routes over the whole role table (cross-tenant-matrix.test.ts); these are the cases the story names.

test("a version id of tenant 2 requested under tenant 1's document is the 404 of an unknown id, and changes nothing", async () => {
  const world = await documentWorld();
  const own = { installationId: world.t1.installationId, documentId: world.t1.documentId };
  const before = await tablesOf(world);
  const foreign = await readVersionAs(world, 'admin1', own, world.t2.versionId);
  const unknown = await readVersionAs(world, 'admin1', own, 987_654);
  expect([foreign.statusCode, errorCodeOf(foreign)]).toEqual([404, 'not_found']);
  expect(withoutRequestId(foreign)).toBe(withoutRequestId(unknown));
  expect(await tablesOf(world)).toEqual(before);
});

test('tenant 2 reaching for tenant 1: its document under its path, tenant 1 version under its own document, and the paths crossed, are all the same 404', async () => {
  const world = await documentWorld();
  const unknown = await readVersionAs(
    world,
    'admin2',
    { installationId: world.t2.installationId, documentId: 987_654 },
    1,
  );
  const attempts = [
    await readVersionAs(
      world,
      'admin2',
      { installationId: world.t2.installationId, documentId: world.t1.documentId },
      world.t1.versionId,
    ),
    await readVersionAs(
      world,
      'admin2',
      { installationId: world.t1.installationId, documentId: world.t1.documentId },
      world.t1.versionId,
    ),
    await readVersionAs(
      world,
      'admin2',
      { installationId: world.t2.installationId, documentId: world.t2.documentId },
      world.t1.versionId,
    ),
    await listVersionsAs(world, 'admin2', { installationId: world.t2.installationId, documentId: world.t1.documentId }),
    await listVersionsAs(world, 'admin2', { installationId: world.t1.installationId, documentId: world.t1.documentId }),
    await listVersionsAs(world, 'admin1', { installationId: world.t1.installationId, documentId: world.t2.documentId }),
    await listVersionsAs(world, 'admin1', { installationId: world.t2.installationId, documentId: world.t2.documentId }),
  ];
  expect(attempts.map((attempt) => attempt.statusCode)).toEqual([404, 404, 404, 404, 404, 404, 404]);
  for (const attempt of attempts) {
    expect(withoutRequestId(attempt)).toBe(withoutRequestId(unknown));
  }
});

test("the history of tenant 1 never holds tenant 2's versions, although both have version 1.0 with identical text and hash", async () => {
  const world = await documentWorld();
  expect(world.t2.contentSha256).toBe(world.t1.contentSha256);
  const first = parsed(
    await listVersionsAs(world, 'admin1', { installationId: world.t1.installationId, documentId: world.t1.documentId }),
    versionListResponseSchema,
  );
  const second = parsed(
    await listVersionsAs(world, 'admin2', { installationId: world.t2.installationId, documentId: world.t2.documentId }),
    versionListResponseSchema,
  );
  expect(first.versions.map((version) => version.id)).toEqual([world.t1.versionId]);
  expect(second.versions.map((version) => version.id)).toEqual([world.t2.versionId]);
  expect(first.versions[0]?.contentSha256).toBe(second.versions[0]?.contentSha256);
  expect(first.versions[0]?.publishedBy.githubId).toBe(1001);
  expect(second.versions[0]?.publishedBy.githubId).toBe(2001);
  expect(first.versions[0]?.signatureCount).toBe(1);
  expect(second.versions[0]?.signatureCount).toBe(1);
});

test('each tenant reads its own version by id, and the two are two rows', async () => {
  const world = await documentWorld();
  const one = parsed(
    await readVersionAs(
      world,
      'admin1',
      { installationId: world.t1.installationId, documentId: world.t1.documentId },
      world.t1.versionId,
    ),
    versionResponseSchema,
  );
  const two = parsed(
    await readVersionAs(
      world,
      'admin2',
      { installationId: world.t2.installationId, documentId: world.t2.documentId },
      world.t2.versionId,
    ),
    versionResponseSchema,
  );
  expect(world.t1.versionId).not.toBe(world.t2.versionId);
  expect([one.version.id, two.version.id]).toEqual([world.t1.versionId, world.t2.versionId]);
  expect(one.version.contentMd).toBe(two.version.contentMd);
});
