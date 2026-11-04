// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  allowlistWorld,
  installationPageOf,
  listInstallationAs,
  listRepositoryAs,
  repositoryPageOf,
  storeEntries,
} from './allowlist-list-fixture/test-support.ts';
import { errorCodeOf } from './document-fixture/test-support.ts';

// `GET .../allowlist-entries` of an installation and of a repository (E14-S07): what an item holds, the order, the sections of the list
// of a repository, the read-only flag, the page size and the cursor. The roles are in allowlist-entry-list-rules.test.ts, the other tenant
// in allowlist-entry-list-tenants.test.ts.

/**
 * Entries of tenant 1 that cover the installation, in the order the list shows them with the world's own (a user with no login, GitHub
 * id 100, the lowest id): `kind` bot, org_members, user; within a kind the login ascending and the entries with none last, by id.
 */
const INSTALLATION_ORDER = [202, 201, 7000, 302, 303, 301, 100, 304] as const;

/** Stores the entries above for tenant 1 in an order that is not the order of the list. */
async function installationEntries(world: Awaited<ReturnType<typeof allowlistWorld>>) {
  const { t1, people } = world;
  const make = (kind: 'user' | 'bot' | 'org_members', githubId: number, loginSnapshot: string | null) => ({
    installationId: t1.installationId,
    repositoryId: null,
    kind,
    githubId,
    loginSnapshot,
    createdBy: people.admin1.userId,
  });
  return storeEntries(world, [
    make('bot', 201, 'zz-bot[bot]'),
    make('user', 301, 'carol'),
    make('user', 302, 'alice'),
    make('bot', 202, 'aa-bot[bot]'),
    make('user', 303, 'alice'),
    make('org_members', 7000, 'org-1'),
    make('user', 304, null),
  ]);
}

/** Entries of the plain repository of tenant 1: the list of the repository shows them with the world's own (a user with no login, GitHub id 101). */
async function repositoryEntries(world: Awaited<ReturnType<typeof allowlistWorld>>) {
  const { t1, people } = world;
  const make = (kind: 'user' | 'bot', githubId: number, loginSnapshot: string) => ({
    installationId: t1.installationId,
    repositoryId: t1.plain.repositoryId,
    kind,
    githubId,
    loginSnapshot,
    createdBy: people.admin1.userId,
  });
  return storeEntries(world, [make('user', 401, 'bob'), make('bot', 402, 'dependabot[bot]')]);
}

/** The own entries of the plain repository of tenant 1 in the order of the list, by GitHub id. */
const REPOSITORY_ORDER = [402, 401, 101] as const;

test('the list of an installation holds the entries that cover it, kind then login then id, with the entries that have no login last', async () => {
  const world = await allowlistWorld();
  await installationEntries(world);
  await repositoryEntries(world);
  const response = await listInstallationAs(world, 'admin1', world.t1.installationId);
  expect(response.statusCode).toBe(200);
  const page = installationPageOf(response);
  expect(page.entries.map((entry) => entry.githubId)).toEqual([...INSTALLATION_ORDER]);
  expect(page.nextCursor).toBeNull();
});

test('an item names its scope, repository, kind, GitHub id, login snapshot, the person who made it by id and login, and the time', async () => {
  const world = await allowlistWorld();
  const { t1, people } = world;
  const [id] = await storeEntries(world, [
    {
      installationId: t1.installationId,
      repositoryId: null,
      kind: 'user',
      githubId: 4711,
      loginSnapshot: 'Ada-Lovelace',
      createdBy: people.member1.userId,
    },
  ]);
  await world.db.updateTable('users').set({ login: 'member-one' }).where('id', '=', people.member1.userId).execute();
  const row = await world.db
    .selectFrom('allowlist_entries')
    .select('created_at')
    .where('id', '=', id ?? 0)
    .executeTakeFirstOrThrow();
  const page = installationPageOf(await listInstallationAs(world, 'admin1', t1.installationId));
  expect(page.entries.find((entry) => entry.id === id)).toEqual({
    id,
    scope: 'installation',
    repositoryId: null,
    kind: 'user',
    githubId: 4711,
    loginSnapshot: 'Ada-Lovelace',
    createdBy: { githubId: people.member1.githubId, login: 'member-one' },
    createdAt: row.created_at.toISOString(),
    readOnly: false,
  });
});

test('the list of a repository has its own entries and the installation ones it inherits, flagged read-only, and nothing of another repository', async () => {
  const world = await allowlistWorld();
  const { t1, people } = world;
  await installationEntries(world);
  await repositoryEntries(world);
  await storeEntries(world, [
    {
      installationId: t1.installationId,
      repositoryId: t1.scoped.repositoryId,
      kind: 'user',
      githubId: 555,
      loginSnapshot: 'elsewhere',
      createdBy: people.admin1.userId,
    },
  ]);
  const page = repositoryPageOf(await listRepositoryAs(world, 'admin1', t1.plain.repositoryId));
  expect(page.own.map((entry) => [entry.githubId, entry.scope, entry.repositoryId, entry.readOnly])).toEqual(
    REPOSITORY_ORDER.map((githubId) => [githubId, 'repository', t1.plain.repositoryId, false]),
  );
  expect(page.inherited.map((entry) => [entry.githubId, entry.scope, entry.repositoryId, entry.readOnly])).toEqual(
    INSTALLATION_ORDER.map((githubId) => [githubId, 'installation', null, true]),
  );
  expect(page.nextCursor).toBeNull();
});

test('the entries of the installation are not read-only in the list of the installation', async () => {
  const world = await allowlistWorld();
  const page = installationPageOf(await listInstallationAs(world, 'admin1', world.t1.installationId));
  expect(page.entries.map((entry) => entry.readOnly)).toEqual([false]);
});

test('a repository with no entry of its own lists the ones of its installation', async () => {
  const world = await allowlistWorld();
  const scoped = repositoryPageOf(await listRepositoryAs(world, 'admin1', world.t1.scoped.repositoryId));
  expect(scoped.own).toEqual([]);
  expect(scoped.inherited.map((entry) => entry.githubId)).toEqual([100]);
});

/** The query of the page that starts at `cursor` (null for the first page) and holds at most `limit` entries. */
const pageQuery = (limit: number, cursor: string | null): string =>
  cursor === null ? `?limit=${String(limit)}` : `?limit=${String(limit)}&cursor=${encodeURIComponent(cursor)}`;

test.each([1, 2, 3, 5, 8, 100])(
  'a limit of %i walks the list of an installation page by page, in the same order, with no entry skipped or repeated',
  async (limit) => {
    const world = await allowlistWorld();
    await installationEntries(world);
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query = pageQuery(limit, cursor);
      const page = installationPageOf(await listInstallationAs(world, 'admin1', world.t1.installationId, query));
      expect(page.entries.length).toBeLessThanOrEqual(limit);
      seen.push(...page.entries.map((entry) => entry.githubId));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(seen).toEqual([...INSTALLATION_ORDER]);
    expect(pages).toBe(Math.ceil(INSTALLATION_ORDER.length / limit));
  },
);

test.each([1, 2, 3, 4, 11, 100])(
  'a limit of %i walks the list of a repository across its own entries and the inherited ones: at most the limit in all, own first',
  async (limit) => {
    const world = await allowlistWorld();
    await installationEntries(world);
    await repositoryEntries(world);
    const own: number[] = [];
    const inherited: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query = pageQuery(limit, cursor);
      const page = repositoryPageOf(await listRepositoryAs(world, 'admin1', world.t1.plain.repositoryId, query));
      expect(page.own.length + page.inherited.length).toBeLessThanOrEqual(limit);
      expect(inherited.length === 0 || page.own.length === 0).toBe(true);
      own.push(...page.own.map((entry) => entry.githubId));
      inherited.push(...page.inherited.map((entry) => entry.githubId));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(own).toEqual([...REPOSITORY_ORDER]);
    expect(inherited).toEqual([...INSTALLATION_ORDER]);
    expect(pages).toBe(Math.ceil((REPOSITORY_ORDER.length + INSTALLATION_ORDER.length) / limit));
  },
);

test('when the own entries fill a page exactly, the page has no inherited entry and its cursor starts the next page at the first of them', async () => {
  const world = await allowlistWorld();
  await installationEntries(world);
  await repositoryEntries(world);
  const first = repositoryPageOf(await listRepositoryAs(world, 'admin1', world.t1.plain.repositoryId, '?limit=3'));
  expect([first.own.length, first.inherited, first.nextCursor === null]).toEqual([3, [], false]);
  const query = `?limit=3&cursor=${encodeURIComponent(first.nextCursor ?? '')}`;
  const second = repositoryPageOf(await listRepositoryAs(world, 'admin1', world.t1.plain.repositoryId, query));
  expect(second.own).toEqual([]);
  expect(second.inherited.map((entry) => entry.githubId)).toEqual(INSTALLATION_ORDER.slice(0, 3));
});

test('a repository with nothing inherited ends its list on its own entries, with no cursor', async () => {
  const world = await allowlistWorld();
  await world.db.deleteFrom('allowlist_entries').where('id', '=', world.t1.entryId).execute();
  await repositoryEntries(world);
  const page = repositoryPageOf(await listRepositoryAs(world, 'admin1', world.t1.plain.repositoryId, '?limit=3'));
  expect([page.own.map((entry) => entry.githubId), page.inherited, page.nextCursor]).toEqual([
    [...REPOSITORY_ORDER],
    [],
    null,
  ]);
});

test('a cursor is a position and not a row: it still works after the entry it points at is removed', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  await installationEntries(world);
  const first = installationPageOf(await listInstallationAs(world, 'admin1', t1.installationId, '?limit=2'));
  expect(first.entries.map((entry) => entry.githubId)).toEqual([202, 201]);
  // The next page starts at the entry with GitHub id 7000.
  await world.db.deleteFrom('allowlist_entries').where('github_id', '=', 7000).execute();
  const query = `?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`;
  const second = installationPageOf(await listInstallationAs(world, 'admin1', t1.installationId, query));
  expect(second.entries.map((entry) => entry.githubId)).toEqual([302, 303]);
});

test('a page holds 100 entries when the request names no limit, up to 200 when it asks, and a limit above 200 is a 400', async () => {
  const world = await allowlistWorld();
  const { t1, people } = world;
  await world.db
    .insertInto('allowlist_entries')
    .values(
      Array.from({ length: 150 }, (_, index) => ({
        installation_id: t1.installationId,
        repository_id: null,
        kind: 'user' as const,
        github_id: 10_000 + index,
        login_snapshot: `user-${String(index).padStart(3, '0')}`,
        created_by: people.admin1.userId,
      })),
    )
    .execute();
  const byDefault = installationPageOf(await listInstallationAs(world, 'admin1', t1.installationId));
  expect([byDefault.entries.length, byDefault.nextCursor === null]).toEqual([100, false]);
  const all = installationPageOf(await listInstallationAs(world, 'admin1', t1.installationId, '?limit=200'));
  expect([all.entries.length, all.nextCursor]).toEqual([151, null]);
  const tooMany = await listInstallationAs(world, 'admin1', t1.installationId, '?limit=201');
  expect([tooMany.statusCode, errorCodeOf(tooMany)]).toEqual([400, 'bad_request']);
});

/** A cursor as a client would hold it: the base64url of the JSON of `position`. */
const cursorOf = (position: unknown): string =>
  `?cursor=${Buffer.from(JSON.stringify(position)).toString('base64url')}`;

test.each([
  ['a limit of 0', '?limit=0'],
  ['a limit above the most', '?limit=201'],
  ['a negative limit', '?limit=-1'],
  ['a limit with a leading zero', '?limit=010'],
  ['a limit that is not digits', '?limit=ten'],
  ['a fraction', '?limit=1.5'],
  ['an exponent', '?limit=1e2'],
  ['an empty limit', '?limit='],
  ['a limit named twice', '?limit=1&limit=2'],
  ['an empty cursor', '?cursor='],
  ['a cursor this server did not make', '?cursor=not-a-cursor'],
  ['a cursor that is JSON of the wrong shape', cursorOf({ id: 1 })],
  ['a cursor with a login that is markup', cursorOf(['user', '<b>', 1])],
  ['a cursor with a kind nobody has', cursorOf(['robot', null, 1])],
  ['a cursor with an id that is not positive', cursorOf(['user', null, 0])],
  ['a parameter nobody defined', '?q=ada'],
])('both lists answer 400 bad_request for %s', async (_label, query) => {
  const world = await allowlistWorld();
  const installation = await listInstallationAs(world, 'admin1', world.t1.installationId, query);
  const repository = await listRepositoryAs(world, 'admin1', world.t1.plain.repositoryId, query);
  expect([installation, repository].map((answer) => [answer.statusCode, errorCodeOf(answer)])).toEqual([
    [400, 'bad_request'],
    [400, 'bad_request'],
  ]);
});

test('the cursor of one list is a 400 for the other: the one of a repository names a section, the one of an installation does not', async () => {
  const world = await allowlistWorld();
  const installation = await listInstallationAs(
    world,
    'admin1',
    world.t1.installationId,
    cursorOf(['own', 'user', null, 1]),
  );
  const repository = await listRepositoryAs(world, 'admin1', world.t1.plain.repositoryId, cursorOf(['user', null, 1]));
  expect([installation.statusCode, repository.statusCode]).toEqual([400, 400]);
});

test('a cursor of a repository names the section it continues in, and one that names none is a 400', async () => {
  const world = await allowlistWorld();
  const unknownSection = await listRepositoryAs(
    world,
    'admin1',
    world.t1.plain.repositoryId,
    cursorOf(['both', 'user', null, 1]),
  );
  expect(unknownSection.statusCode).toBe(400);
});

test('both lists are told not to be cached', async () => {
  const world = await allowlistWorld();
  const installation = await listInstallationAs(world, 'admin1', world.t1.installationId);
  const repository = await listRepositoryAs(world, 'admin1', world.t1.plain.repositoryId);
  expect([installation.headers['cache-control'], repository.headers['cache-control']]).toEqual([
    'no-store',
    'no-store',
  ]);
});
