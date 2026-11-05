// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { publishVersion, sha256 } from '../db/test-support.ts';
import {
  bodyFor,
  corporateWorld,
  createdOf,
  failureOf,
  NOTHING_WRITTEN,
  postAgreement,
  signerWith,
  watchRows,
} from './corporate-fixture/test-support.ts';

// One agreement for each person, corporate document and major (E21-S02): the second is a 409 `agreement_exists`, the unique
// violation of `signatures_active_unique` mapped, and the answer says nothing of the agreement that exists.

test('a second agreement for the same person, document and major is a 409 agreement_exists, and writes nothing', async () => {
  const world = await corporateWorld();
  createdOf(await postAgreement(world, world.ada, bodyFor(world.c1)));
  const written = await watchRows(world.db);
  const second = await postAgreement(world, world.ada, bodyFor(world.c1, { companyName: 'Another Corp' }));
  expect(failureOf(second)).toEqual([409, 'agreement_exists']);
  expect(await written()).toEqual(NOTHING_WRITTEN);
});

test('the answer names no id and no detail of the agreement that exists: it is the bare error body', async () => {
  const world = await corporateWorld();
  const first = createdOf(await postAgreement(world, world.ada, bodyFor(world.c1)));
  const second = await postAgreement(world, world.ada, bodyFor(world.c1));
  const parsed = errorResponseSchema.parse(second.json());
  expect(Object.keys(parsed.error).toSorted((a, b) => a.localeCompare(b))).toEqual(['code', 'message', 'requestId']);
  expect(second.body).not.toContain(`"${first.id}"`);
  expect(second.body).not.toContain('agreement":');
});

test('another person signs for the same document and major: one agreement for each person', async () => {
  const world = await corporateWorld();
  createdOf(await postAgreement(world, world.ada, bodyFor(world.c1)));
  const eve = await signerWith(world, 4321);
  const written = await watchRows(world.db);
  createdOf(await postAgreement(world, eve, bodyFor(world.c1, { typedName: 'Eve Example' })));
  expect((await written()).agreements).toBe(1);
});

test('a new major of the corporate document is a new agreement for the same person', async () => {
  const world = await corporateWorld();
  createdOf(await postAgreement(world, world.ada, bodyFor(world.c1)));
  const { db, c1 } = world;
  const text = 'Corporate terms, second major';
  const version = await publishVersion(db, c1.document.documentId, c1.tenant.publisherId, { major: 2, minor: 0, text });
  await db
    .updateTable('cla_documents')
    .set({ active_version_id: version.id })
    .where('id', '=', c1.document.documentId)
    .execute();
  const second = createdOf(
    await postAgreement(world, world.ada, bodyFor(c1, { versionId: version.id, contentSha256: sha256(text) })),
  );
  expect(second.major).toBe(2);
});

test('a revoked signature does not stand in the way: the person may sign again, and the revoked agreement stays', async () => {
  const world = await corporateWorld();
  const first = createdOf(await postAgreement(world, world.ada, bodyFor(world.c1)));
  await world.db
    .updateTable('signatures')
    .set({
      revoked_at: new Date(Date.now() + 1000),
      revoked_by: world.c1.tenant.publisherId,
      revoke_reason: 'maintainer_decision',
    })
    .where('id', '=', first.signatureId)
    .execute();
  const second = createdOf(await postAgreement(world, world.ada, bodyFor(world.c1)));
  expect(second.id).not.toBe(first.id);
  expect(
    await world.db.selectFrom('corporate_agreements').select('id').where('id', '=', first.id).execute(),
  ).toHaveLength(1);
});
