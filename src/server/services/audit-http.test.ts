// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../shared/errors.ts';
import { seedTenant } from '../adapters/db/test-support.ts';
import { authWorld } from '../adapters/http/auth-fixture/test-support.ts';
import { appendAudit } from './audit.ts';
import { tenantEntry, unchecked } from './test-support.ts';

const HOSTILE = 'alice@example.com';

/**
 * The app on a migrated PGlite with one tenant and two mutating routes: one writes a valid audit entry, one a bad one.
 * The caller is a logged-in person, because a state-changing request needs a session, `Origin` and token (E10-S03).
 */
async function appWithMutations() {
  const running = await authWorld();
  const { db } = running;
  const tenant = await seedTenant(db);
  const { headers } = await running.login(1001);
  const mutate = (entry: Parameters<typeof appendAudit>[1]) => async () => {
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('repositories').set({ enabled: true }).where('id', '=', tenant.repositoryId).execute();
      await appendAudit(trx, entry);
    });
    return { done: true };
  };
  const config = { access: 'authenticated', audit: 'repository.enabled' } as const;
  running.app.post('/api/good', { config }, mutate(tenantEntry(tenant.installationId)));
  const bad = unchecked({ ...tenantEntry(tenant.installationId), metadata: { email: HOSTILE } });
  running.app.post('/api/bad', { config }, mutate(bad));
  const state = async () => {
    const repository = await db
      .selectFrom('repositories')
      .select('enabled')
      .where('id', '=', tenant.repositoryId)
      .executeTakeFirstOrThrow();
    const audit = await db.selectFrom('audit_log').select('action').execute();
    return { enabled: repository.enabled, audit: audit.map((row) => row.action) };
  };
  return { app: running.app, logs: running.logs, headers, state };
}

test('a valid audit entry commits with the mutation of its route', async () => {
  const { app, headers, state } = await appWithMutations();
  const response = await app.inject({ method: 'POST', url: '/api/good', headers });
  expect(response.statusCode).toBe(200);
  expect(await state()).toEqual({ enabled: true, audit: ['repository.enabled'] });
});

test('AuditEntryInvalid surfaces as a generic 500 and rolls the mutation back', async () => {
  const { app, headers, state } = await appWithMutations();
  const response = await app.inject({ method: 'POST', url: '/api/bad', headers });
  expect(response.statusCode).toBe(500);
  expect(errorResponseSchema.parse(response.json()).error).toMatchObject({ code: 'internal_server_error' });
  expect(response.body).not.toMatch(/alice|AuditEntryInvalid|metadata/);
  expect(await state()).toEqual({ enabled: false, audit: [] });
});

test('the log names the broken field and never repeats the personal value', async () => {
  const { app, headers, logs } = await appWithMutations();
  await app.inject({ method: 'POST', url: '/api/bad', headers });
  const logged = logs.lines().find((line) => line['msg'] === 'unhandled error');
  expect(logged).toMatchObject({
    level: 50,
    err: { type: 'AuditEntryInvalid', message: 'invalid audit entry: metadata.email (unrecognized_keys)' },
  });
  expect(logs.text()).not.toContain(HOSTILE);
});
