// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { auditMetadataSchema } from '../../../shared/audit-metadata.ts';
import {
  addNetworkColumns,
  CUTOFF,
  type NetworkValues,
  networkOf,
  purgeAuditRows,
  setNetwork,
  shifted,
} from './network-metadata-fixture/test-support.ts';
import { containing, migratedTestDatabase, seedSignature, seedTenant } from './test-support.ts';

// purge_signer_network_metadata (E16-S05): the IP address and the user agent of a signing are removed from every row created
// before the cutoff, and nothing else is touched. The columns are E13-S05's; the tests add them like that migration does.

const BOTH: NetworkValues = { ip: '203.0.113.7', userAgent: 'TestAgent/1.0' };
const NONE: NetworkValues = { ip: null, userAgent: null };
const DAY = 86_400_000;

const PURGE = (cutoff: string) =>
  sql<{ purged: number }>`select purge_signer_network_metadata(${cutoff}::timestamptz) as purged`;

/** A migrated database with the two columns, one tenant and `sign(githubId, createdAt, values)`: a signature whose personal data row has them. */
async function world() {
  const { db } = await migratedTestDatabase();
  await addNetworkColumns(db);
  const tenant = await seedTenant(db);
  const sign = async (githubId: number, createdAt: string, values: NetworkValues): Promise<number> => {
    const { signatureId } = await seedSignature(db, tenant, githubId);
    await setNetwork(db, signatureId, createdAt, values);
    return signatureId;
  };
  return { db, tenant, sign };
}

test('a row exactly at the cutoff is kept, a row one millisecond older and one a day older are purged, and a newer one is kept', async () => {
  const { db, sign } = await world();
  const atCutoff = await sign(1, CUTOFF, BOTH);
  const oneMillisecondOlder = await sign(2, shifted(CUTOFF, -1), BOTH);
  const aDayOlder = await sign(3, shifted(CUTOFF, -DAY), BOTH);
  const oneMillisecondNewer = await sign(4, shifted(CUTOFF, 1), BOTH);

  expect((await PURGE(CUTOFF).execute(db)).rows).toEqual([{ purged: 2 }]);

  expect(await networkOf(db)).toEqual({
    [atCutoff]: BOTH,
    [oneMillisecondOlder]: NONE,
    [aDayOlder]: NONE,
    [oneMillisecondNewer]: BOTH,
  });
});

test('a row with only one of the two values set is purged, and the other value is not invented', async () => {
  const { db, sign } = await world();
  const onlyAgent = await sign(1, shifted(CUTOFF, -1), { ip: null, userAgent: 'OnlyAgent/2' });
  const onlyAddress = await sign(2, shifted(CUTOFF, -1), { ip: '2001:db8::1', userAgent: null });

  expect((await PURGE(CUTOFF).execute(db)).rows).toEqual([{ purged: 2 }]);

  expect(await networkOf(db)).toEqual({ [onlyAgent]: NONE, [onlyAddress]: NONE });
});

test('rows with both values empty are untouched, count for nothing and leave no audit row', async () => {
  const { db, sign } = await world();
  const old = await sign(1, shifted(CUTOFF, -30 * DAY), NONE);
  const before = await sql`select to_jsonb(p) as row from signer_pii as p order by p.signature_id`.execute(db);

  expect((await PURGE(CUTOFF).execute(db)).rows).toEqual([{ purged: 0 }]);

  expect(await networkOf(db)).toEqual({ [old]: NONE });
  expect(await sql`select to_jsonb(p) as row from signer_pii as p order by p.signature_id`.execute(db)).toEqual(before);
  expect(await purgeAuditRows(db)).toEqual([]);
});

test('one run writes one audit row for the instance: no actor, no installation, no subject, and only the number of rows', async () => {
  const { db, sign } = await world();
  await sign(1, shifted(CUTOFF, -1), BOTH);
  await sign(2, shifted(CUTOFF, -DAY), { ip: null, userAgent: 'x' });
  await sign(3, CUTOFF, BOTH);

  await PURGE(CUTOFF).execute(db);

  const audit = await purgeAuditRows(db);
  expect(audit).toEqual([
    { installation_id: null, actor_github_id: null, subject_type: null, subject_id: null, metadata: { rows: 2 } },
  ]);
  expect(auditMetadataSchema.parse(audit[0]?.metadata)).toEqual({ rows: 2 });
  const stored = await db.selectFrom('audit_log').select('action').execute();
  expect(stored).toEqual([{ action: 'network_metadata.purged' }]);
});

test('the purge never touches name, email, login or the signature core, only the two network values', async () => {
  const { db, sign } = await world();
  await sign(1, shifted(CUTOFF, -1), BOTH);
  await sign(2, shifted(CUTOFF, -DAY), BOTH);
  const snapshot = async () => ({
    signatures: (await sql`select to_jsonb(s) as row from signatures as s order by s.id`.execute(db)).rows,
    personal: (
      await sql`select signature_id, user_id, name, email, login, created_at from signer_pii order by signature_id`.execute(
        db,
      )
    ).rows,
    users: (await sql`select to_jsonb(u) as row from users as u order by u.id`.execute(db)).rows,
  });
  const before = await snapshot();

  expect((await PURGE(CUTOFF).execute(db)).rows).toEqual([{ purged: 2 }]);

  expect(await snapshot()).toEqual(before);
  expect(before.personal).toHaveLength(2);
});

test('a second run on the same data returns 0 and appends no second audit row', async () => {
  const { db, sign } = await world();
  await sign(1, shifted(CUTOFF, -1), BOTH);

  expect((await PURGE(CUTOFF).execute(db)).rows).toEqual([{ purged: 1 }]);
  expect((await PURGE(CUTOFF).execute(db)).rows).toEqual([{ purged: 0 }]);

  expect(await purgeAuditRows(db)).toHaveLength(1);
});

test('an audit row that cannot be written undoes the purge: no row loses its values unrecorded', async () => {
  const { db, sign } = await world();
  const old = await sign(1, shifted(CUTOFF, -1), BOTH);
  await sql`
    create function refuse_purge_audit() returns trigger language plpgsql as $$
    begin raise exception 'audit insert refused'; end $$`.execute(db);
  await sql`
    create trigger refuse_purge_audit before insert on audit_log for each row
    when (new.action = 'network_metadata.purged') execute function refuse_purge_audit()`.execute(db);

  await expect(PURGE(CUTOFF).execute(db)).rejects.toMatchObject({ message: containing('audit insert refused') });

  expect(await networkOf(db)).toEqual({ [old]: BOTH });
  expect(await purgeAuditRows(db)).toEqual([]);
});

test('before E13-S05 adds the columns there is nothing to purge: the function returns 0 and writes nothing', async () => {
  const { db } = await migratedTestDatabase();
  const tenant = await seedTenant(db);
  await seedSignature(db, tenant, 1);
  await sql`update signer_pii set created_at = ${shifted(CUTOFF, -DAY)}::timestamptz`.execute(db);

  expect((await PURGE(CUTOFF).execute(db)).rows).toEqual([{ purged: 0 }]);

  expect(await purgeAuditRows(db)).toEqual([]);
});

test('with only one of the two columns present, that column is purged', async () => {
  const { db, sign } = await world();
  await sign(1, shifted(CUTOFF, -1), BOTH);
  await sql`alter table signer_pii drop column ip_address`.execute(db);

  expect((await PURGE(CUTOFF).execute(db)).rows).toEqual([{ purged: 1 }]);

  const { rows } = await sql<{ user_agent: string | null }>`select user_agent from signer_pii`.execute(db);
  expect(rows).toEqual([{ user_agent: null }]);
});

test('a missing cutoff is refused, not read as "no row is old enough"', async () => {
  const { db } = await world();
  await expect(sql`select purge_signer_network_metadata(null)`.execute(db)).rejects.toMatchObject({
    code: '22023',
    message: containing('cutoff is required'),
  });
});

test('exactly one function of that name exists, owned by the migrating role, with its search path pinned', async () => {
  const { db } = await world();
  const { rows } = await sql<{ definer: boolean; config: string[] | null; args: string }>`
    select prosecdef as definer, proconfig as config, pg_get_function_identity_arguments(oid) as args
    from pg_proc where proname = 'purge_signer_network_metadata'`.execute(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.definer).toBe(true);
  expect(rows[0]?.args).toBe('p_cutoff timestamp with time zone');
  expect(rows[0]?.config?.some((setting) => setting.startsWith('search_path='))).toBe(true);
});
