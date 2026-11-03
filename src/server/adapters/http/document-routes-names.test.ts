// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { documentResponseSchema } from '../../../shared/cla.ts';
import { HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import {
  auditRows,
  createAs,
  documentCount,
  documentWorld,
  errorCodeOf,
  HOSTILE_DOCUMENT_NAMES,
  nameOf,
  parsed,
} from './document-fixture/test-support.ts';

// The name of a document at the routes (E12-S01): how it is cleaned, which names are refused, and where a name may repeat.
// The cleaning itself is shown name by name in src/shared/cla-name.test.ts.

const RLO = String.fromCodePoint(0x202e);
const COMBINING_E = 'é';

test('a name is NFC-normalised, trimmed and has each whitespace run collapsed to one space, and what comes back is what is stored', async () => {
  const world = await documentWorld();
  const cases = [
    [`  Our   CLA  `, 'Our CLA'],
    [`Caf${COMBINING_E}`, 'Café'],
    ['A  B', 'A B'],
  ] as const;
  for (const [sent, kept] of cases) {
    const response = await createAs(world, 'admin1', world.t1.installationId, { name: sent, kind: 'individual' });
    expect(response.statusCode, sent).toBe(201);
    expect(parsed(response, documentResponseSchema).document.name).toBe(kept);
  }
});

test('a name with a control character, a bidi override, a lone surrogate, no text or more than 100 code points is 422 invalid_name, and nothing is stored', async () => {
  const world = await documentWorld();
  const before = await documentCount(world);
  const refused = [
    '',
    '   ',
    'a\nb',
    'a\tb',
    'a\u0000b',
    'a\u0085b',
    `evil${RLO}gnp.exe`,
    '\ud800',
    'x'.repeat(101),
    '\u{1F600}'.repeat(101),
  ];
  for (const name of refused) {
    const response = await createAs(world, 'admin1', world.t1.installationId, { name, kind: 'individual' });
    expect([response.statusCode, errorCodeOf(response)], JSON.stringify(name)).toEqual([422, 'invalid_name']);
  }
  expect(await documentCount(world)).toBe(before);
  expect(await auditRows(world, 'cla_document.created')).toEqual([]);
});

test('a name of exactly 100 code points is accepted, also when each code point takes two UTF-16 units', async () => {
  const world = await documentWorld();
  const plain = await createAs(world, 'admin1', world.t1.installationId, { name: 'x'.repeat(100), kind: 'individual' });
  const emoji = await createAs(world, 'admin1', world.t1.installationId, {
    name: '\u{1F600}'.repeat(100),
    kind: 'individual',
  });
  expect([plain.statusCode, emoji.statusCode]).toEqual([201, 201]);
});

test('a name that is taken in its scope is 409 document_name_taken, whatever its case or form was typed as after cleaning, and no second document or audit row exists', async () => {
  const world = await documentWorld();
  const first = await createAs(world, 'admin1', world.t1.installationId, { name: 'Our CLA', kind: 'individual' });
  const before = await documentCount(world);
  const again = await createAs(world, 'admin1', world.t1.installationId, { name: '  Our   CLA ', kind: 'individual' });
  expect(first.statusCode).toBe(201);
  expect([again.statusCode, errorCodeOf(again)]).toEqual([409, 'document_name_taken']);
  expect(await documentCount(world)).toBe(before);
  expect(await auditRows(world, 'cla_document.created')).toHaveLength(1);
});

test('names are distinct per case: Our CLA and our cla are two documents', async () => {
  const world = await documentWorld();
  const upper = await createAs(world, 'admin1', world.t1.installationId, { name: 'Our CLA', kind: 'individual' });
  const lower = await createAs(world, 'admin1', world.t1.installationId, { name: 'our cla', kind: 'individual' });
  expect([upper.statusCode, lower.statusCode]).toEqual([201, 201]);
});

test('the name of the document the tenant already has is taken: the installation-wide Individual CLA of the fixture', async () => {
  const world = await documentWorld();
  const response = await createAs(world, 'admin1', world.t1.installationId, {
    name: 'Individual CLA',
    kind: 'individual',
  });
  expect([response.statusCode, errorCodeOf(response)]).toEqual([409, 'document_name_taken']);
});

test('the same name is allowed in two tenants, and in the installation and in a repository of it, and in two repositories', async () => {
  const world = await documentWorld();
  const name = nameOf(1);
  const body = { name, kind: 'individual' };
  const results = await Promise.all([
    createAs(world, 'admin1', world.t1.installationId, body),
    createAs(world, 'admin2', world.t2.installationId, body),
  ]);
  const inRepository = await createAs(world, 'admin1', world.t1.installationId, {
    ...body,
    repositoryId: world.t1.scoped.repositoryId,
  });
  const inOther = await createAs(world, 'admin1', world.t1.installationId, {
    ...body,
    repositoryId: world.t1.plain.repositoryId,
  });
  const repeated = await createAs(world, 'admin1', world.t1.installationId, {
    ...body,
    repositoryId: world.t1.plain.repositoryId,
  });
  expect([...results.map((r) => r.statusCode), inRepository.statusCode, inOther.statusCode]).toEqual([
    201, 201, 201, 201,
  ]);
  expect([repeated.statusCode, errorCodeOf(repeated)]).toEqual([409, 'document_name_taken']);
});

test('the hostile names a document is tested with are the shared corpus but the one name over 100 code points', () => {
  const left = HOSTILE_NAMES.filter((name) => !HOSTILE_DOCUMENT_NAMES.includes(name));
  expect(left).toEqual(['n'.repeat(200)]);
  expect(HOSTILE_DOCUMENT_NAMES.length).toBeGreaterThan(20);
});
