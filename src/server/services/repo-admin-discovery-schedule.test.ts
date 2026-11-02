// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { addRepositories, namesOf, range, scopeDocuments } from './discovery-fixture/test-support.ts';
import { GitHubRateLimitedError, GitHubUnavailableError } from './ports/github-errors.ts';
import { ProbeBudget } from './probe-budget.ts';
import type { RepoAdminLookup } from './repo-admin.ts';
import { createRepoAdminDiscovery } from './repo-admin-discovery.ts';
import { VIEWER } from './role-fixture/test-support.ts';
import { worldOfTwoTenants } from './store-fixture/test-support.ts';

// How the probes of the repository admin discovery (E11-S03) are scheduled: five at a time, in repository id order, no new
// one after a hit or a failure, and what each probe costs against the budget. The lookups here are hand-held so a test
// decides when each one answers.

/** A lookup whose calls stay open until the test answers them, oldest first, and that notes how many are open at once. */
function heldLookup() {
  const started: string[] = [];
  const open: { resolve: (admin: boolean) => void; reject: (error: Error) => void }[] = [];
  let peak = 0;
  const lookup: RepoAdminLookup = (_installation, repository) => {
    started.push(repository.full_name);
    peak = Math.max(peak, open.length + 1);
    return new Promise<boolean>((resolve, reject) => {
      open.push({ resolve, reject });
    });
  };
  return {
    lookup,
    started,
    open: () => open.length,
    peak: () => peak,
    answer: (admin: boolean) => open.shift()?.resolve(admin),
    fail: (error: Error) => open.shift()?.reject(error),
  };
}

/** Tenant 1 with `count` repositories, each with a repo-scoped document, and the discovery over `lookup`. */
async function tenantWith(count: number, lookup: RepoAdminLookup) {
  const world = await worldOfTwoTenants();
  await addRepositories(world.store, world.a.installation.id, 1, range(3, count));
  await scopeDocuments(world.db, world.a.installation.id, namesOf(1, range(1, count)));
  return { installationId: world.a.installation.id, discover: createRepoAdminDiscovery({ db: world.db, lookup }) };
}

test('five repositories are asked at once, the next one starts as one answers, and never more than five are open', async () => {
  const held = heldLookup();
  const { installationId, discover } = await tenantWith(12, held.lookup);
  const running = discover(VIEWER, installationId, new ProbeBudget(100));
  await vi.waitFor(() => {
    expect(held.started).toEqual(namesOf(1, range(1, 5)));
  });
  held.answer(false);
  await vi.waitFor(() => {
    expect(held.started).toHaveLength(6);
  });
  expect(held.open()).toBe(5);
  while (held.started.length < 12 || held.open() > 0) {
    held.answer(false);
    await Promise.resolve();
  }
  expect(await running).toEqual({ role: 'none', truncated: false });
  expect(held.started).toEqual(namesOf(1, range(1, 12)));
  expect(held.peak()).toBe(5);
});

test('fewer repositories than five start fewer probes', async () => {
  const held = heldLookup();
  const { installationId, discover } = await tenantWith(3, held.lookup);
  const running = discover(VIEWER, installationId, new ProbeBudget(100));
  await vi.waitFor(() => {
    expect(held.open()).toBe(3);
  });
  held.answer(false);
  held.answer(false);
  held.answer(false);
  expect(await running).toEqual({ role: 'none', truncated: false });
  expect(held.started).toHaveLength(3);
});

test('at the first admin hit no further probe starts, and the probes in flight are let finish', async () => {
  const held = heldLookup();
  const { installationId, discover } = await tenantWith(12, held.lookup);
  const running = discover(VIEWER, installationId, new ProbeBudget(100));
  await vi.waitFor(() => {
    expect(held.open()).toBe(5);
  });
  held.answer(true);
  held.answer(false);
  held.answer(false);
  held.answer(false);
  held.answer(false);
  expect(await running).toEqual({ role: 'repo_admin', truncated: false });
  expect(held.started).toEqual(namesOf(1, range(1, 5)));
});

test('a hit that arrives after another probe answered no is still a hit', async () => {
  const held = heldLookup();
  const { installationId, discover } = await tenantWith(5, held.lookup);
  const running = discover(VIEWER, installationId, new ProbeBudget(100));
  await vi.waitFor(() => {
    expect(held.open()).toBe(5);
  });
  held.answer(false);
  held.answer(true);
  held.answer(false);
  held.answer(false);
  held.answer(false);
  expect(await running).toEqual({ role: 'repo_admin', truncated: false });
});

test('a failure stops new probes, waits for those in flight, and is thrown when none of them is an admin', async () => {
  const held = heldLookup();
  const { installationId, discover } = await tenantWith(12, held.lookup);
  const running = discover(VIEWER, installationId, new ProbeBudget(100));
  const settled = running.then(
    () => 'resolved',
    (error: unknown) => error,
  );
  await vi.waitFor(() => {
    expect(held.open()).toBe(5);
  });
  const outage = new GitHubUnavailableError('down');
  held.fail(outage);
  held.fail(new GitHubRateLimitedError(30, 'primary'));
  held.answer(false);
  held.answer(false);
  held.answer(false);
  expect(await settled).toBe(outage);
  expect(held.started).toHaveLength(5);
});

test('an admin among the probes in flight beats a failure: it is an answer', async () => {
  const held = heldLookup();
  const { installationId, discover } = await tenantWith(5, held.lookup);
  const running = discover(VIEWER, installationId, new ProbeBudget(100));
  await vi.waitFor(() => {
    expect(held.open()).toBe(5);
  });
  held.fail(new GitHubUnavailableError('down'));
  held.answer(true);
  held.answer(false);
  held.answer(false);
  held.answer(false);
  expect(await running).toEqual({ role: 'repo_admin', truncated: false });
});

test('a probe answered from the cache spends nothing: the budget pays for the calls that reached GitHub only', async () => {
  const cached = new Set(namesOf(1, [1, 2, 3, 4]));
  const { installationId, discover } = await tenantWith(10, (_installation, repository, _viewer, budget) => {
    if (!cached.has(repository.full_name)) {
      budget?.spend();
    }
    return Promise.resolve(false);
  });
  const budget = new ProbeBudget(10);
  expect(await discover(VIEWER, installationId, budget)).toEqual({ role: 'none', truncated: false });
  expect(budget.remaining).toBe(4);
});

test('a budget that runs out under the probes (spent elsewhere in the request) ends the discovery truncated, not failed', async () => {
  const budget = new ProbeBudget(6);
  let asked = 0;
  const { installationId, discover } = await tenantWith(6, (_installation, _repository, _viewer, spendFrom) => {
    asked += 1;
    spendFrom?.spend();
    if (asked === 1) {
      budget.spend();
    }
    return Promise.resolve(false);
  });
  expect(await discover(VIEWER, installationId, budget)).toEqual({ role: 'none', truncated: true });
  expect(asked).toBe(6);
  expect(budget.remaining).toBe(0);
});
