// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  auditRows,
  createAs,
  documentCount,
  documentWorld,
  errorCodeOf,
  fillDocuments,
  nameOf,
} from './document-fixture/test-support.ts';

// At most 100 documents per installation (E12-S01).

test('the 100th document of an installation is created and the 101st is 422 document_limit_reached, with nothing stored or audited for it', async () => {
  const world = await documentWorld();
  await fillDocuments(world, world.t1.installationId, 97);
  expect(await documentCount(world)).toBe(97 + 2 + 2);
  const hundredth = await createAs(world, 'admin1', world.t1.installationId, {
    name: 'The hundredth',
    kind: 'individual',
  });
  const before = await documentCount(world);
  const refused = await createAs(world, 'admin1', world.t1.installationId, {
    name: 'One too many',
    kind: 'individual',
  });
  expect(hundredth.statusCode).toBe(201);
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([422, 'document_limit_reached']);
  expect(await documentCount(world)).toBe(before);
  expect(await auditRows(world, 'cla_document.created')).toHaveLength(1);
});

test('a document scoped to a repository counts against the limit of the installation, and so does the refusal for it', async () => {
  const world = await documentWorld();
  await fillDocuments(world, world.t1.installationId, 98);
  const refused = await createAs(world, 'repoAdmin1', world.t1.installationId, {
    name: 'For a repository',
    kind: 'individual',
    repositoryId: world.t1.scoped.repositoryId,
  });
  expect([refused.statusCode, errorCodeOf(refused)]).toEqual([422, 'document_limit_reached']);
});

test('the limit is per installation: a tenant that is full does not stop another', async () => {
  const world = await documentWorld();
  await fillDocuments(world, world.t1.installationId, 98);
  const full = await createAs(world, 'admin1', world.t1.installationId, { name: nameOf(500), kind: 'individual' });
  const other = await createAs(world, 'admin2', world.t2.installationId, { name: nameOf(500), kind: 'individual' });
  expect([full.statusCode, other.statusCode]).toEqual([422, 201]);
});

test('two simultaneous requests for the last place give one 201 and one 422, never 101 documents', async () => {
  const world = await documentWorld();
  await fillDocuments(world, world.t1.installationId, 97);
  const results = await Promise.all([
    createAs(world, 'admin1', world.t1.installationId, { name: nameOf(501), kind: 'individual' }),
    createAs(world, 'admin1', world.t1.installationId, { name: nameOf(502), kind: 'individual' }),
  ]);
  expect(results.map((result) => result.statusCode).toSorted((a, b) => a - b)).toEqual([201, 422]);
  const held = await world.db
    .selectFrom('cla_documents')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('installation_id', '=', world.t1.installationId)
    .executeTakeFirstOrThrow();
  expect(held.n).toBe(100);
});
