// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { forgetAdminSeen, recordAdminSeen, wasAdminSeenSince } from './admin-ledger-queries.ts';

// The statements over the ledger of org admins (E11-S07): the pair (installation, person) with the time a live lookup last
// saw the person as an admin. Every statement names the installation, so the entry of another tenant is never touched.

const FIRST = new Date('2026-11-02T10:00:00.000Z');
const MINUTE_LATER = new Date('2026-11-02T10:01:00.000Z');
const BEFORE_MINUTE = new Date('2026-11-02T10:00:59.999Z');
/** The person of the tests: nobody the fixture stores in the ledger. */
const PERSON = parseGithubId(777);

async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  const scope1 = { installationId: tenants.t1.installationId };
  const scope2 = { installationId: tenants.t2.installationId };
  const entries = async () =>
    (
      await db
        .selectFrom('installation_admin_seen')
        .selectAll()
        .where('user_github_id', '=', PERSON)
        .orderBy('installation_id')
        .execute()
    ).map((row) => [row.installation_id, row.seen_at.toISOString()]);
  return { db, ...tenants, scope1, scope2, entries };
}

test('a first sighting is written, with the instant it was made and nothing else about the person', async () => {
  const { db, scope1, t1, entries } = await world();
  expect(await recordAdminSeen(db, scope1, PERSON, { seenAt: FIRST, refreshAtOrBefore: FIRST })).toBe(true);
  expect(await entries()).toEqual([[t1.installationId, FIRST.toISOString()]]);
});

test('an entry seen a minute ago or earlier is refreshed, and a fresher one is left alone', async () => {
  const { db, scope1, t1, entries } = await world();
  await recordAdminSeen(db, scope1, PERSON, { seenAt: FIRST, refreshAtOrBefore: FIRST });
  expect(
    await recordAdminSeen(db, scope1, PERSON, {
      seenAt: BEFORE_MINUTE,
      refreshAtOrBefore: new Date(BEFORE_MINUTE.getTime() - 60_000),
    }),
  ).toBe(false);
  expect(await entries()).toEqual([[t1.installationId, FIRST.toISOString()]]);
  expect(await recordAdminSeen(db, scope1, PERSON, { seenAt: MINUTE_LATER, refreshAtOrBefore: FIRST })).toBe(true);
  expect(await entries()).toEqual([[t1.installationId, MINUTE_LATER.toISOString()]]);
});

test('an entry never moves back in time', async () => {
  const { db, scope1, t1, entries } = await world();
  await recordAdminSeen(db, scope1, PERSON, { seenAt: MINUTE_LATER, refreshAtOrBefore: MINUTE_LATER });
  expect(
    await recordAdminSeen(db, scope1, PERSON, { seenAt: FIRST, refreshAtOrBefore: new Date(FIRST.getTime() - 60_000) }),
  ).toBe(false);
  expect(await entries()).toEqual([[t1.installationId, MINUTE_LATER.toISOString()]]);
});

test('the pair is the key: one row per person in each tenant, written independently', async () => {
  const { db, scope1, scope2, t1, t2, entries } = await world();
  await recordAdminSeen(db, scope1, PERSON, { seenAt: FIRST, refreshAtOrBefore: FIRST });
  await recordAdminSeen(db, scope2, PERSON, { seenAt: MINUTE_LATER, refreshAtOrBefore: MINUTE_LATER });
  expect(await entries()).toEqual([
    [t1.installationId, FIRST.toISOString()],
    [t2.installationId, MINUTE_LATER.toISOString()],
  ]);
  expect(await recordAdminSeen(db, scope1, PERSON, { seenAt: MINUTE_LATER, refreshAtOrBefore: FIRST })).toBe(true);
  expect(await entries()).toEqual([
    [t1.installationId, MINUTE_LATER.toISOString()],
    [t2.installationId, MINUTE_LATER.toISOString()],
  ]);
});

test('forgetting deletes the pair of that tenant only, and says whether there was one', async () => {
  const { db, scope1, scope2, t2, entries } = await world();
  await recordAdminSeen(db, scope1, PERSON, { seenAt: FIRST, refreshAtOrBefore: FIRST });
  await recordAdminSeen(db, scope2, PERSON, { seenAt: FIRST, refreshAtOrBefore: FIRST });
  expect(await forgetAdminSeen(db, scope1, PERSON)).toBe(true);
  expect(await entries()).toEqual([[t2.installationId, FIRST.toISOString()]]);
  expect(await forgetAdminSeen(db, scope1, PERSON)).toBe(false);
  expect(await entries()).toEqual([[t2.installationId, FIRST.toISOString()]]);
});

test('forgetting a person deletes nobody else, in this tenant or in another', async () => {
  const { db, scope1, t1, t2, people } = await world();
  expect(await forgetAdminSeen(db, scope1, people.admin2.githubId)).toBe(false);
  const rows = await db
    .selectFrom('installation_admin_seen')
    .select(['installation_id', 'user_github_id'])
    .orderBy('installation_id')
    .execute();
  expect(rows).toEqual([
    { installation_id: t1.installationId, user_github_id: people.admin1.githubId },
    { installation_id: t2.installationId, user_github_id: people.admin2.githubId },
  ]);
});

test('an entry counts when it was seen at the cut-off or later, and not before it', async () => {
  const { db, scope1 } = await world();
  await recordAdminSeen(db, scope1, PERSON, { seenAt: FIRST, refreshAtOrBefore: FIRST });
  expect(await wasAdminSeenSince(db, scope1, PERSON, FIRST)).toBe(true);
  expect(await wasAdminSeenSince(db, scope1, PERSON, new Date(FIRST.getTime() - 1))).toBe(true);
  expect(await wasAdminSeenSince(db, scope1, PERSON, new Date(FIRST.getTime() + 1))).toBe(false);
});

test('an entry of another tenant, or of another person, is not an entry of this one', async () => {
  const { db, scope1, scope2, people } = await world();
  await recordAdminSeen(db, scope2, PERSON, { seenAt: FIRST, refreshAtOrBefore: FIRST });
  expect(await wasAdminSeenSince(db, scope1, PERSON, new Date(0))).toBe(false);
  expect(await wasAdminSeenSince(db, scope2, PERSON, new Date(0))).toBe(true);
  expect(await wasAdminSeenSince(db, scope1, people.admin2.githubId, new Date(0))).toBe(false);
  expect(await wasAdminSeenSince(db, scope1, people.admin1.githubId, new Date(0))).toBe(true);
});
