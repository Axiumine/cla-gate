// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { tenantChecksums, twoTenants } from '../../adapters/db/tenant-fixture/test-support.ts';
import { runRetentionSweep } from './retention-sweep.ts';
import {
  at,
  DAY,
  deliveryIds,
  insertDeliveries,
  insertSession,
  onRuntimeConnection,
  recordStatements,
  retentionWorld,
  sessionIds,
  sweptRows,
} from './test-support.ts';

// What the retention sweep touches and what it cannot (E22-S04): two tables and the audit row, and nothing else. The evidence
// (signatures, signer_pii, cla_versions, audit_log), the record of why a pull request was accepted (pr_evaluations), the commit
// overrides and the queue (pgboss) are never named by a statement of the sweep, and the runtime role could not delete from the
// immutable ones if it tried. PGlite enforces the privileges of a role switched to with SET ROLE like Postgres does.

const REAL = { dryRun: false } as const;
const DRY = { dryRun: true } as const;
const DENIED = { code: '42501' };

/** Everything the sweep must leave alone, by name: a statement that names one of them is a failure. */
const NOT_TO_TOUCH = [
  'signatures',
  'signer_pii',
  'cla_versions',
  'cla_documents',
  'pr_evaluations',
  'merge_group_evaluations',
  'commit_overrides',
  'allowlist_entries',
  'repositories',
  'installations',
  'users',
  'pgboss',
] as const;

/** A world with the two tenants of the cross-tenant tests, and one expired delivery and session of the instance. */
async function worldWithTenants() {
  const world = await retentionWorld({ batchSize: 2 });
  const tenants = await twoTenants(world.db);
  await insertDeliveries(world.db, 'old', 3, at(-31 * DAY));
  await insertDeliveries(world.db, 'recent', 2, at(-DAY));
  await insertSession(world, 1, at(-3 * DAY));
  await insertSession(world, 2, at(DAY), at(7 * DAY));
  return { ...world, tenants };
}

test('a run deletes the due rows and leaves every row of every tenant table as it was, the audit log included but for its one new row', async () => {
  const { db, deps } = await worldWithTenants();
  const audit = await db.selectFrom('audit_log').selectAll().orderBy('id').execute();
  const users = await db.selectFrom('users').selectAll().orderBy('id').execute();
  const before = await tenantChecksums(db);
  expect(await runRetentionSweep(deps, REAL)).toEqual({ webhook_deliveries: 3, sessions: 1 });
  const after = await tenantChecksums(db);
  const withoutAudit = (checksums: typeof before) =>
    Object.entries(checksums).filter(([table]) => table !== 'audit_log');
  expect(withoutAudit(after)).toEqual(withoutAudit(before));
  expect(await db.selectFrom('audit_log').selectAll().orderBy('id').execute()).toEqual([
    ...audit,
    expect.objectContaining({ action: 'retention.swept', metadata: { webhook_deliveries: 3, sessions: 1 } }),
  ]);
  expect(await db.selectFrom('users').selectAll().orderBy('id').execute()).toEqual(users);
});

test('every statement of a run is a batch over one of the two tables or the insert of the audit row, and none names another table', async () => {
  const { db, deps } = await worldWithTenants();
  const { plugin, statements } = recordStatements();
  await runRetentionSweep({ ...deps, db: db.withPlugin(plugin) }, REAL);
  const shapes = statements.map((statement) => {
    const match = /^\s*with gone as \(\s*delete from "(\w+)"|^insert into "(\w+)"/.exec(statement);
    return match?.[1] ?? (match?.[2] === undefined ? statement : `insert into ${match[2]}`);
  });
  // Three due deliveries in batches of two, one due session, then the audit row.
  expect(shapes).toEqual(['webhook_deliveries', 'webhook_deliveries', 'sessions', 'insert into audit_log']);
  for (const statement of statements) {
    for (const name of NOT_TO_TOUCH) {
      expect(statement).not.toContain(name);
    }
  }
});

test('every statement of a dry run is a count over one of the two tables, and none names another table', async () => {
  const { db, deps } = await worldWithTenants();
  const { plugin, statements } = recordStatements();
  await runRetentionSweep({ ...deps, db: db.withPlugin(plugin) }, DRY);
  expect(statements.map((statement) => /from "(\w+)"/.exec(statement)?.[1])).toEqual([
    'webhook_deliveries',
    'sessions',
  ]);
  for (const statement of statements) {
    expect(statement).toMatch(/^\s*select count\(\*\)::int as n from "/);
    for (const name of NOT_TO_TOUCH) {
      expect(statement).not.toContain(name);
    }
  }
});

test('the runtime role holds DELETE on webhook_deliveries and sessions (E04-S07), so the sweep needs no grant of its own', async () => {
  const { db } = await retentionWorld();
  const held = await onRuntimeConnection(db, async (connection) => {
    const { rows } = await sql<{ table: string; privilege: string }>`
      select t as "table", p as privilege
      from unnest(array['webhook_deliveries', 'sessions']) as t, unnest(array['SELECT', 'DELETE']) as p
      where has_table_privilege('cla_app', t, p)
      order by t, p`.execute(connection);
    return rows;
  });
  expect(held).toEqual([
    { table: 'sessions', privilege: 'DELETE' },
    { table: 'sessions', privilege: 'SELECT' },
    { table: 'webhook_deliveries', privilege: 'DELETE' },
    { table: 'webhook_deliveries', privilege: 'SELECT' },
  ]);
});

test('the whole run works as the runtime role: the batches, the counts of a dry run and the insert of the audit row', async () => {
  const { db, deps } = await worldWithTenants();
  const counts = await onRuntimeConnection(db, async (connection) => {
    const runtime = { ...deps, db: connection };
    return { dry: await runRetentionSweep(runtime, DRY), real: await runRetentionSweep(runtime, REAL) };
  });
  expect(counts).toEqual({
    dry: { webhook_deliveries: 3, sessions: 1 },
    real: { webhook_deliveries: 3, sessions: 1 },
  });
  expect(await deliveryIds(db)).toEqual(['recent-000', 'recent-001']);
  expect(await sessionIds(db)).toHaveLength(1);
  expect((await sweptRows(db)).map((row) => row.metadata)).toEqual([{ webhook_deliveries: 3, sessions: 1 }]);
});

test.each([
  ['DELETE on signatures', sql`delete from signatures`],
  ['DELETE on signer_pii', sql`delete from signer_pii`],
  ['DELETE on cla_versions', sql`delete from cla_versions`],
  ['DELETE on audit_log', sql`delete from audit_log`],
  ['UPDATE on audit_log', sql`update audit_log set action = 'x.y'`],
  ['TRUNCATE of signatures', sql`truncate signatures`],
  ['TRUNCATE of signer_pii', sql`truncate signer_pii`],
  ['TRUNCATE of audit_log', sql`truncate audit_log`],
])('the runtime role the sweep runs as still cannot do %s', async (_operation, statement) => {
  const { db } = await worldWithTenants();
  const evidence = await tenantChecksums(db);
  await expect(onRuntimeConnection(db, (connection) => statement.execute(connection))).rejects.toMatchObject(DENIED);
  expect(await tenantChecksums(db)).toEqual(evidence);
});
