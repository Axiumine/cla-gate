// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { detailsOf } from '../domain/pending-details-fixture/test-support.ts';
import { scopeDocuments } from './discovery-fixture/test-support.ts';
import { id } from './github-contract/test-support.ts';
import { listPendingPrs, type PendingRequest } from './pending-prs.ts';
import { GitHubUnavailableError } from './ports/github-errors.ts';
import { recordingLookup } from './recording-lookup-fixture/test-support.ts';
import { VIEWER } from './role-fixture/test-support.ts';
import { worldOfTwoTenants } from './store-fixture/test-support.ts';

// Which repositories the pending pull requests may come from, below the HTTP layer (E15-S07): what an org admin and a repository admin are
// given, which repositories a request asks the role lookup about (only the ones that have a pending pull request, 50 at most), and what a
// lookup that fails does. The lookup is a stand-in that says what it is told to and records every repository it was asked about.

const EVERYTHING: PendingRequest = { repositoryId: null, reason: null, limit: 100, from: null };

const nameOf = (n: number, index: number): string => `org-${n}/repo-${String(index).padStart(3, '0')}`;

type World = Awaited<ReturnType<typeof worldOfTwoTenants>>;

/**
 * Stores `repo-<index>` of tenant `n` for each index, switched on and enforcing a repo-scoped document of its own, with a failed
 * evaluation of pull request 1 when `failing` is true; returns the ids of the repositories by name.
 */
async function ownedRepositories(world: World, n: 1 | 2, indexes: readonly number[], failing = true) {
  const tenant = n === 1 ? world.a : world.b;
  const names = indexes.map((index) => nameOf(n, index));
  await world.store.upsertRepositories(
    tenant.installation.id,
    indexes.map((index) => ({ githubRepoId: id(n * 10_000 + index), fullName: nameOf(n, index) })),
  );
  await scopeDocuments(world.db, tenant.installation.id, names);
  const rows = await world.db
    .selectFrom('repositories as r')
    .innerJoin('cla_documents as d', 'd.repository_id', 'r.id')
    .select(['r.id as repositoryId', 'r.full_name as fullName', 'd.id as documentId'])
    .where('r.installation_id', '=', tenant.installation.id)
    .where('r.full_name', 'in', names)
    .orderBy('r.id')
    .execute();
  for (const row of rows) {
    await world.db
      .updateTable('repositories')
      .set({ enabled: true, cla_document_id: row.documentId })
      .where('id', '=', row.repositoryId)
      .execute();
  }
  if (failing) {
    await failIn(
      world,
      n,
      rows.map((row) => row.repositoryId),
    );
  }
  return new Map(rows.map((row) => [row.fullName, row.repositoryId]));
}

/** A failed evaluation of pull request 1 in each repository of tenant `n` in `repositoryIds`. */
async function failIn(
  world: World,
  n: 1 | 2,
  repositoryIds: readonly number[],
  codes: 'unsigned' | 'bot' = 'unsigned',
) {
  const tenant = n === 1 ? world.a : world.b;
  const details =
    codes === 'unsigned'
      ? detailsOf({ codes: ['unsigned_contributor'], actors: [{ githubId: 500 }] })
      : detailsOf({ codes: ['bot_not_allowlisted'], actors: [{ githubId: 501, bot: true }] });
  await world.db
    .insertInto('pr_evaluations')
    .values(
      repositoryIds.map((repositoryId) => ({
        installation_id: tenant.installation.id,
        repository_id: repositoryId,
        pr_number: 1,
        head_sha: 'a'.repeat(40),
        result: 'failure' as const,
        details: JSON.stringify(details),
      })),
    )
    .execute();
}

async function setup(administered: ReadonlySet<string> | 'all' = 'all') {
  const world = await worldOfTwoTenants();
  const recorder = recordingLookup(administered);
  const forTenant = (tenant: typeof world.a, role: 'org_admin' | 'repo_admin') => ({
    installationId: tenant.installation.id,
    role,
  });
  return {
    ...world,
    ...recorder,
    deps: { db: world.db, lookup: recorder.lookup },
    forTenant,
    owned: (n: 1 | 2, indexes: readonly number[], failing = true) => ownedRepositories(world, n, indexes, failing),
    fail: (n: 1 | 2, repositoryIds: readonly number[], codes: 'unsigned' | 'bot') =>
      failIn(world, n, repositoryIds, codes),
  };
}

const namesOfPage = (page: Awaited<ReturnType<typeof listPendingPrs>>): string[] =>
  page?.items.map((item) => item.repository.fullName) ?? [];

test('an org admin is given every served repository of the installation and no lookup of any permission is made', async () => {
  const { asked, deps, forTenant, a, owned } = await setup();
  await owned(1, [3, 4]);
  const page = await listPendingPrs(deps, forTenant(a, 'org_admin'), VIEWER, EVERYTHING);
  expect(namesOfPage(page).sort((a, b) => a.localeCompare(b))).toEqual([nameOf(1, 3), nameOf(1, 4)]);
  expect(page?.truncated).toBe(false);
  expect(asked).toEqual([]);
});

test('a repository admin is given the repositories the lookup confirms, and only repositories with a pending pull request are asked about', async () => {
  const { asked, deps, forTenant, a, owned } = await setup(new Set([nameOf(1, 4)]));
  await owned(1, [3, 4]);
  await owned(1, [5], false);
  const page = await listPendingPrs(deps, forTenant(a, 'repo_admin'), VIEWER, EVERYTHING);
  expect(namesOfPage(page)).toEqual([nameOf(1, 4)]);
  expect(asked.map((call) => call.fullName)).toEqual([nameOf(1, 3), nameOf(1, 4)]);
  expect(asked.map((call) => [call.installation, call.githubInstallationId, call.githubRepoId])).toEqual([
    [a.installation.id, 100, 10_003],
    [a.installation.id, 100, 10_004],
  ]);
});

test('a repository that enforces the document of the installation is not reached by a repository admin, although it holds one of its own, and no lookup is made for it', async () => {
  const { asked, db, deps, forTenant, a, owned } = await setup();
  const repositories = await owned(1, [3]);
  const [installationDocument] = await db
    .insertInto('cla_documents')
    .values({
      installation_id: a.installation.id,
      repository_id: null,
      name: 'Org CLA',
      kind: 'individual',
      active_version_id: null,
    })
    .returning('id')
    .execute();
  await db
    .updateTable('repositories')
    .set({ cla_document_id: installationDocument?.id ?? 0 })
    .where('id', '=', repositories.get(nameOf(1, 3)) ?? 0)
    .execute();
  const page = await listPendingPrs(deps, forTenant(a, 'repo_admin'), VIEWER, EVERYTHING);
  expect(page).toEqual({ items: [], next: null, truncated: false });
  expect(asked).toEqual([]);
  expect(namesOfPage(await listPendingPrs(deps, forTenant(a, 'org_admin'), VIEWER, EVERYTHING))).toEqual([
    nameOf(1, 3),
  ]);
});

test('a repository admin who administers none is given an empty page, which is not every pull request', async () => {
  const { deps, forTenant, a, owned } = await setup(new Set());
  await owned(1, [3]);
  expect(await listPendingPrs(deps, forTenant(a, 'repo_admin'), VIEWER, EVERYTHING)).toEqual({
    items: [],
    next: null,
    truncated: false,
  });
});

test('the reason narrows the repositories that are asked about: one with no pull request of that reason costs no lookup', async () => {
  const { asked, deps, fail, forTenant, a, owned } = await setup();
  const repositories = await owned(1, [3, 4], false);
  await fail(1, [repositories.get(nameOf(1, 3)) ?? 0], 'unsigned');
  await fail(1, [repositories.get(nameOf(1, 4)) ?? 0], 'bot');
  const page = await listPendingPrs(deps, forTenant(a, 'repo_admin'), VIEWER, {
    ...EVERYTHING,
    reason: 'bot_not_allowlisted',
  });
  expect(namesOfPage(page)).toEqual([nameOf(1, 4)]);
  expect(asked.map((call) => call.fullName)).toEqual([nameOf(1, 4)]);
});

test('a repository admin is asked about at most 50 repositories, and the page says it was cut when more had pending pull requests', async () => {
  const { asked, deps, forTenant, a, owned } = await setup();
  await owned(
    1,
    Array.from({ length: 60 }, (_unused, index) => index + 3),
  );
  const page = await listPendingPrs(deps, forTenant(a, 'repo_admin'), VIEWER, EVERYTHING);
  expect(asked).toHaveLength(50);
  expect(page?.truncated).toBe(true);
  expect(page?.items).toHaveLength(50);
  expect(asked.map((call) => call.fullName)).toEqual(
    Array.from({ length: 50 }, (_unused, index) => nameOf(1, index + 3)),
  );
});

test('exactly 50 repositories with pending pull requests are all asked about and the page is not cut', async () => {
  const { asked, deps, forTenant, a, owned } = await setup();
  await owned(
    1,
    Array.from({ length: 50 }, (_unused, index) => index + 3),
  );
  const page = await listPendingPrs(deps, forTenant(a, 'repo_admin'), VIEWER, EVERYTHING);
  expect([asked.length, page?.truncated, page?.items.length]).toEqual([50, false, 50]);
});

test('a repository admin of a repository beyond the 50 reaches it by naming it: one lookup, not fifty', async () => {
  const { asked, deps, forTenant, a, owned } = await setup(new Set([nameOf(1, 62)]));
  const repositories = await owned(
    1,
    Array.from({ length: 60 }, (_unused, index) => index + 3),
  );
  const page = await listPendingPrs(deps, forTenant(a, 'repo_admin'), VIEWER, {
    ...EVERYTHING,
    repositoryId: repositories.get(nameOf(1, 62)) ?? 0,
  });
  expect(namesOfPage(page)).toEqual([nameOf(1, 62)]);
  expect(page?.truncated).toBe(false);
  expect(asked.map((call) => call.fullName)).toEqual([nameOf(1, 62)]);
});

test('a repository of another tenant, or one that does not exist, is none, for an org admin and for a repository admin, with no lookup', async () => {
  const { asked, deps, forTenant, a, owned } = await setup();
  const foreign = await owned(2, [3]);
  for (const role of ['org_admin', 'repo_admin'] as const) {
    for (const repositoryId of [foreign.get(nameOf(2, 3)) ?? 0, 987_654]) {
      expect(await listPendingPrs(deps, forTenant(a, role), VIEWER, { ...EVERYTHING, repositoryId })).toBeNull();
    }
  }
  expect(asked).toEqual([]);
});

test('the lookups of a request run five at a time', async () => {
  const { deps, forTenant, a, owned, state } = await setup();
  await owned(
    1,
    Array.from({ length: 30 }, (_unused, index) => index + 3),
  );
  await listPendingPrs(deps, forTenant(a, 'repo_admin'), VIEWER, EVERYTHING);
  expect(state.mostRunning).toBe(5);
});

test('a lookup that fails fails the request, repository named or not: it is never an empty list', async () => {
  const { db, forTenant, a, owned } = await setup();
  const repositories = await owned(1, [3]);
  const deps = { db, lookup: () => Promise.reject(new GitHubUnavailableError('down')) };
  await expect(listPendingPrs(deps, forTenant(a, 'repo_admin'), VIEWER, EVERYTHING)).rejects.toBeInstanceOf(
    GitHubUnavailableError,
  );
  await expect(
    listPendingPrs(deps, forTenant(a, 'repo_admin'), VIEWER, {
      ...EVERYTHING,
      repositoryId: repositories.get(nameOf(1, 3)) ?? 0,
    }),
  ).rejects.toBeInstanceOf(GitHubUnavailableError);
});

test('the pull requests of a repository that is not served are not read at all: an installation that is suspended gives an empty page to an org admin', async () => {
  const { db, deps, forTenant, a, owned } = await setup();
  await owned(1, [3]);
  await db.updateTable('installations').set({ suspended_at: new Date() }).where('id', '=', a.installation.id).execute();
  expect(await listPendingPrs(deps, forTenant(a, 'org_admin'), VIEWER, EVERYTHING)).toEqual({
    items: [],
    next: null,
    truncated: false,
  });
});
