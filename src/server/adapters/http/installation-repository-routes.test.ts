// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { repositoryPageSchema } from '../../../shared/installations.ts';
import { scopeDocuments } from '../../services/discovery-fixture/test-support.ts';
import { id } from '../../services/github-contract/test-support.ts';
import { repoId } from '../../services/store-fixture/test-support.ts';
import {
  attachDocument,
  bodyOf,
  failureOf,
  listRepositories,
  namesOfPage,
  storeDocument,
} from './installation-list-fixture/test-support.ts';
import { type GuardWorld, guardWorld, PEOPLE } from './tenant-guard-fixture/test-support.ts';

// GET /api/installations/:installationId/repositories (E14-S01): who sees which repositories, and what each row says about the
// document the repository enforces and about the viewer. Tenant 1 of the guard world has `repo-1` and `repo-2` (each with a
// repo-scoped document stored, none attached yet) and a removed `repo-3`; `admin1` administers the organisation, `repoAdmin1`
// only `repo-1` and `repoAdminOther` only `repo-2`.

test('an org admin is shown every repository that is not removed, by full name, each with the rule applied to them', async () => {
  const world = await guardWorld();
  const response = await listRepositories(world, 'admin1', world.tenants.t1);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(bodyOf(response, repositoryPageSchema)).toEqual({
    items: [
      {
        id: world.repositories.t1r1,
        githubRepoId: repoId(1, 1),
        fullName: 'org-1/repo-1',
        enabled: false,
        canAdminister: true,
        document: null,
      },
      {
        id: world.repositories.t1r2,
        githubRepoId: repoId(1, 2),
        fullName: 'org-1/repo-2',
        enabled: false,
        canAdminister: true,
        document: null,
      },
    ],
    nextCursor: null,
  });
});

test.each([
  ['repoAdmin1', ['org-1/repo-1']],
  ['repoAdminOther', ['org-1/repo-2']],
] as const)('%s is shown only the repository GitHub says they administer', async (person, names) => {
  const world = await guardWorld();
  const response = await listRepositories(world, person, world.tenants.t1);
  expect(response.statusCode).toBe(200);
  expect(namesOfPage(response)).toEqual(names);
});

test('a repository admin who lost the permission is told nothing about the repository once the minute of the role cache is over', async () => {
  const world = await guardWorld();
  expect(namesOfPage(await listRepositories(world, 'repoAdmin1', world.tenants.t1))).toEqual(['org-1/repo-1']);
  world.fake.addRepositoryPermission(id(100), 'org-1/repo-1', `login-${PEOPLE.repoAdmin1}`, {
    permission: 'read',
    userId: id(PEOPLE.repoAdmin1),
  });
  world.clock.advance(61_000);
  const response = await listRepositories(world, 'repoAdmin1', world.tenants.t1);
  expect(failureOf(response)).toEqual([404, 'not_found']);
});

test('a plain member of the organisation has no role in it: 404', async () => {
  const world = await guardWorld();
  expect(failureOf(await listRepositories(world, 'member1', world.tenants.t1))).toEqual([404, 'not_found']);
});

test('an org admin costs no lookup of a repository permission, and a repository admin costs one for each repository asked about, once a minute', async () => {
  const world = await guardWorld();
  const permissionCalls = () => world.fake.calls.filter((call) => call.method === 'getRepositoryPermission').length;
  await listRepositories(world, 'admin1', world.tenants.t1);
  expect(permissionCalls()).toBe(0);
  await listRepositories(world, 'repoAdmin1', world.tenants.t1);
  const first = permissionCalls();
  expect(first).toBeGreaterThanOrEqual(1);
  expect(first).toBeLessThanOrEqual(2);
  await listRepositories(world, 'repoAdmin1', world.tenants.t1);
  expect(permissionCalls()).toBe(first);
});

test('a removed repository is never listed, though it carries a document and GitHub says the person administers it', async () => {
  const world = await guardWorld();
  await scopeDocuments(world.db, world.tenants.t1, ['org-1/repo-3']);
  world.fake.addRepositoryPermission(id(100), 'org-1/repo-3', `login-${PEOPLE.repoAdmin1}`, {
    permission: 'admin',
    userId: id(PEOPLE.repoAdmin1),
  });
  expect(namesOfPage(await listRepositories(world, 'admin1', world.tenants.t1))).toEqual([
    'org-1/repo-1',
    'org-1/repo-2',
  ]);
  expect(namesOfPage(await listRepositories(world, 'repoAdmin1', world.tenants.t1))).toEqual(['org-1/repo-1']);
  expect(
    world.fake.calls.some((call) => call.method === 'getRepositoryPermission' && call.installationId === id(100)),
  ).toBe(true);
});

interface Attached {
  readonly id: number;
  readonly name: string;
  readonly scope: 'installation' | 'repository';
  readonly activeVersion: { readonly major: number; readonly minor: number } | null;
}

/** Stores a document of tenant 1 scoped to `scopedTo` (a repository row id, or null for the installation) and attaches it to `repo-1`. */
async function attachToRepo1(
  world: GuardWorld,
  name: string,
  scopedTo: number | null,
  active?: Attached['activeVersion'],
): Promise<Attached> {
  const documentId = await storeDocument(world, world.tenants.t1, {
    name,
    repositoryId: scopedTo,
    ...(active === undefined || active === null ? {} : { active }),
  });
  await attachDocument(world, world.repositories.t1r1, documentId);
  return {
    id: documentId,
    name,
    scope: scopedTo === null ? 'installation' : 'repository',
    activeVersion: active ?? null,
  };
}

// What the repository-action rule makes of `repo-1` in each state of its document, for the org admin and for the admin of that
// repository: only a document scoped to this very repository lets the repository admin act.
const DOCUMENT_STATES: readonly (readonly [string, (world: GuardWorld) => Promise<Attached | null>, boolean])[] = [
  ['no document', () => Promise.resolve(null), false],
  ['an installation-scoped document', (world) => attachToRepo1(world, 'Installation CLA', null), false],
  [
    'a document scoped to the repository, with an active version',
    (world) => attachToRepo1(world, 'Own CLA', world.repositories.t1r1, { major: 2, minor: 3 }),
    true,
  ],
  [
    'a document scoped to the repository, with none active',
    (world) => attachToRepo1(world, 'Own CLA', world.repositories.t1r1),
    true,
  ],
  [
    'a document scoped to another repository (which the rule does not trust)',
    (world) => attachToRepo1(world, 'Other CLA', world.repositories.t1r2),
    false,
  ],
];

test.each(DOCUMENT_STATES)(
  '%s: the row shows the document, and who may administer the repository',
  async (_label, attach, repoAdminMay) => {
    const world = await guardWorld();
    const document = await attach(world);
    const asAdmin = bodyOf(await listRepositories(world, 'admin1', world.tenants.t1), repositoryPageSchema);
    const asRepoAdmin = bodyOf(await listRepositories(world, 'repoAdmin1', world.tenants.t1), repositoryPageSchema);
    expect(asAdmin.items.map((item) => [item.fullName, item.canAdminister, item.document])).toEqual([
      ['org-1/repo-1', true, document],
      ['org-1/repo-2', true, null],
    ]);
    expect(asRepoAdmin.items.map((item) => [item.fullName, item.canAdminister, item.document])).toEqual([
      ['org-1/repo-1', repoAdminMay, document],
    ]);
  },
);
