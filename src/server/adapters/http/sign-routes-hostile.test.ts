// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { errorCodeOf } from './sign-context-fixture/test-support.ts';
import { ADA_EMAIL, postSign, signedOf, signerWith, signingWorld, writtenRows } from './sign-fixture/test-support.ts';

// Hostile names (E13-S04): the names the shared corpus holds are kept as typed, apart from the cleaning of the form (NFC, trim,
// one space for a run of white space), in signer_pii and nowhere else. Neutralising a name is the job of each output (the comment,
// the CSV, the screens), not of storage. The names a person may not type are refused (E13-S03) and nothing is written.

/** What the cleaning of the form makes of a printable name. */
const cleaned = (name: string): string => name.normalize('NFC').trim().replaceAll(/\s+/gu, ' ');

/** Whether `text` holds `name`, raw or as JSON escapes it. */
const holds = (text: string, name: string): boolean =>
  text.includes(name) || text.includes(JSON.stringify(name).slice(1, -1));

test('every name of the corpus is accepted, stored byte for byte in signer_pii, and found in no column of signatures or audit_log', async () => {
  const { world, body } = await signingWorld();
  for (const [index, name] of HOSTILE_NAMES.entries()) {
    const who = await signerWith(world, 5000 + index, [ADA_EMAIL]);
    const answer = signedOf(await postSign(world, who, body({ name })), 201);
    const stored = await world.db
      .selectFrom('signer_pii')
      .select('name')
      .where('signature_id', '=', answer.signature.id)
      .executeTakeFirstOrThrow();
    expect(Buffer.from(stored.name).equals(Buffer.from(cleaned(name))), `entry ${index}`).toBe(true);
    expect(stored.name, `entry ${index}`).toBe(name);
  }
  const everywhereElse = JSON.stringify([
    await world.db.selectFrom('signatures').selectAll().execute(),
    await world.db.selectFrom('audit_log').selectAll().execute(),
  ]);
  expect(HOSTILE_NAMES.filter((name) => holds(everywhereElse, name))).toEqual([]);
  expect((await writtenRows(world.db)).signerPii).toBe(HOSTILE_NAMES.length);
});

test('every name that a person may not type is a 422 invalid_name and writes nothing', async () => {
  const { world, ada, body } = await signingWorld();
  for (const [index, name] of HOSTILE_CONTROL_NAMES.entries()) {
    const response = await postSign(world, ada, body({ name }));
    expect([response.statusCode, errorCodeOf(response)], `entry ${index}`).toEqual([422, 'invalid_name']);
    expect(await writtenRows(world.db), `entry ${index}`).toEqual({ signatures: 0, signerPii: 0, audit: 0 });
  }
});

test('a hostile name is not echoed by the answer, the log or the audit entry of its own signature', async () => {
  const { world, ada, body } = await signingWorld();
  const name = '<script>zzzz</script> =HYPERLINK("http://zzzz.example")';
  const response = await postSign(world, ada, body({ name }));
  expect(response.statusCode).toBe(201);
  expect(response.body).not.toContain('zzzz');
  expect(world.logs.text()).not.toContain('zzzz');
  expect(JSON.stringify(await world.db.selectFrom('audit_log').selectAll().execute())).not.toContain('zzzz');
});
