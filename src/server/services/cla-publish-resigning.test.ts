// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { tenantChecksums } from '../adapters/db/tenant-fixture/test-support.ts';
import { publishVersion } from './cla-publish.ts';
import { brokenBy, draftWith, publication, publishText, publishWorld } from './publish-fixture/test-support.ts';

// The guard of the re-signing (E12-S04): a major version over an existing one makes the signatures of the previous major stale, so
// when there are any the publish writes nothing until the person says they know. The signer of tenant 1 signed 1.0 of the
// installation-wide document (`publishWorld`).

test('a major bump over signatures is resign_confirmation_required with the count, and nothing is written', async () => {
  const world = await publishWorld();
  const revision = await draftWith(world, world.wide, 'New wording\n');
  const before = await tenantChecksums(world.db);
  const outcome = await brokenBy(
    publishVersion(
      world.db,
      world.scope,
      world.enqueuer,
      await publication(world, world.wide, { source: { type: 'draft', revision } }),
    ),
  );
  expect(outcome).toEqual({ rule: 'resign_confirmation_required', details: { affectedSignatures: 1 } });
  expect(await tenantChecksums(world.db)).toEqual(before);
});

test('only a confirmation that is true counts: a false one asks again', async () => {
  const world = await publishWorld();
  const revision = await draftWith(world, world.wide, 'New wording\n');
  const outcome = await brokenBy(
    publishVersion(
      world.db,
      world.scope,
      world.enqueuer,
      await publication(world, world.wide, { source: { type: 'draft', revision }, acknowledgeResigning: false }),
    ),
  );
  expect(outcome?.rule).toBe('resign_confirmation_required');
});

test('with the confirmation the major version is published, requires signing again, and reports how many signatures it makes stale', async () => {
  const world = await publishWorld();
  const published = await publishText(world, world.wide, 'New wording\n', { acknowledgeResigning: true });
  expect(published).toMatchObject({ requiresResigning: true, affectedSignatures: 1, version: { major: 2, minor: 0 } });
  const audit = await world.db
    .selectFrom('audit_log')
    .select('metadata')
    .where('action', '=', 'cla_version.published')
    .execute();
  expect(audit.map((row) => row.metadata)).toMatchObject([
    { bump: 'major', major: 2, minor: 0, affected_signatures: 1 },
  ]);
});

test('a minor bump never asks: the signatures stay valid, and the answer says no one signs again', async () => {
  const world = await publishWorld();
  const published = await publishText(world, world.wide, 'Typo fixed\n', { bump: 'minor' });
  expect(published).toMatchObject({ requiresResigning: false, affectedSignatures: 0, version: { major: 1, minor: 1 } });
});

test('a revoked signature is not counted: when every signature of the major is revoked the major bump needs no confirmation', async () => {
  const world = await publishWorld();
  await world.db
    .updateTable('signatures')
    .set({ revoked_at: sql`now()`, revoked_by: world.admin.id, revoke_reason: 'signer_request' })
    .where('id', '=', world.t1.signatureId)
    .execute();
  const published = await publishText(world, world.wide, 'New wording\n');
  expect(published).toMatchObject({ requiresResigning: true, affectedSignatures: 0, version: { major: 2, minor: 0 } });
});

test('only the signatures of the previous major are counted: those of another document or tenant are not', async () => {
  const world = await publishWorld();
  // The scoped document has a first version only; the signature of tenant 2 is on tenant 2's document.
  await publishText(world, world.scoped, 'Scoped terms\n');
  const published = await publishText(world, world.scoped, 'Scoped terms, second major\n');
  expect(published).toMatchObject({ requiresResigning: true, affectedSignatures: 0, version: { major: 2, minor: 0 } });
});

test('after a major version, a second major needs no confirmation while no one has signed the first', async () => {
  const world = await publishWorld();
  await publishText(world, world.wide, 'Second major\n', { acknowledgeResigning: true });
  const third = await publishText(world, world.wide, 'Third major\n');
  expect(third).toMatchObject({ requiresResigning: true, affectedSignatures: 0, version: { major: 3, minor: 0 } });
});
