// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import {
  asRuntimeRole,
  containing,
  migratedRuntimeDatabase,
  seedSignature,
  seedTenant,
} from '../adapters/db/test-support.ts';
import { findSignatureToRevoke, markSignatureRevoked } from './signature-revoke-queries.ts';

// What the role the application connects as can do to a signature (E15-S03), on a database with that role (`cla_app`): revoke it once
// with the two statements of the revocation, and nothing else. There is no way back, whoever asks and however.

const RESTRICT = { code: '23001', message: containing('cannot be changed or un-revoked') };

async function world() {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db);
  const signer = await seedSignature(db, tenant, 4711);
  const scope = { installationId: tenant.installationId };
  const revokeAsApp = () =>
    asRuntimeRole(db, (trx) =>
      markSignatureRevoked(trx, scope, {
        signatureId: signer.signatureId,
        revokedBy: tenant.publisherId,
        reason: 'legal_request',
      }),
    );
  const rowOf = () =>
    db.selectFrom('signatures').selectAll().where('id', '=', signer.signatureId).executeTakeFirstOrThrow();
  return { db, tenant, signer, scope, revokeAsApp, rowOf };
}

test('the runtime role revokes a signature with the statements of the revocation: it reads the signer, sets the three columns once, and the second try changes nothing', async () => {
  const { db, signer, scope, revokeAsApp, rowOf, tenant } = await world();
  const found = await asRuntimeRole(db, (trx) => findSignatureToRevoke(trx, scope, signer.signatureId));
  expect(found).toMatchObject({
    id: signer.signatureId,
    documentId: tenant.documentId,
    versionId: tenant.versionId,
    major: 1,
    signerGithubId: 4711,
  });
  const first = await revokeAsApp();
  const row = await rowOf();
  expect(first).toEqual(row.revoked_at);
  expect(row).toMatchObject({ revoked_by: tenant.publisherId, revoke_reason: 'legal_request' });
  expect(await revokeAsApp()).toBeNull();
  expect(await rowOf()).toEqual(row);
});

test('the runtime role cannot clear a revocation: the update that sets revoked_at back to null is refused by the trigger, and the row stays revoked', async () => {
  const { db, signer, revokeAsApp, rowOf } = await world();
  await revokeAsApp();
  const revoked = await rowOf();
  await expect(
    asRuntimeRole(db, (trx) =>
      trx
        .updateTable('signatures')
        .set({ revoked_at: null, revoked_by: null, revoke_reason: null })
        .where('id', '=', signer.signatureId)
        .execute(),
    ),
  ).rejects.toMatchObject(RESTRICT);
  expect(await rowOf()).toEqual(revoked);
});

test.each([
  ['changes the reason', (id: number) => sql`update signatures set revoke_reason = 'other' where id = ${id}`, RESTRICT],
  [
    'moves the time forward',
    (id: number) => sql`update signatures set revoked_at = now() + interval '1 day' where id = ${id}`,
    RESTRICT,
  ],
  ['deletes the signature', (id: number) => sql`delete from signatures where id = ${id}`, { code: '42501' }],
])(
  'nor can the runtime role do the rest: a statement that %s is refused, and the row stays as revoked',
  async (_what, statement, refusal) => {
    const { db, signer, revokeAsApp, rowOf } = await world();
    await revokeAsApp();
    const revoked = await rowOf();
    await expect(asRuntimeRole(db, (trx) => statement(signer.signatureId).execute(trx))).rejects.toMatchObject(refusal);
    expect(await rowOf()).toEqual(revoked);
  },
);
