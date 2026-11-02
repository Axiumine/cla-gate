// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, Transaction } from 'kysely';
import { expect, test } from 'vitest';
import type { Database } from '../adapters/db/schema.ts';
import { migratedTestDatabase, seedTenant, type Tenant } from '../adapters/db/test-support.ts';
import { appendAudit } from './audit.ts';
import { AuditEntryInvalid } from './audit-entry.ts';
import { ACTOR, tenantEntry, unchecked } from './test-support.ts';

/** The mutation under test: turning enforcement on for the tenant's repository. */
function enable(trx: Transaction<Database>, tenant: Tenant): Promise<unknown> {
  return trx.updateTable('repositories').set({ enabled: true }).where('id', '=', tenant.repositoryId).execute();
}

async function state(db: Kysely<Database>, tenant: Tenant): Promise<{ enabled: boolean; audit: number }> {
  const repository = await db
    .selectFrom('repositories')
    .select('enabled')
    .where('id', '=', tenant.repositoryId)
    .executeTakeFirstOrThrow();
  const audit = await db.selectFrom('audit_log').select('id').execute();
  return { enabled: repository.enabled, audit: audit.length };
}

test('the mutation and its audit row commit together', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  await db.transaction().execute(async (trx) => {
    await enable(trx, tenant);
    await appendAudit(trx, tenantEntry(tenant.installationId));
  });
  expect(await state(db, tenant)).toEqual({ enabled: true, audit: 1 });
});

test('a writer whose insert throws after the mutation leaves neither row', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const work = db.transaction().execute(async (trx) => {
    await enable(trx, tenant);
    // The installation does not exist: the database refuses the audit row (foreign key 23503).
    await appendAudit(trx, tenantEntry(tenant.installationId + 999_999));
  });
  await expect(work).rejects.toMatchObject({ code: '23503' });
  expect(await state(db, tenant)).toEqual({ enabled: false, audit: 0 });
});

test('an exception thrown by the mutation after the audit insert removes the audit row too', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const work = db.transaction().execute(async (trx) => {
    await appendAudit(trx, tenantEntry(tenant.installationId));
    await enable(trx, tenant);
    throw new Error('the mutation failed after the audit insert');
  });
  await expect(work).rejects.toThrow('the mutation failed after the audit insert');
  expect(await state(db, tenant)).toEqual({ enabled: false, audit: 0 });
});

test('an invalid entry rolls the mutation back', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const work = db.transaction().execute(async (trx) => {
    await enable(trx, tenant);
    await appendAudit(trx, unchecked({ ...tenantEntry(tenant.installationId), metadata: { login: 'alice' } }));
  });
  await expect(work).rejects.toThrow(AuditEntryInvalid);
  expect(await state(db, tenant)).toEqual({ enabled: false, audit: 0 });
});

test('two tenants write entries with the same subject id: each row carries its own caller, and filters keep them apart', async () => {
  const { db } = await migratedTestDatabase();
  const first = await seedTenant(db, 1);
  const second = await seedTenant(db, 2);
  const subject = { type: 'repository', id: 77 };
  await db.transaction().execute(async (trx) => {
    await appendAudit(trx, tenantEntry(first.installationId, { subject, metadata: { count: 1 } }));
    await appendAudit(trx, tenantEntry(second.installationId, { subject, metadata: { count: 2 } }));
  });
  const stored = await db.selectFrom('audit_log').select(['installation_id', 'subject_id']).orderBy('id').execute();
  expect(stored).toEqual([
    { installation_id: first.installationId, subject_id: 77 },
    { installation_id: second.installationId, subject_id: 77 },
  ]);
  const ofFirst = await db
    .selectFrom('audit_log')
    .select(['installation_id', 'actor_github_id', 'metadata'])
    .where('installation_id', '=', first.installationId)
    .execute();
  expect(ofFirst).toEqual([{ installation_id: first.installationId, actor_github_id: ACTOR, metadata: { count: 1 } }]);
});
