// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { installationRowIdSchema } from '../adapters/db/installation-row-id.ts';
import { twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { createAdminLedger, recordingAdmins } from './admin-ledger.ts';
import { RoleCache } from './role-cache.ts';
import { deferred } from './role-fixture/test-support.ts';
import { createViewerLookupBudget } from './role-lookup-budget.ts';
import { type CachedOrgAdminLookup, createRoleLookups } from './role-lookups.ts';
import { FakeClock } from './test-support.ts';

// An older answer must not undo a newer one in the ledger of org admins (E11-S07). A role lookup that a fresh one displaced,
// or that an invalidation dropped, while it was waiting for GitHub keeps nothing in the cache; it keeps nothing in the
// ledger either, because a demoted admin whom an older "admin" put back would keep read access for 14 days once the
// organisation is suspended or deleted.

const START = '2026-11-02T10:00:00.000Z';
const PERSON = parseGithubId(777);
const VIEWER = { githubId: PERSON, login: 'login-777' };

async function world() {
  const { db } = await migratedTestDatabase();
  const { t1 } = await twoTenants(db);
  const clock = new FakeClock(START);
  const ledger = createAdminLedger({ db, clock });
  const cache = new RoleCache({ clock });
  /** What GitHub is going to answer to the next lookups, in the order they ask. */
  const answers: Promise<boolean>[] = [];
  const github: CachedOrgAdminLookup = () => answers.shift() ?? Promise.reject(new Error('no answer scripted'));
  const lookups = createRoleLookups({
    cache,
    budget: createViewerLookupBudget(clock),
    orgAdmin: recordingAdmins(github, ledger),
    repoAdmin: () => Promise.resolve(false),
  });
  const organisation = {
    id: installationRowIdSchema.parse(t1.installationId),
    github_installation_id: 5000,
    account_id: 1,
    account_login: 'org-1',
    account_type: 'Organization',
  } as const;
  const inLedger = () => ledger.isAdmin(t1.installationId, PERSON);
  return { cache, ledger, answers, lookups, organisation, inLedger, tenant: t1.installationId };
}

test('an older "admin" that a fresh lookup displaced does not put a demoted admin back into the ledger', async () => {
  const { ledger, answers, lookups, organisation, inLedger, tenant } = await world();
  await ledger.record(tenant, PERSON);
  const older = deferred<boolean>();
  answers.push(older.promise, Promise.resolve(false));
  const read = lookups.read.orgAdmin(organisation, VIEWER);
  expect(await lookups.write.orgAdmin(organisation, VIEWER)).toBe(false);
  expect(await inLedger()).toBe(false);
  older.resolve(true);
  expect(await read).toBe(true);
  expect(await inLedger()).toBe(false);
  expect(await lookups.read.orgAdmin(organisation, VIEWER)).toBe(false);
});

test('an older "not an admin" that a fresh lookup displaced does not take a new admin out of the ledger', async () => {
  const { answers, lookups, organisation, inLedger } = await world();
  const older = deferred<boolean>();
  answers.push(older.promise, Promise.resolve(true));
  const read = lookups.read.orgAdmin(organisation, VIEWER);
  expect(await lookups.write.orgAdmin(organisation, VIEWER)).toBe(true);
  expect(await inLedger()).toBe(true);
  older.resolve(false);
  expect(await read).toBe(false);
  expect(await inLedger()).toBe(true);
});

test('a lookup that an invalidation dropped while under way answers its own caller and writes nothing to the ledger', async () => {
  const { cache, answers, lookups, organisation, inLedger } = await world();
  const dropped = deferred<boolean>();
  answers.push(dropped.promise);
  const read = lookups.read.orgAdmin(organisation, VIEWER);
  cache.invalidateViewer(PERSON);
  dropped.resolve(true);
  expect(await read).toBe(true);
  expect(await inLedger()).toBe(false);
});

test('a lookup nobody displaced writes its answer to the ledger', async () => {
  const { ledger, answers, lookups, organisation, inLedger, tenant } = await world();
  const slow = deferred<boolean>();
  answers.push(slow.promise);
  const read = lookups.read.orgAdmin(organisation, VIEWER);
  expect(await inLedger()).toBe(false);
  slow.resolve(true);
  expect(await read).toBe(true);
  expect(await inLedger()).toBe(true);
  answers.push(Promise.resolve(false));
  expect(await lookups.write.orgAdmin(organisation, VIEWER)).toBe(false);
  expect(await ledger.isAdmin(tenant, PERSON)).toBe(false);
});
