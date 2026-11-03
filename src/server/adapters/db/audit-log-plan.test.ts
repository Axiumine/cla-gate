// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect, test } from 'vitest';
import { auditLogRows } from '../../services/audit-log-queries.ts';
import type { Database } from './schema.ts';
import { migratedTestDatabase, realPostgresOnly, rowId, seedTenant } from './test-support.ts';

// The query plan of the audit log viewer (E16-S02), on a real Postgres: PGlite has the same planner, but the story asks for
// the plan on the server the product runs on, and a plan depends on statistics that only a populated, analysed table has.

const INDEX = 'audit_log_installation_occurred_at_idx';

/** Rows per tenant: enough that a sequential scan and a sort cost more than the first rows of the index. */
const ROWS_PER_TENANT = 10_000;

/** The text of the plan of `query`, one line per node. */
async function planOf(query: ReturnType<typeof auditLogRows>): Promise<string> {
  const lines = await query.explain<{ 'QUERY PLAN': string }>('text');
  return lines.map((line) => line['QUERY PLAN']).join('\n');
}

/** Two tenants with `ROWS_PER_TENANT` audit rows each, some of them at one instant, and rows of no tenant; analysed. */
async function populate(db: Kysely<Database>) {
  const first = await seedTenant(db, 1);
  const second = await seedTenant(db, 2);
  for (const installationId of [first.installationId, second.installationId, null]) {
    await sql`
      insert into audit_log (occurred_at, installation_id, actor_github_id, action, metadata)
      select timestamptz '2026-01-01T00:00:00Z' + (n / 3) * interval '1 minute', ${installationId}::bigint, 1001,
             'repository.enabled', '{}'
      from generate_series(1, ${ROWS_PER_TENANT}) as n`.execute(db);
  }
  await sql`analyze audit_log`.execute(db);
  return { first, second };
}

test('the default listing is one statement for the tenant, newest first with the id as tie-break, and one row more than the page', async () => {
  const { db } = await migratedTestDatabase();
  const { sql: text, parameters } = auditLogRows(db, { installationId: rowId(7) }, { limit: 50 }).compile();
  expect(text).toContain('from "audit_log" where "installation_id" = $1');
  expect(text).toMatch(/order by "occurred_at" desc, "id" desc limit \$\d$/);
  expect(parameters).toEqual([7, 51]);
});

realPostgresOnly('the default listing is answered by audit_log_installation_occurred_at_idx', async () => {
  const { db } = await migratedTestDatabase();
  const { first } = await populate(db);
  const plan = await planOf(auditLogRows(db, { installationId: first.installationId }, { limit: 50 }));
  expect(plan).toContain(`Index Scan using ${INDEX} on audit_log`);
  expect(plan).not.toContain('Seq Scan');
});

realPostgresOnly('a page after a cursor and a filtered listing start from the same index', async () => {
  const { db } = await migratedTestDatabase();
  const { second } = await populate(db);
  const scope = { installationId: second.installationId };
  const cursor = { occurredAt: '2026-01-03T00:00:00.000000Z', id: 5000 };
  const after = await planOf(auditLogRows(db, scope, { limit: 50, cursor }));
  expect(after).toContain(`using ${INDEX} on audit_log`);
  expect(after).not.toContain('Seq Scan');
  const filtered = await planOf(
    auditLogRows(db, scope, { limit: 50, action: 'repository.enabled', actorGithubId: 1001 }),
  );
  expect(filtered).toContain(`using ${INDEX} on audit_log`);
});
