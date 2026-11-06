// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { seedFlowWorld } from '../../../../e2e/support/world/flow-world.ts';
import { TENANT } from '../../../../e2e/support/world/ids.ts';
import { assertMigrated } from '../../../../e2e/support/world/people-rows.ts';
import { ensureVisualWorld } from '../../../../e2e/support/world/visual-world.ts';
import { PrEvaluationDetails } from '../../../shared/pr-evaluation-details.ts';
import { installationRowIdSchema } from './installation-row-id.ts';
import { emptyTestDatabase, migratedTestDatabase } from './test-support.ts';

// E18-S12: the worlds the browser specs write straight into the database are checked here against the migrated schema, so a
// migration that changes a table fails this test and not a browser run that has to be read to find out why.

const TENANT_ROW = installationRowIdSchema.parse(TENANT.id);
const NOW = new Date('2026-11-06T10:00:00.000Z');

async function counts(db: Awaited<ReturnType<typeof migratedTestDatabase>>['db']) {
  const tables = [
    'users',
    'sessions',
    'installations',
    'repositories',
    'cla_documents',
    'cla_versions',
    'signatures',
    'audit_log',
  ] as const;
  const result = new Map<string, number>();
  for (const table of tables) {
    const row = await db
      .selectFrom(table)
      .select((builder) => builder.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    result.set(table, row.n);
  }
  return result;
}

test('the visual world is written once: a second call changes no row, but renews the sessions', async () => {
  const { db } = await migratedTestDatabase();
  await ensureVisualWorld(db, NOW);
  const first = await counts(db);
  await ensureVisualWorld(db, new Date(NOW.getTime() + 3_600_000));
  expect(await counts(db)).toEqual(first);
  expect(first.get('sessions')).toBe(4);
  expect(first.get('installations')).toBe(3);
});

test('the visual world has the states the screens show: an active, an outdated and a revoked signature, and a document in use', async () => {
  const { db } = await migratedTestDatabase();
  await ensureVisualWorld(db, NOW);
  const signatures = await db
    .selectFrom('signatures')
    .select(['id', 'revoked_at'])
    .where('installation_id', '=', TENANT_ROW)
    .orderBy('id')
    .execute();
  expect(signatures.map((row) => [row.id, row.revoked_at !== null])).toEqual([
    [9401, false],
    [9402, false],
    [9403, true],
  ]);
  const enabled = await db
    .selectFrom('repositories')
    .select('id')
    .where('installation_id', '=', TENANT_ROW)
    .where('enabled', '=', true)
    .execute();
  expect(enabled.length).toBeGreaterThan(0);
});

test('the open pull requests of the visual world carry details the application itself accepts', async () => {
  const { db } = await migratedTestDatabase();
  await ensureVisualWorld(db, NOW);
  const rows = await db.selectFrom('pr_evaluations').select(['id', 'details']).orderBy('id').execute();
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(PrEvaluationDetails.safeParse(row.details).success).toBe(true);
  }
});

test('the flow world is new in every call: other people and other tenants, so a run never meets the rows of an earlier one', async () => {
  const { db } = await migratedTestDatabase();
  const first = await seedFlowWorld(db, NOW);
  const second = await seedFlowWorld(db, NOW);
  expect(second.maintainer.githubId).not.toBe(first.maintainer.githubId);
  expect(second.tenant.login).not.toBe(first.tenant.login);
  const sessions = await db.selectFrom('sessions').select('session_hash').execute();
  expect(sessions).toHaveLength(6);
  expect(first.tenant.id).not.toBe(first.foreign.id);
});

test('a database without the tables of the application is refused with a sentence that says what to run', async () => {
  const { db } = await emptyTestDatabase();
  await expect(assertMigrated(db)).rejects.toThrow('run yarn db:migrate first');
  await expect(ensureVisualWorld(db, NOW)).rejects.toThrow('run yarn db:migrate first');
});
