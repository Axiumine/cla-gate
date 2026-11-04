// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AUDIT_LOG_PATH, auditLogPageSchema } from '../../../shared/audit-log.ts';
import { createPurgeNetworkMetadataHandler } from '../../services/network-metadata-purge.ts';
import {
  CUTOFF,
  type NetworkValues,
  NOW,
  networkOf,
  purgeAuditRows,
  setNetwork,
  shifted,
} from '../db/network-metadata-fixture/test-support.ts';
import type { PersonName } from '../db/tenant-fixture/test-support.ts';
import { matrixWorld } from './cross-tenant-runner/test-support.ts';

// The purge across tenants (E16-S05): retention is a setting of the instance, so one run reaches every tenant by design, and the
// row it writes belongs to the instance, so no tenant's audit viewer shows it.

const TENANT_1: NetworkValues = { ip: '203.0.113.7', userAgent: 'Tenant1Browser/1.0' };
const TENANT_2: NetworkValues = { ip: '2001:db8::2', userAgent: 'Tenant2Browser/2.0' };
const NONE: NetworkValues = { ip: null, userAgent: null };
const OLD = shifted(CUTOFF, -1);

/** The matrix world with the two columns, a signature in each tenant whose values were stored at the given times, and the job. */
async function world(storedAt1: string, storedAt2: string) {
  const state = await matrixWorld();
  await setNetwork(state.db, state.t1.signatureId, storedAt1, TENANT_1);
  await setNetwork(state.db, state.t2.signatureId, storedAt2, TENANT_2);
  const run = createPurgeNetworkMetadataHandler({
    db: state.db,
    clock: { now: () => NOW },
    retentionDays: 30,
    log: { info: () => undefined },
  });
  /** The audit log of a tenant as one of its people reads it. */
  const pageOf = async (who: PersonName, installationId: number, query = '') => {
    const response = await state.ask(who, {
      method: 'GET',
      url: `${AUDIT_LOG_PATH.replace(':installationId', String(installationId))}${query}`,
    });
    expect(response.statusCode).toBe(200);
    return auditLogPageSchema.parse(response.json()).items;
  };
  /** The ids of the audit rows the database holds for a tenant, newest first: the oracle a viewer is held to. */
  const stored = async (installationId: number): Promise<number[]> => {
    const rows = await state.db
      .selectFrom('audit_log')
      .select('id')
      .where('installation_id', '=', installationId)
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return rows.map((row) => row.id);
  };
  return { ...state, run, pageOf, stored };
}

test('one run purges the values of both tenants, because retention belongs to the instance, and writes one row for the instance', async () => {
  const { db, t1, t2, run } = await world(OLD, shifted(CUTOFF, -86_400_000));

  expect(await run()).toBe(2);

  expect(await networkOf(db)).toEqual({ [t1.signatureId]: NONE, [t2.signatureId]: NONE });
  expect(await purgeAuditRows(db)).toEqual([
    { installation_id: null, actor_github_id: null, subject_type: null, subject_id: null, metadata: { rows: 2 } },
  ]);
});

test('the run takes the values that are older than the cutoff in either tenant and keeps the others', async () => {
  const { db, t1, t2, run } = await world(OLD, CUTOFF);

  expect(await run()).toBe(1);

  expect(await networkOf(db)).toEqual({ [t1.signatureId]: NONE, [t2.signatureId]: TENANT_2 });
});

test('neither tenant sees the instance-level row of the purge in its audit log, and each still sees its own rows', async () => {
  const { run, pageOf, stored, t1, t2 } = await world(OLD, OLD);
  await run();

  const tenant1 = await pageOf('admin1', t1.installationId);
  const tenant2 = await pageOf('admin2', t2.installationId);

  expect(tenant1.map((item) => item.id)).toEqual(await stored(t1.installationId));
  expect(tenant2.map((item) => item.id)).toEqual(await stored(t2.installationId));
  expect([...tenant1, ...tenant2].map((item) => item.action)).not.toContain('network_metadata.purged');
  expect(tenant1).not.toHaveLength(0);
  expect(tenant2).not.toHaveLength(0);
  expect(await pageOf('admin1', t1.installationId, '?action=network_metadata.purged')).toEqual([]);
  expect(await pageOf('admin2', t2.installationId, '?action=network_metadata.purged')).toEqual([]);
});
