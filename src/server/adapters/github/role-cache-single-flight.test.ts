// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createOrgAdminLookup } from '../../services/org-admin.ts';
import { createRepoAdminLookup } from '../../services/repo-admin.ts';
import { RoleCache } from '../../services/role-cache.ts';
import { deferred, VIEWER, VIEWER_ID } from '../../services/role-fixture/test-support.ts';
import { createViewerLookupBudget } from '../../services/role-lookup-budget.ts';
import { createRoleLookups } from '../../services/role-lookups.ts';
import { tenantRow } from '../../services/role-lookups-fixture/test-support.ts';
import { createLogger } from '../http/logger.ts';
import { clientFixture, json, line, type Routes } from './client-fixture/test-support.ts';

// Single flight over the real Octokit adapter (E11-S04): MSW counts the requests that reach GitHub when many requests
// ask for the same role at the same moment, and holds an answer back to show that other keys do not wait for it.

const MEMBERSHIP = 'GET /orgs/:org/memberships/:username';

const adminBody = (): Response => json({ state: 'active', role: 'admin', user: { login: 'alice', id: VIEWER_ID } });

function world(routes: Routes) {
  const fixture = clientFixture(routes);
  const log = createLogger({ logLevel: 'info' }, fixture.logs.destination);
  const lookups = createRoleLookups({
    cache: new RoleCache({ clock: fixture.clock }),
    budget: createViewerLookupBudget(fixture.clock),
    orgAdmin: createOrgAdminLookup({ github: fixture.client, log }),
    repoAdmin: createRepoAdminLookup({ github: fixture.client, log }),
  });
  return { ...fixture, lookups };
}

test('20 simultaneous identical lookups produce one GitHub request', async () => {
  const release = deferred<boolean>();
  const fixture = world({
    [MEMBERSHIP]: async () => {
      await release.promise;
      return adminBody();
    },
  });
  const asked = Array.from({ length: 20 }, () => fixture.lookups.read.orgAdmin(tenantRow(1), VIEWER));
  await expect.poll(() => fixture.calls.length).toBe(1);
  release.resolve(true);
  expect(await Promise.all(asked)).toEqual(Array.from({ length: 20 }, () => true));
  expect(fixture.calls.map(line)).toEqual(['GET /orgs/org-1/memberships/alice']);
});

test('the answer is then kept: a later lookup is a hit and sends nothing', async () => {
  const fixture = world({ [MEMBERSHIP]: adminBody });
  await Promise.all(Array.from({ length: 20 }, () => fixture.lookups.read.orgAdmin(tenantRow(1), VIEWER)));
  expect(await fixture.lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(true);
  expect(fixture.calls).toHaveLength(1);
});

test('20 simultaneous failures are one request, one failure for all of them, and the next lookup asks again', async () => {
  let requests = 0;
  const release = deferred<boolean>();
  const fixture = world({
    [MEMBERSHIP]: async () => {
      requests += 1;
      await release.promise;
      return requests === 1 ? json({ message: 'Server Error' }, 500) : adminBody();
    },
  });
  const asked = Array.from({ length: 20 }, () =>
    fixture.lookups.read.orgAdmin(tenantRow(1), VIEWER).catch((error: unknown) => error),
  );
  await expect.poll(() => requests).toBe(1);
  release.resolve(true);
  const outcomes = await Promise.all(asked);
  expect(new Set(outcomes).size).toBe(1);
  expect(outcomes[0]).toBeInstanceOf(Error);
  expect(await fixture.lookups.read.orgAdmin(tenantRow(1), VIEWER)).toBe(true);
  expect(requests).toBe(2);
});

test('lookups for different keys never wait on each other: another installation answers while the first is held', async () => {
  const release = deferred<boolean>();
  const fixture = world({
    [MEMBERSHIP]: async (call) => {
      if (call.path.startsWith('/orgs/org-1/')) {
        await release.promise;
      }
      return adminBody();
    },
  });
  const held = fixture.lookups.read.orgAdmin(tenantRow(1), VIEWER);
  expect(await fixture.lookups.read.orgAdmin(tenantRow(2), VIEWER)).toBe(true);
  expect(await fixture.lookups.read.orgAdmin(tenantRow(3), VIEWER)).toBe(true);
  release.resolve(true);
  expect(await held).toBe(true);
  expect(fixture.calls.map(line)).toEqual([
    'GET /orgs/org-1/memberships/alice',
    'GET /orgs/org-2/memberships/alice',
    'GET /orgs/org-3/memberships/alice',
  ]);
});

test('a write is not folded into a read that is under way: it sends its own request', async () => {
  const release = deferred<boolean>();
  let requests = 0;
  const fixture = world({
    [MEMBERSHIP]: async () => {
      requests += 1;
      if (requests === 1) {
        await release.promise;
      }
      return adminBody();
    },
  });
  const read = fixture.lookups.read.orgAdmin(tenantRow(1), VIEWER);
  expect(await fixture.lookups.write.orgAdmin(tenantRow(1), VIEWER)).toBe(true);
  release.resolve(true);
  expect(await read).toBe(true);
  expect(requests).toBe(2);
});
