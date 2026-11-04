// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { loadConfig } from '../../config/env.ts';
import { createPurgeNetworkMetadataHandler } from '../../services/network-metadata-purge.ts';
import { UNREACHABLE_DATABASE_URL } from '../../test-support.ts';
import { purgeAuditRows } from '../db/network-metadata-fixture/test-support.ts';
import { bodyFor, postSign, signedOf, signingWorld } from './sign-fixture/test-support.ts';
import { RECORDING, signFrom, storedNetwork, TEST_AGENT, TEST_IP } from './sign-network-fixture/test-support.ts';

// The values the sign request stored (E13-S05) are removed by the two functions that exist for it, and by nothing else: the
// erasure of a signer (E16-S04) deletes the row that holds them, and the purge (E16-S05) clears them after the retention the
// configuration sets. The functions are proved on seeded rows in the tests of migrations 009 and 010; these tests use rows the
// sign handler wrote.

const DAY = 86_400_000;
const ADMIN = 777;
const OTHER_IP = '2001:db8::99';

/** `NETWORK_METADATA_RETENTION_DAYS` as the configuration reads it from the environment (`undefined`: not set). */
function retentionDaysOf(value: string | undefined): number {
  return loadConfig({
    DATABASE_URL: UNREACHABLE_DATABASE_URL,
    ...(value === undefined ? {} : { NETWORK_METADATA_RETENTION_DAYS: value }),
  }).networkMetadataRetentionDays;
}

test("the erasure of a signer for an installation deletes the row with its address and user agent, and no other installation's", async () => {
  const { world, ada, body } = await signingWorld(RECORDING);
  const elsewhere = { remoteAddress: OTHER_IP, headers: { 'user-agent': 'zzzz-elsewhere/2' } };
  signedOf(await postSign(world, ada, body(), { remoteAddress: TEST_IP, headers: { 'user-agent': TEST_AGENT } }), 201);
  signedOf(await postSign(world, ada, bodyFor(world.t2, 2), elsewhere), 201);
  expect(await storedNetwork(world.db)).toHaveLength(2);

  const erased = await sql<{ n: number }>`
    select erase_signer_pii(${ada.githubId}, ${ADMIN}, ${world.t1.installationId}) as n`.execute(world.db);

  expect(erased.rows).toEqual([{ n: 1 }]);
  expect(await storedNetwork(world.db)).toEqual([{ ip: OTHER_IP, userAgent: 'zzzz-elsewhere/2' }]);
  const audit = await world.db.selectFrom('audit_log').selectAll().where('action', '=', 'signer_pii.erased').execute();
  expect(audit.map((row) => row.metadata)).toEqual([{ signer_pii_rows: 1 }]);
  expect(JSON.stringify(audit)).not.toContain(TEST_IP);
  expect(JSON.stringify(audit)).not.toContain(TEST_AGENT);
});

test('erasing the signer in every installation that holds a row leaves no address or user agent behind', async () => {
  const { world, ada, body } = await signingWorld(RECORDING);
  signedOf(
    await signFrom({ world, ada, body }, { remoteAddress: TEST_IP, headers: { 'user-agent': TEST_AGENT } }),
    201,
  );
  await sql`select erase_signer_pii(${ada.githubId}, ${ADMIN}, ${world.t1.installationId})`.execute(world.db);
  const left = await sql<{ n: number }>`
    select count(*)::int as n from signer_pii where ip_address is not null or user_agent is not null`.execute(world.db);
  expect(left.rows).toEqual([{ n: 0 }]);
  expect(await storedNetwork(world.db)).toEqual([]);
});

test.each([
  ['7', 7],
  ['30', 30],
  ['90', 90],
  [undefined, 30],
])(
  'with NETWORK_METADATA_RETENTION_DAYS=%s the job keeps the values of a signing for %i days, then clears them and nothing else',
  async (value, days) => {
    const retention = retentionDaysOf(value);
    expect(retention).toBe(days);
    const { world, ada, body } = await signingWorld(RECORDING);
    signedOf(
      await signFrom({ world, ada, body }, { remoteAddress: TEST_IP, headers: { 'user-agent': TEST_AGENT } }),
      201,
    );
    const stored = await world.db
      .selectFrom('signer_pii')
      .select(['created_at', 'name', 'email', 'login'])
      .executeTakeFirstOrThrow();
    let now = new Date(stored.created_at.getTime() + retention * DAY - 1);
    const run = createPurgeNetworkMetadataHandler({
      db: world.db,
      clock: { now: () => now },
      retentionDays: retention,
      log: { info: () => undefined },
    });

    expect(await run()).toBe(0);
    expect(await storedNetwork(world.db)).toEqual([{ ip: TEST_IP, userAgent: TEST_AGENT }]);

    now = new Date(stored.created_at.getTime() + retention * DAY + 1);
    expect(await run()).toBe(1);
    expect(await storedNetwork(world.db)).toEqual([{ ip: null, userAgent: null }]);
    const kept = await world.db.selectFrom('signer_pii').select(['created_at', 'name', 'email', 'login']).execute();
    expect(kept).toEqual([stored]);
    expect(await purgeAuditRows(world.db)).toEqual([
      { installation_id: null, actor_github_id: null, subject_type: null, subject_id: null, metadata: { rows: 1 } },
    ]);
  },
);
