// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { repositoryPageSchema } from '../../../shared/installations.ts';
import {
  bodyOf,
  failureOf,
  listRepositories,
  namesOfPage,
  storeRepositories,
} from './installation-list-fixture/test-support.ts';
import { type GuardWorld, guardWorld } from './tenant-guard-fixture/test-support.ts';

// The paging and the two filters of GET /api/installations/:installationId/repositories (E14-S01), read as the org admin of
// tenant 1, who sees every repository that is not removed: `org-1/repo-1` and `org-1/repo-2` of the guard world, and the ones
// a test stores.

const NAMES = ['org-1/alpha', 'org-1/delta', 'org-1/epsilon', 'org-1/gamma', 'org-1/zeta'];
/** Every repository of tenant 1 that is listed once `NAMES` are stored, in the order of the list. */
const ALL = [...NAMES.slice(0, 4), 'org-1/repo-1', 'org-1/repo-2', 'org-1/zeta'];

async function withNames(names: readonly string[] = NAMES): Promise<GuardWorld> {
  const world = await guardWorld();
  await storeRepositories(world, { n: 1, installationId: world.tenants.t1 }, names);
  return world;
}

/** Follows `nextCursor` from the first page with `query` until the last, answering the names of each page. */
async function walk(world: GuardWorld, query: string): Promise<string[][]> {
  const pages: string[][] = [];
  let cursor: string | null = null;
  do {
    const suffix = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
    const response = await listRepositories(world, 'admin1', world.tenants.t1, `?${query}${suffix}`);
    expect(response.statusCode).toBe(200);
    const page = bodyOf(response, repositoryPageSchema);
    pages.push(page.items.map((item) => item.fullName));
    cursor = page.nextCursor;
  } while (cursor !== null);
  return pages;
}

test('the list is ordered by full name and the first page has the default of 50 rows, the next page the rest', async () => {
  const world = await guardWorld();
  const names = Array.from({ length: 60 }, (_unused, index) => `org-1/bulk-${String(index).padStart(2, '0')}`);
  await storeRepositories(world, { n: 1, installationId: world.tenants.t1 }, names);
  const first = bodyOf(await listRepositories(world, 'admin1', world.tenants.t1), repositoryPageSchema);
  expect(first.items).toHaveLength(50);
  expect(first.items.map((item) => item.fullName)).toEqual(names.slice(0, 50));
  expect(first.nextCursor).not.toBeNull();
  const second = await listRepositories(world, 'admin1', world.tenants.t1, `?cursor=${first.nextCursor}`);
  expect(namesOfPage(second)).toEqual([...names.slice(50), 'org-1/repo-1', 'org-1/repo-2']);
  expect(bodyOf(second, repositoryPageSchema).nextCursor).toBeNull();
});

test('a limit of 100 reads up to 100 rows at once', async () => {
  const world = await guardWorld();
  const names = Array.from({ length: 105 }, (_unused, index) => `org-1/bulk-${String(index).padStart(3, '0')}`);
  await storeRepositories(world, { n: 1, installationId: world.tenants.t1 }, names);
  const page = bodyOf(await listRepositories(world, 'admin1', world.tenants.t1, '?limit=100'), repositoryPageSchema);
  expect(page.items).toHaveLength(100);
  expect(page.nextCursor).not.toBeNull();
});

test.each([1, 2, 3, 7, 8])(
  'pages of %i repositories cover the list once, with no repository skipped or repeated',
  async (limit) => {
    const world = await withNames();
    const pages = await walk(world, `limit=${limit}`);
    expect(pages.flat()).toEqual(ALL);
    expect(pages.slice(0, -1).every((page) => page.length === limit)).toBe(true);
    expect(pages.at(-1)?.length).toBeGreaterThanOrEqual(1);
  },
);

test('a page that ends exactly where the list ends has no next page', async () => {
  const world = await withNames();
  const response = await listRepositories(world, 'admin1', world.tenants.t1, '?limit=7');
  expect(bodyOf(response, repositoryPageSchema).nextCursor).toBeNull();
});

test('repositories with the same full name are told apart by id: paging by one neither skips nor repeats them', async () => {
  const world = await guardWorld();
  const names = ['org-1/twin', 'org-1/twin', 'org-1/twin', 'org-1/other'];
  await storeRepositories(world, { n: 1, installationId: world.tenants.t1 }, names);
  const pages = await walk(world, 'limit=1');
  expect(pages.flat()).toEqual([
    'org-1/other',
    'org-1/repo-1',
    'org-1/repo-2',
    'org-1/twin',
    'org-1/twin',
    'org-1/twin',
  ]);
  const ids = bodyOf(await listRepositories(world, 'admin1', world.tenants.t1), repositoryPageSchema).items.map(
    (item) => item.id,
  );
  expect(new Set(ids).size).toBe(ids.length);
});

test('a cursor that points past the last repository gives an empty page and no next one', async () => {
  const world = await withNames();
  const last = bodyOf(await listRepositories(world, 'admin1', world.tenants.t1, '?limit=6'), repositoryPageSchema);
  const lastPage = bodyOf(
    await listRepositories(world, 'admin1', world.tenants.t1, `?limit=6&cursor=${last.nextCursor}`),
    repositoryPageSchema,
  );
  expect(lastPage.items.map((item) => item.fullName)).toEqual(['org-1/zeta']);
  expect(lastPage.nextCursor).toBeNull();
});

test('q is a case-insensitive substring of the full name, and the paging goes on inside the filter', async () => {
  const world = await withNames(['org-1/Parser', 'org-1/html-parser', 'org-1/other', 'org-1/PARSER-cli']);
  expect(namesOfPage(await listRepositories(world, 'admin1', world.tenants.t1, '?q=parser'))).toEqual([
    'org-1/PARSER-cli',
    'org-1/Parser',
    'org-1/html-parser',
  ]);
  const pages = await walk(world, 'q=PARSER&limit=2');
  expect(pages.map((page) => page.length)).toEqual([2, 1]);
  expect(pages.flat()).toHaveLength(3);
  expect(pages.flat()).toEqual(expect.arrayContaining(['org-1/PARSER-cli', 'org-1/Parser', 'org-1/html-parser']));
  expect(namesOfPage(await listRepositories(world, 'admin1', world.tenants.t1, '?q=1%2Fh'))).toEqual([
    'org-1/html-parser',
  ]);
  expect(namesOfPage(await listRepositories(world, 'admin1', world.tenants.t1, '?q=nothing-like-it'))).toEqual([]);
});

// The names GitHub never gives a repository, but which the database stores, and which make a LIKE pattern misbehave unless the
// characters of the pattern are written as they are.
const TRICKY = ['org-1/100%-sure', 'org-1/under_score', 'org-1/back\\slash', 'org-1/plain', 'org-1/a_c', 'org-1/abc'];

test.each([
  ['%', '%25', ['org-1/100%-sure']],
  ['_', '_', ['org-1/a_c', 'org-1/under_score']],
  ['a backslash', '%5C', ['org-1/back\\slash']],
  ['a_c', 'a_c', ['org-1/a_c']],
  ['%-s', '%25-s', ['org-1/100%-sure']],
  ['a backslash then s', '%5Cs', ['org-1/back\\slash']],
] as const)(
  'q=%s matches the names that contain it as it is written, not as a wildcard',
  async (_label, encoded, names) => {
    const world = await withNames(TRICKY);
    expect(namesOfPage(await listRepositories(world, 'admin1', world.tenants.t1, `?q=${encoded}`))).toEqual(names);
  },
);

test('enabled=true lists only the repositories that enforce the CLA, enabled=false the others, and no filter all of them', async () => {
  const world = await withNames();
  await world.db
    .updateTable('repositories')
    .set({ enabled: true })
    .where('full_name', 'in', ['org-1/delta', 'org-1/repo-2'])
    .execute();
  const asked = (query: string) => listRepositories(world, 'admin1', world.tenants.t1, query);
  expect(namesOfPage(await asked('?enabled=true'))).toEqual(['org-1/delta', 'org-1/repo-2']);
  expect(namesOfPage(await asked('?enabled=false'))).toEqual([
    'org-1/alpha',
    'org-1/epsilon',
    'org-1/gamma',
    'org-1/repo-1',
    'org-1/zeta',
  ]);
  expect(namesOfPage(await asked(''))).toEqual(ALL);
  expect(namesOfPage(await asked('?enabled=true&q=REPO'))).toEqual(['org-1/repo-2']);
  const pages = await walk(world, 'enabled=false&limit=2');
  expect(pages.map((page) => page.length)).toEqual([2, 2, 1]);
});

test.each([
  ['a limit of 0', 'limit=0'],
  ['a limit of 101', 'limit=101'],
  ['a negative limit', 'limit=-1'],
  ['a fractional limit', 'limit=1.5'],
  ['a limit that is not a number', 'limit=abc'],
  ['a limit given twice', 'limit=1&limit=2'],
  ['an empty q', 'q='],
  ['a q of 141 characters', `q=${'a'.repeat(141)}`],
  ['a q with a NUL', 'q=a%00b'],
  ['an enabled that is not true or false', 'enabled=yes'],
  ['an enabled of 1', 'enabled=1'],
  ['a parameter the list does not know', 'sort=name'],
  ['the installation id as a parameter', 'installationId=1'],
  ['a cursor that is not base64url', 'cursor=%25%25%25'],
  ['a cursor that is not JSON', `cursor=${Buffer.from('not json').toString('base64url')}`],
  ['a cursor that is JSON of another shape', `cursor=${Buffer.from('["org-1/x"]').toString('base64url')}`],
  ['a cursor with an id that is not positive', `cursor=${Buffer.from('["org-1/x",0]').toString('base64url')}`],
  ['a cursor with a name that is not text', `cursor=${Buffer.from('[1,2]').toString('base64url')}`],
  ['a cursor with a NUL in the name', `cursor=${Buffer.from('["a\\u0000b",1]').toString('base64url')}`],
  [
    'a cursor with a name of 257 characters',
    `cursor=${Buffer.from(JSON.stringify(['a'.repeat(257), 1])).toString('base64url')}`,
  ],
  ['an empty cursor', 'cursor='],
])('%s is a 400 bad_request', async (_label, query) => {
  const world = await guardWorld();
  const response = await listRepositories(world, 'admin1', world.tenants.t1, `?${query}`);
  expect(failureOf(response)).toEqual([400, 'bad_request']);
});
