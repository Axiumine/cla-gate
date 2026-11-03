// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { pino } from 'pino';
import { expect, inject, onTestFinished, test } from 'vitest';
import { CONTRACT_CASES, type JobsWorld } from '../../services/jobs-contract/test-support.ts';
import { createPgDatabase } from '../db/pg.ts';
import type { Database } from '../db/schema.ts';
import { migratedRuntimeDatabase, realPostgresRolesOnly, requireTestDatabaseUrl } from '../db/test-support.ts';
import { migrateJobQueues } from './migrate-queues.ts';
import { startJobQueue } from './runtime.ts';

// The JobEnqueuer contract suite of E06-S06 against pg-boss on a real PostgreSQL (E07-S01), the way the application
// runs: the schema and the queues come from the migrate step, pg-boss starts as the runtime role `cla_app`, and the
// transactions that carry the jobs are the runtime role's. PGlite has one connection, so these run in the CI `postgres`
// job and skip elsewhere (the adapter's lines are covered by the unit tests with a fake boss).

/** The test database's URL, with every session switched to the runtime role as it connects. */
function runtimeUrl(): string {
  const url = new URL(requireTestDatabaseUrl(inject('testDatabaseUrl')));
  url.searchParams.set('options', '-c role=cla_app');
  return url.href;
}

async function realWorld(): Promise<JobsWorld> {
  const { db: owner } = await migratedRuntimeDatabase();
  await sql`drop schema if exists pgboss cascade`.execute(owner);
  const errors: Error[] = [];
  await migrateJobQueues({
    connectionString: requireTestDatabaseUrl(inject('testDatabaseUrl')),
    db: owner,
    onError: (error) => errors.push(error),
  });
  expect(errors).toEqual([]);
  const queue = await startJobQueue({ connectionString: runtimeUrl(), logger: pino({ level: 'silent' }) });
  const db: Kysely<Database> = createPgDatabase({
    connectionString: runtimeUrl(),
    onError: (error) => errors.push(error),
  });
  onTestFinished(async () => {
    await queue.stop();
    await db.destroy();
    expect(errors).toEqual([]);
  });
  const setStates = async (state: 'active' | 'completed') => {
    await sql`
      update pgboss.job set state = ${state}::pgboss.job_state
      where state in ('created', 'retry', 'active')`.execute(owner);
  };
  return {
    enqueuer: queue.enqueuer,
    db,
    liveJobs: async () => {
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from pgboss.job where state in ('created', 'retry', 'active')`.execute(owner);
      return rows[0]?.n ?? 0;
    },
    startJobs: () => setStates('active'),
    finishJobs: () => setStates('completed'),
  };
}

test('the contract cases have distinct names, so each is registered as a test of its own against pg-boss', () => {
  const names = CONTRACT_CASES.map(([name]) => name);
  expect(new Set(names).size).toBe(names.length);
});

for (const [name, run] of CONTRACT_CASES) {
  realPostgresRolesOnly(`the pg-boss enqueuer: ${name}`, async () => {
    await run(await realWorld());
  });
}
