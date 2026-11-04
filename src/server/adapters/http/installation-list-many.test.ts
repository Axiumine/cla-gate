// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { INSTALLATIONS_PATH } from '../../../shared/installations.ts';
import { id, installation } from '../../services/github-contract/test-support.ts';
import { createInstallationStore } from '../../services/installation-store.ts';
import { installationOf } from '../../services/store-fixture/test-support.ts';
import { failureOf, listMinutesApart } from './installation-list-fixture/test-support.ts';
import { type GuardWorld, guardWorld, PEOPLE } from './tenant-guard-fixture/test-support.ts';

// GET /api/installations on an instance that serves many organisations (E14-S01): the list asks the org admin fact of every
// live installation, so it must be answered, and answered again a minute later, however many there are. The world is the
// six tenants of the guard tests plus the organisations a test adds.

/** The installation id of the organisation `org-<n>` a test adds. */
const addedInstallation = (n: number) => id(n * 100);

/** Admits `count` more organisations, `org-10` on, and makes GitHub know them; nobody is a member of any until a test says so. */
async function admitOrganisations(world: GuardWorld, count: number): Promise<void> {
  const store = createInstallationStore(world.db);
  for (let n = 10; n < 10 + count; n += 1) {
    world.fake.addInstallation(installation(addedInstallation(n), `org-${n}`));
    await store.upsertInstallation(installationOf(n));
  }
}

test('an instance of 41 live organisations is listed for its admin, and listed again a minute later when the answers have expired', async () => {
  const world = await guardWorld();
  await admitOrganisations(world, 39);
  world.fake.addMembership(addedInstallation(48), 'org-48', `login-${PEOPLE.admin1}`, {
    state: 'active',
    role: 'admin',
    userId: id(PEOPLE.admin1),
  });
  const attempts = await listMinutesApart(world, 'admin1', 3);
  const listed = [
    200,
    [
      ['org-1', false],
      ['org-48', false],
    ],
  ];
  expect(attempts).toEqual([listed, listed, listed]);
});

test('the list spends the budget of its own: the 30 uncached lookups a minute of the guard are all left to the person', async () => {
  const world = await guardWorld();
  await admitOrganisations(world, 39);
  expect((await world.ask('GET', INSTALLATIONS_PATH, 'admin1')).statusCode).toBe(200);
  const writes = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    writes.push((await world.ask('POST', `/t/installations/${world.tenants.t1}`, 'admin1')).statusCode);
  }
  expect(new Set(writes)).toEqual(new Set([200]));
  expect(failureOf(await world.ask('POST', `/t/installations/${world.tenants.t1}`, 'admin1'))).toEqual([
    429,
    'too_many_requests',
  ]);
});
