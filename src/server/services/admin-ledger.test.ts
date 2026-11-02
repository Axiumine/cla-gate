// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { type InstallationRowId, installationRowIdSchema } from '../adapters/db/installation-row-id.ts';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { type AdminLedger, createAdminLedger, INACTIVE_ADMIN_WINDOW_DAYS, recordingAdmins } from './admin-ledger.ts';
import type { CachedOrgAdminLookup } from './role-lookups.ts';
import { FakeClock } from './test-support.ts';

// The ledger of org admins (E11-S07): written on a live positive result at most once a minute per pair, deleted on a live
// negative one, and counted for 14 days. The statements are in admin-ledger-queries.test.ts.

const START = '2026-11-02T10:00:00.000Z';
const DAY_MS = 86_400_000;
const PERSON = parseGithubId(777);

async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  const clock = new FakeClock(START);
  const ledger = createAdminLedger({ db, clock });
  const seenAt = async (installationId: InstallationRowId) =>
    (
      await db
        .selectFrom('installation_admin_seen')
        .select('seen_at')
        .where('installation_id', '=', installationId)
        .where('user_github_id', '=', PERSON)
        .executeTakeFirst()
    )?.seen_at.toISOString();
  return { db, ...tenants, clock, ledger, seenAt };
}

test('the window is 14 days', () => {
  expect(INACTIVE_ADMIN_WINDOW_DAYS).toBe(14);
});

test('recording writes the instant of the clock, and at most once per 60 seconds per pair', async () => {
  const { ledger, clock, t1, seenAt } = await world();
  await ledger.record(t1.installationId, PERSON);
  expect(await seenAt(t1.installationId)).toBe(START);
  clock.advance(59_999);
  await ledger.record(t1.installationId, PERSON);
  expect(await seenAt(t1.installationId)).toBe(START);
  clock.advance(1);
  await ledger.record(t1.installationId, PERSON);
  expect(await seenAt(t1.installationId)).toBe('2026-11-02T10:01:00.000Z');
});

test('recording in one tenant leaves the entry of the same person in another alone', async () => {
  const { ledger, clock, t1, t2, seenAt } = await world();
  await ledger.record(t2.installationId, PERSON);
  clock.advance(120_000);
  await ledger.record(t1.installationId, PERSON);
  expect(await seenAt(t2.installationId)).toBe(START);
  expect(await seenAt(t1.installationId)).toBe('2026-11-02T10:02:00.000Z');
});

test('forgetting removes the entry, and a later sighting starts a new one at once', async () => {
  const { ledger, t1, seenAt } = await world();
  await ledger.record(t1.installationId, PERSON);
  await ledger.forget(t1.installationId, PERSON);
  expect(await seenAt(t1.installationId)).toBeUndefined();
  await ledger.record(t1.installationId, PERSON);
  expect(await seenAt(t1.installationId)).toBe(START);
});

test.each([
  ['day 13', 13 * DAY_MS, true],
  ['exactly 14 days', 14 * DAY_MS, true],
  ['14 days and a millisecond', 14 * DAY_MS + 1, false],
  ['day 15', 15 * DAY_MS, false],
] as const)(
  'an admin seen on %s ago is an admin of a tenant GitHub no longer serves: %s',
  async (_when, ago, counts) => {
    const { db, ledger, clock, t1 } = await world();
    await db
      .insertInto('installation_admin_seen')
      .values({
        installation_id: t1.installationId,
        user_github_id: PERSON,
        seen_at: new Date(clock.now().getTime() - ago),
      })
      .execute();
    expect(await ledger.isAdmin(t1.installationId, PERSON)).toBe(counts);
  },
);

test('the window moves with the clock: an entry that counts today stops counting 14 days on', async () => {
  const { ledger, clock, t1 } = await world();
  await ledger.record(t1.installationId, PERSON);
  clock.advance(14 * DAY_MS);
  expect(await ledger.isAdmin(t1.installationId, PERSON)).toBe(true);
  clock.advance(1);
  expect(await ledger.isAdmin(t1.installationId, PERSON)).toBe(false);
});

test('a person who is an admin of one tenant is not one of the other', async () => {
  const { ledger, t1, t2 } = await world();
  await ledger.record(t1.installationId, PERSON);
  expect(await ledger.isAdmin(t1.installationId, PERSON)).toBe(true);
  expect(await ledger.isAdmin(t2.installationId, PERSON)).toBe(false);
});

// ------------------------------------------------------------------------------------- the lookup that keeps the ledger

const organisation = (id: number, type: 'Organization' | 'User' | 'Other' = 'Organization') => ({
  id: installationRowIdSchema.parse(id),
  github_installation_id: 5000,
  account_id: 1,
  account_login: 'org-1',
  account_type: type,
});

const VIEWER = { githubId: PERSON, login: 'login-777' };

function spyLedger() {
  const ledger = {
    record: vi.fn<AdminLedger['record']>(() => Promise.resolve()),
    forget: vi.fn<AdminLedger['forget']>(() => Promise.resolve()),
    isAdmin: vi.fn<AdminLedger['isAdmin']>(() => Promise.resolve(false)),
  };
  return ledger;
}

test('a live positive result of an organisation is recorded, and the answer is passed on', async () => {
  const ledger = spyLedger();
  const lookup = recordingAdmins(() => Promise.resolve(true), ledger);
  expect(await lookup(organisation(3), VIEWER)).toBe(true);
  expect(ledger.record.mock.calls).toEqual([[installationRowIdSchema.parse(3), PERSON]]);
  expect(ledger.forget).not.toHaveBeenCalled();
});

test('a live negative result of an organisation deletes the pair, and the answer is passed on', async () => {
  const ledger = spyLedger();
  const lookup = recordingAdmins(() => Promise.resolve(false), ledger);
  expect(await lookup(organisation(3), VIEWER)).toBe(false);
  expect(ledger.forget.mock.calls).toEqual([[installationRowIdSchema.parse(3), PERSON]]);
  expect(ledger.record).not.toHaveBeenCalled();
});

test.each([
  ['a user account', 'User'],
  ['an account of another type', 'Other'],
] as const)('%s has no ledger: nothing is recorded or forgotten for it', async (_name, type) => {
  const ledger = spyLedger();
  expect(await recordingAdmins(() => Promise.resolve(true), ledger)(organisation(3, type), VIEWER)).toBe(true);
  expect(await recordingAdmins(() => Promise.resolve(false), ledger)(organisation(3, type), VIEWER)).toBe(false);
  expect(ledger.record).not.toHaveBeenCalled();
  expect(ledger.forget).not.toHaveBeenCalled();
});

test('a lookup that fails writes nothing and fails the same way', async () => {
  const ledger = spyLedger();
  const failing: CachedOrgAdminLookup = () => Promise.reject(new Error('GitHub is down'));
  await expect(recordingAdmins(failing, ledger)(organisation(3), VIEWER)).rejects.toThrow('GitHub is down');
  expect(ledger.record).not.toHaveBeenCalled();
  expect(ledger.forget).not.toHaveBeenCalled();
});

test('a failure of the ledger while recording is thrown, not swallowed', async () => {
  const ledger = spyLedger();
  ledger.record.mockRejectedValue(new Error('the database is down'));
  await expect(recordingAdmins(() => Promise.resolve(true), ledger)(organisation(3), VIEWER)).rejects.toThrow(
    'the database is down',
  );
});

test('a failure of the ledger while forgetting is thrown, not swallowed', async () => {
  const ledger = spyLedger();
  ledger.forget.mockRejectedValue(new Error('the database is down'));
  await expect(recordingAdmins(() => Promise.resolve(false), ledger)(organisation(3), VIEWER)).rejects.toThrow(
    'the database is down',
  );
});

const AT_START = { isCurrent: () => true };
const DISPLACED = { isCurrent: () => false };

test.each([
  ['an admin', true],
  ['not an admin', false],
])('a lookup that is no longer the current one writes nothing when it finds %s', async (_name, admin) => {
  const ledger = spyLedger();
  expect(await recordingAdmins(() => Promise.resolve(admin), ledger)(organisation(3), VIEWER, DISPLACED)).toBe(admin);
  expect(ledger.record).not.toHaveBeenCalled();
  expect(ledger.forget).not.toHaveBeenCalled();
});

test('a lookup that is still the current one writes as one with no cache in front does', async () => {
  const ledger = spyLedger();
  expect(await recordingAdmins(() => Promise.resolve(true), ledger)(organisation(3), VIEWER, AT_START)).toBe(true);
  expect(await recordingAdmins(() => Promise.resolve(false), ledger)(organisation(3), VIEWER, AT_START)).toBe(false);
  expect(ledger.record.mock.calls).toEqual([[installationRowIdSchema.parse(3), PERSON]]);
  expect(ledger.forget.mock.calls).toEqual([[installationRowIdSchema.parse(3), PERSON]]);
});

test('the context is handed on to the lookup it wraps', async () => {
  const seen: unknown[] = [];
  const lookup: CachedOrgAdminLookup = (_installation, _viewer, context) => {
    seen.push(context);
    return Promise.resolve(true);
  };
  await recordingAdmins(lookup, spyLedger())(organisation(3), VIEWER, AT_START);
  expect(seen).toEqual([AT_START]);
});
