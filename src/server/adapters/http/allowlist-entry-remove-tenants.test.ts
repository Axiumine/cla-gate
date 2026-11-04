// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sweeps } from './allowlist-entry-fixture/test-support.ts';
import {
  allowlistWorld,
  deletedAuditRows,
  entryIdOfAccount,
  entryIdsOf,
  installationPageOf,
  listInstallationAs,
  removeEntryAs,
  storeEntries,
} from './allowlist-list-fixture/test-support.ts';
import { tablesOf, withoutRequestId } from './document-fixture/test-support.ts';

// The cross-tenant checks of the removal of an allowlist entry (E14-S07): no id of the other tenant removes anything, and the removal
// in one tenant leaves the identical entry of the other where it is.

test("tenant 1's admin cannot remove tenant 2's entries by any id, on either installation's path: the answer for an id that exists nowhere", async () => {
  const world = await allowlistWorld();
  const { t1, t2 } = world;
  const foreign = [t2.entryId, await entryIdOfAccount(world, t2.installationId, 201)];
  const unknown = await removeEntryAs(world, 'admin1', t1.installationId, 987_654);
  const before = await tablesOf(world);
  for (const entryId of foreign) {
    for (const installationId of [t1.installationId, t2.installationId]) {
      for (const who of ['admin1', 'repoAdmin1'] as const) {
        const answer = await removeEntryAs(world, who, installationId, entryId);
        expect([who, installationId, answer.statusCode]).toEqual([who, installationId, 404]);
        expect(withoutRequestId(answer)).toBe(withoutRequestId(unknown));
      }
    }
  }
  expect(await tablesOf(world)).toEqual(before);
  expect(await deletedAuditRows(world)).toEqual([]);
});

test("tenant 2's admin cannot remove tenant 1's entries either", async () => {
  const world = await allowlistWorld();
  const { t1, t2 } = world;
  const before = await tablesOf(world);
  const answers = [
    await removeEntryAs(world, 'admin2', t1.installationId, t1.entryId),
    await removeEntryAs(world, 'admin2', t2.installationId, t1.entryId),
    await removeEntryAs(world, 'admin2', t1.installationId, await entryIdOfAccount(world, t1.installationId, 101)),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404]);
  expect(await tablesOf(world)).toEqual(before);
});

test('an entry removed in tenant 1 leaves the identical entry of tenant 2 in place: same kind, same GitHub id, same login', async () => {
  const world = await allowlistWorld();
  const { t1, t2, people } = world;
  const make = (installationId: number, createdBy: number) => ({
    installationId,
    repositoryId: null,
    kind: 'user' as const,
    githubId: 4711,
    loginSnapshot: 'ada-lovelace',
    createdBy,
  });
  const [mine, theirs] = await storeEntries(world, [
    make(t1.installationId, people.admin1.userId),
    make(t2.installationId, people.admin2.userId),
  ]);
  const response = await removeEntryAs(world, 'admin1', t1.installationId, mine ?? 0);
  expect(response.statusCode).toBe(204);
  expect(await entryIdsOf(world, t2.installationId)).toContain(theirs);
  const page = installationPageOf(await listInstallationAs(world, 'admin2', t2.installationId));
  expect(page.entries.map((entry) => [entry.id, entry.kind, entry.githubId, entry.loginSnapshot])).toContainEqual([
    theirs,
    'user',
    4711,
    'ada-lovelace',
  ]);
  expect((await deletedAuditRows(world)).map((row) => row.installation_id)).toEqual([t1.installationId]);
});

test("the sweeps of a removal in tenant 1 are for tenant 1's repositories only, although tenant 2 enforces the same pull requests", async () => {
  const world = await allowlistWorld();
  const { t1, t2 } = world;
  await world.db.updateTable('repositories').set({ enabled: true }).execute();
  await removeEntryAs(world, 'admin1', t1.installationId, t1.entryId);
  const repositories = (await sweeps(world))
    .flatMap((sent) => (sent.job.type === 'sweep-repository' ? [sent.job.githubRepoId] : []))
    .toSorted((a, b) => a - b);
  expect(repositories).toEqual([t1.plain.githubRepoId, t1.scoped.githubRepoId].toSorted((a, b) => a - b));
  expect(repositories).not.toContain(t2.plain.githubRepoId);
});
