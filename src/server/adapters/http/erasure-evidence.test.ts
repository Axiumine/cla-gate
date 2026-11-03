// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { csvRecords } from '../../domain/csv-fixture/test-support.ts';
import { erasureWorld } from './erasure-fixture/test-support.ts';
import { csvPathOf } from './signature-csv-fixture/test-support.ts';

// Erasure is not revocation and not a ban (E16-S04): the signatures stay as they were and keep covering the person, the CSV
// export (E16-S03) shows them with `pii_erased` and no personal data, and the person can sign again later.

const MEMBER1 = 31_004;

/** The signatures CSV of the installation document of tenant 1, as its org admin downloads it, as records. */
async function exported(world: Awaited<ReturnType<typeof erasureWorld>>) {
  const { ask, t1 } = world;
  const response = await ask('admin1', { method: 'GET', url: csvPathOf(t1.installationId, t1.documentId) });
  expect(response.statusCode).toBe(200);
  return { records: csvRecords(response.body), body: response.body };
}

test('the signature rows are byte for byte as before the erasure: not revoked, not changed, none added or removed', async () => {
  const world = await erasureWorld();
  const before = await world.signatureRows();
  expect(before.length).toBeGreaterThan(0);

  expect(
    (await world.erase('admin1', world.t1.installationId, { githubUserId: MEMBER1, expectedRows: 1 })).statusCode,
  ).toBe(200);

  expect(await world.signatureRows()).toEqual(before);
  const row = await world.db
    .selectFrom('signatures')
    .select(['revoked_at', 'revoked_by', 'revoke_reason'])
    .where('id', '=', world.t1.signatureId)
    .executeTakeFirstOrThrow();
  expect(row).toEqual({ revoked_at: null, revoked_by: null, revoke_reason: null });
});

test('the CSV export shows the erased signature as active with pii_erased true and no login, name or email', async () => {
  const world = await erasureWorld();
  const [first] = (await exported(world)).records;
  expect(first).toMatchObject({
    pii_erased: 'false',
    login: 'login-31004',
    name: 'Name 31004',
    email: 'u31004@example.test',
  });

  await world.erase('admin1', world.t1.installationId, { githubUserId: MEMBER1, expectedRows: 1 });

  const { records, body } = await exported(world);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    signature_id: String(world.t1.signatureId),
    github_user_id: String(MEMBER1),
    state: 'active',
    revoked_at: '',
    pii_erased: 'true',
    login: '',
    name: '',
    email: '',
  });
  for (const personal of ['login-31004', 'Name 31004', 'u31004@example.test']) {
    expect(body).not.toContain(personal);
  }
});

test('the person can sign again after the erasure: the new signature has a fresh row of personal data and the old one stays erased', async () => {
  const world = await erasureWorld();
  const { erase, preview, t1 } = world;
  await erase('admin1', t1.installationId, { githubUserId: MEMBER1, expectedRows: 1 });

  const newSignatureId = await world.signAgain();

  expect((await preview('admin1', t1.installationId, `?githubUserId=${MEMBER1}`)).json()).toEqual({
    githubUserId: MEMBER1,
    signatures: 2,
    signerPiiRows: 1,
  });
  const erasedFlags = (await exported(world)).records.map((record) => [record['signature_id'], record['pii_erased']]);
  expect(erasedFlags).toEqual([
    [String(t1.signatureId), 'true'],
    [String(newSignatureId), 'false'],
  ]);
  expect((await erase('admin1', t1.installationId, { githubUserId: MEMBER1, expectedRows: 1 })).json()).toEqual({
    erasedRows: 1,
  });
});
