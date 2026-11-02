// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { AUDIT_ACTIONS, INSTANCE_ACTIONS, SYSTEM_ACTIONS } from '../../shared/audit.ts';
import { migratedRuntimeDatabase, migratedTestDatabase, seedTenant } from '../adapters/db/test-support.ts';
import * as auditModule from './audit.ts';
import { appendAudit } from './audit.ts';
import { AuditEntryInvalid } from './audit-entry.ts';
import { ACTOR, tenantEntry, unchecked } from './test-support.ts';

test('a row carries the caller, the action, the subject and the metadata, and the database stamps the time', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const entry = tenantEntry(tenant.installationId, {
    subject: { type: 'repository', id: 9000 },
    metadata: { repository_id: tenant.repositoryId, enabled: true, scope: 'org', rows: [1, 2] },
  });
  await db.transaction().execute((trx) => appendAudit(trx, entry));
  const row = await db.selectFrom('audit_log').selectAll().executeTakeFirstOrThrow();
  expect(row).toMatchObject({
    installation_id: tenant.installationId,
    actor_github_id: ACTOR,
    action: 'repository.enabled',
    subject_type: 'repository',
    subject_id: 9000,
    metadata: { enabled: true, repository_id: tenant.repositoryId, rows: [1, 2], scope: 'org' },
  });
  expect(Math.abs(row.occurred_at.getTime() - Date.now())).toBeLessThan(60_000);
});

test('without a subject or metadata the row has null subject columns and empty metadata', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  await db.transaction().execute((trx) => appendAudit(trx, tenantEntry(tenant.installationId)));
  const row = await db.selectFrom('audit_log').selectAll().executeTakeFirstOrThrow();
  expect(row).toMatchObject({ subject_type: null, subject_id: null, metadata: {} });
});

test.each([...SYSTEM_ACTIONS])('the system action %s is stored with no actor', async (action) => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const installationId = INSTANCE_ACTIONS.has(action) ? null : tenant.installationId;
  await db.transaction().execute((trx) => appendAudit(trx, { action, installationId, actorGithubId: null }));
  const row = await db.selectFrom('audit_log').select(['actor_github_id', 'installation_id']).executeTakeFirstOrThrow();
  expect(row).toEqual({ actor_github_id: null, installation_id: installationId });
});

test.each([...INSTANCE_ACTIONS])('the instance action %s is stored with no installation', async (action) => {
  const { db } = await migratedTestDatabase();
  await db.transaction().execute((trx) => appendAudit(trx, { action, installationId: null, actorGithubId: ACTOR }));
  const row = await db.selectFrom('audit_log').select(['actor_github_id', 'installation_id']).executeTakeFirstOrThrow();
  expect(row).toEqual({ actor_github_id: ACTOR, installation_id: null });
});

test('every member of the closed action set is accepted by the database check', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  await db.transaction().execute(async (trx) => {
    for (const action of AUDIT_ACTIONS) {
      await appendAudit(trx, { action, installationId: tenant.installationId, actorGithubId: ACTOR });
    }
  });
  const rows = await db.selectFrom('audit_log').select('action').orderBy('id').execute();
  expect(rows.map((row) => row.action)).toEqual([...AUDIT_ACTIONS]);
});

test('a tenant action with a null installation writes nothing', async () => {
  const { db } = await migratedTestDatabase();
  const write = db.transaction().execute((trx) => appendAudit(trx, tenantEntry(1, { installationId: null })));
  await expect(write).rejects.toThrow(AuditEntryInvalid);
  expect(await db.selectFrom('audit_log').select('id').execute()).toEqual([]);
});

test('an installation that does not exist is a foreign-key error from the database, not a silent row', async () => {
  const { db } = await migratedTestDatabase();
  const write = db.transaction().execute((trx) => appendAudit(trx, tenantEntry(999_999)));
  await expect(write).rejects.toMatchObject({ code: '23503' });
});

test('the unprivileged runtime role can append through the writer', async () => {
  const { db } = await migratedRuntimeDatabase();
  const tenant = await seedTenant(db);
  await db.transaction().execute(async (trx) => {
    await sql`set local role cla_app`.execute(trx);
    await appendAudit(trx, tenantEntry(tenant.installationId, { metadata: { commit_sha: 'ab'.repeat(20) } }));
  });
  const row = await db.selectFrom('audit_log').select('metadata').executeTakeFirstOrThrow();
  expect(row.metadata).toEqual({ commit_sha: 'ab'.repeat(20) });
});

test('a hostile entry reaches neither the database nor the error message', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  const entry = unchecked({ ...tenantEntry(tenant.installationId), metadata: { email: 'alice@example.com' } });
  const write = db.transaction().execute((trx) => appendAudit(trx, entry));
  await expect(write).rejects.toThrow(AuditEntryInvalid);
  await expect(write).rejects.not.toThrow('alice@example.com');
  expect(await db.selectFrom('audit_log').select('id').execute()).toEqual([]);
});

test('the module can append and nothing else: no update, delete or truncate is exported', () => {
  expect(new Set(Object.keys(auditModule))).toEqual(new Set(['appendAudit', 'AuditEntryInvalid']));
});
