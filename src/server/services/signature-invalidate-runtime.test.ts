// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  asRuntimeRole,
  containing,
  migratedRuntimeDatabase,
  seedSignature,
  seedTenant,
} from '../adapters/db/test-support.ts';
import { countActiveSignatures, invalidateActiveSignatures } from './signature-invalidate-queries.ts';

// What the role the application connects as can do to the signatures of a major (E15-S04), on a database with that role (`cla_app`):
// count the ones in force, revoke them all with the one statement of the invalidation, and nothing else. The statement is an `update`
// inside a `with` that reads the column it sets back; the role holds the privilege to update only the three revocation columns.

const RESTRICT = { code: '23001', message: containing('cannot be changed or un-revoked') };

async function world() {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db);
  const [first, second] = [await seedSignature(db, tenant, 4711), await seedSignature(db, tenant, 4712)];
  const scope = { installationId: tenant.installationId };
  const target = { documentId: tenant.documentId, major: 1 };
  const invalidateAsApp = () =>
    asRuntimeRole(db, (trx) =>
      invalidateActiveSignatures(trx, scope, { ...target, revokedBy: tenant.publisherId, reason: 'legal_request' }),
    );
  const rows = () => db.selectFrom('signatures').selectAll().orderBy('id').execute();
  return { db, tenant, first, second, scope, target, invalidateAsApp, rows };
}

test('the runtime role counts the signatures in force, revokes them all with one statement and one instant, and the second try finds none', async () => {
  const { db, tenant, scope, target, invalidateAsApp, rows } = await world();
  expect(await asRuntimeRole(db, (trx) => countActiveSignatures(trx, scope, target))).toBe(2);
  const first = await invalidateAsApp();
  const stored = await rows();
  expect(first.count).toBe(2);
  expect(stored.map((row) => row.revoked_at)).toEqual([first.revokedAt, first.revokedAt]);
  expect(stored.map((row) => [row.revoked_by, row.revoke_reason])).toEqual([
    [tenant.publisherId, 'legal_request'],
    [tenant.publisherId, 'legal_request'],
  ]);
  expect(await invalidateAsApp()).toEqual({ count: 0, revokedAt: null });
  expect(await rows()).toEqual(stored);
  expect(await asRuntimeRole(db, (trx) => countActiveSignatures(trx, scope, target))).toBe(0);
});

test('the runtime role cannot undo an invalidation: the update that clears a signature is refused by the trigger, and the rows stay revoked', async () => {
  const { db, first, invalidateAsApp, rows } = await world();
  await invalidateAsApp();
  const revoked = await rows();
  await expect(
    asRuntimeRole(db, (trx) =>
      trx
        .updateTable('signatures')
        .set({ revoked_at: null, revoked_by: null, revoke_reason: null })
        .where('id', '=', first.signatureId)
        .execute(),
    ),
  ).rejects.toMatchObject(RESTRICT);
  expect(await rows()).toEqual(revoked);
});
