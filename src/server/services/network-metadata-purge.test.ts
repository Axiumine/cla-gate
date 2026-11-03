// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import {
  addNetworkColumns,
  type NetworkValues,
  NOW,
  networkOf,
  purgeAuditRows,
  setNetwork,
  shifted,
} from '../adapters/db/network-metadata-fixture/test-support.ts';
import { containing, migratedTestDatabase, seedSignature, seedTenant } from '../adapters/db/test-support.ts';
import { loadConfig } from '../config/env.ts';
import {
  createPurgeNetworkMetadataHandler,
  PURGE_NETWORK_METADATA_JOB,
  PURGE_NETWORK_METADATA_SCHEDULE,
} from './network-metadata-purge.ts';
import type { Clock } from './ports/clock.ts';

// The job `purge-network-metadata` (E16-S05): the cutoff comes from the injected clock and the configured retention, and the
// SQL function does the rest. The function itself is proved in migration-010-purge.test.ts, the tenants in
// adapters/http/network-metadata-tenants.test.ts.

const DAY = 86_400_000;
const BOTH: NetworkValues = { ip: '198.51.100.23', userAgent: 'Browser/9.0 (test)' };
const NONE: NetworkValues = { ip: null, userAgent: null };
/** The retention a configuration without the variable gets. */
const DEFAULT_RETENTION_DAYS = loadConfig({
  DATABASE_URL: 'postgres://cla_app:pw@db.internal:5432/cla',
}).networkMetadataRetentionDays;

/** A migrated database with the two columns and one signature whose values were stored at `storedAt`; `at(iso)` moves the clock and `run()` runs the job. */
async function world(storedAt: string, retentionDays = DEFAULT_RETENTION_DAYS) {
  const { db } = await migratedTestDatabase();
  await addNetworkColumns(db);
  const { signatureId } = await seedSignature(db, await seedTenant(db), 111);
  await setNetwork(db, signatureId, storedAt, BOTH);
  let now = NOW;
  const clock: Clock = { now: () => now };
  const lines: { fields: object; message: string }[] = [];
  const log = { info: (fields: object, message: string) => lines.push({ fields, message }) };
  const run = createPurgeNetworkMetadataHandler({ db, clock, retentionDays, log });
  return {
    db,
    signatureId,
    lines,
    run,
    at: (iso: string) => {
      now = new Date(iso);
    },
  };
}

test('the default retention is 30 days and the job removes values stored at signing once they are older than that', async () => {
  const storedAt = '2026-10-01T08:00:00.000Z';
  const { db, signatureId, run, at } = await world(storedAt);
  expect(DEFAULT_RETENTION_DAYS).toBe(30);

  at(shifted(storedAt, 29 * DAY + 23 * 3_600_000));
  expect(await run()).toBe(0);
  expect(await networkOf(db)).toEqual({ [signatureId]: BOTH });

  at(shifted(storedAt, 30 * DAY));
  expect(await run()).toBe(0);
  expect(await networkOf(db)).toEqual({ [signatureId]: BOTH });

  at(shifted(storedAt, 30 * DAY + 1));
  expect(await run()).toBe(1);
  expect(await networkOf(db)).toEqual({ [signatureId]: NONE });
});

test('the cutoff is the injected clock minus the configured number of days, whatever the wall clock says', async () => {
  const { db, signatureId, run, at } = await world('2026-10-27T00:00:00.000Z', 7);

  at('2026-11-03T00:00:00.000Z');
  expect(await run()).toBe(0);
  expect(await networkOf(db)).toEqual({ [signatureId]: BOTH });

  at('2026-11-03T00:00:00.001Z');
  expect(await run()).toBe(1);
  expect(await networkOf(db)).toEqual({ [signatureId]: NONE });
});

test('the job logs the number of rows and the cutoff, and nothing that came out of a row', async () => {
  const { lines, run, at } = await world('2026-09-01T00:00:00.000Z');
  at('2026-11-03T03:17:00.000Z');

  await run();

  expect(lines).toEqual([
    { fields: { rows: 1, cutoff: '2026-10-04T03:17:00.000Z' }, message: 'network_metadata_purge_done' },
  ]);
  expect(JSON.stringify(lines)).not.toContain(BOTH.ip);
  expect(JSON.stringify(lines)).not.toContain('Browser');
});

test('a second run on the same data returns 0, appends no audit row and logs a count of 0', async () => {
  const { db, lines, run, at } = await world('2026-09-01T00:00:00.000Z');
  at('2026-11-03T03:17:00.000Z');

  expect([await run(), await run()]).toEqual([1, 0]);

  expect(await purgeAuditRows(db)).toHaveLength(1);
  expect(lines.map((line) => line.fields)).toEqual([
    { rows: 1, cutoff: '2026-10-04T03:17:00.000Z' },
    { rows: 0, cutoff: '2026-10-04T03:17:00.000Z' },
  ]);
});

test('an error in the function fails the job, logs nothing and leaves every value in place', async () => {
  const { db, signatureId, lines, run, at } = await world('2026-09-01T00:00:00.000Z');
  at('2026-11-03T03:17:00.000Z');
  await sql`
    create function refuse_purge_audit() returns trigger language plpgsql as $$
    begin raise exception 'audit insert refused'; end $$`.execute(db);
  await sql`
    create trigger refuse_purge_audit before insert on audit_log for each row
    when (new.action = 'network_metadata.purged') execute function refuse_purge_audit()`.execute(db);

  await expect(run()).rejects.toMatchObject({ message: containing('audit insert refused') });

  expect(await networkOf(db)).toEqual({ [signatureId]: BOTH });
  expect(lines).toEqual([]);
});

test('the queue is named purge-network-metadata and the schedule is 03:17 every day, in UTC', () => {
  expect(PURGE_NETWORK_METADATA_JOB).toBe('purge-network-metadata');
  expect(PURGE_NETWORK_METADATA_SCHEDULE).toEqual({ cron: '17 3 * * *', timezone: 'UTC' });
  const [minute, hour, ...everyDay] = PURGE_NETWORK_METADATA_SCHEDULE.cron.split(' ');
  expect([minute, hour, everyDay]).toEqual(['17', '3', ['*', '*', '*']]);
});
