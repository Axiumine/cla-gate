// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { documentListResponseSchema, repositoryDocumentsResponseSchema } from '../../../shared/cla.ts';
import {
  createAs,
  type DocumentWorld,
  documentsPath,
  documentWorld,
  draftPath,
  errorCodeOf,
  fillDocuments,
  nameOf,
  parsed,
} from './document-fixture/test-support.ts';

// GET /api/installations/:installationId/documents and GET .../repositories/:repositoryId/documents (E12-S01): who sees
// which documents, in which order, and how a list is paged.

/** The first page of the list of tenant 1 as `admin1` asks for it, or the page `query` names. */
async function listPage(world: DocumentWorld, query = '') {
  return world.ask('admin1', { method: 'GET', url: `${documentsPath(world.t1.installationId)}${query}` });
}

/** Every page of the list, following the cursors, as the names in the order they arrive and the number of pages. */
async function allPages(world: DocumentWorld, limit: number) {
  const names: string[] = [];
  const ids: number[] = [];
  let pages = 0;
  let cursor: string | null = null;
  do {
    const cursorPart = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
    const response = await listPage(world, `?limit=${limit}${cursorPart}`);
    expect(response.statusCode).toBe(200);
    const page = parsed(response, documentListResponseSchema);
    expect(page.documents.length).toBeLessThanOrEqual(limit);
    names.push(...page.documents.map((document) => document.name));
    ids.push(...page.documents.map((document) => document.id));
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor !== null);
  return { names, ids, pages };
}

test('an org admin lists every document of the installation by name and id, with the active version, and no document of another tenant', async () => {
  const world = await documentWorld();
  const response = await listPage(world);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const page = parsed(response, documentListResponseSchema);
  expect(page.nextCursor).toBeNull();
  expect(page.documents.map((document) => [document.id, document.name, document.scope])).toEqual([
    [world.t1.documentId, 'Individual CLA', 'installation'],
    [world.t1.scoped.documentId, 'Repository CLA', 'repository'],
  ]);
  expect(page.documents[0]?.activeVersion).toEqual({
    id: world.t1.versionId,
    major: 1,
    minor: 0,
    contentSha256: world.t1.contentSha256,
    publishedAt: page.documents[0]?.activeVersion?.publishedAt,
  });
  expect(page.documents[1]).toMatchObject({ repositoryId: world.t1.scoped.repositoryId, activeVersion: null });
  expect(page.documents.map((document) => document.id)).not.toContain(world.t2.documentId);
});

test('each listed document says whether a draft is saved and names its repository, and a document of the installation has none (E18-S05)', async () => {
  const world = await documentWorld();
  const { documents } = parsed(await listPage(world), documentListResponseSchema);
  expect(documents.map((document) => [document.id, document.hasDraft, document.repositoryFullName])).toEqual([
    [world.t1.documentId, false, null],
    [world.t1.scoped.documentId, true, world.t1.scoped.fullName],
  ]);
});

test('a draft saved for a document of the installation turns its flag on and the other documents keep theirs; the other tenant is not read (E18-S05)', async () => {
  const world = await documentWorld();
  const saved = await world.ask('admin1', {
    method: 'PUT',
    url: draftPath(world.t1.installationId, world.t1.documentId),
    payload: { contentMd: 'A text.', expectedRevision: null },
  });
  expect(saved.statusCode).toBe(200);
  const { documents } = parsed(await listPage(world), documentListResponseSchema);
  expect(documents.map((document) => document.hasDraft)).toEqual([true, true]);
  const other = await world.ask('admin2', { method: 'GET', url: documentsPath(world.t2.installationId) });
  expect(parsed(other, documentListResponseSchema).documents.map((document) => document.hasDraft)).toEqual([
    false,
    true,
  ]);
});

test('a repo admin does not list the documents of the installation: 403', async () => {
  const world = await documentWorld();
  const response = await world.ask('repoAdmin1', { method: 'GET', url: documentsPath(world.t1.installationId) });
  expect([response.statusCode, errorCodeOf(response)]).toEqual([403, 'forbidden']);
});

test('pages of 3 follow the cursors through all the documents in order, none skipped and none repeated, also across equal names', async () => {
  const world = await documentWorld();
  await fillDocuments(world, world.t1.installationId, 4);
  await createAs(world, 'admin1', world.t1.installationId, {
    name: 'Same name',
    kind: 'individual',
    repositoryId: world.t1.plain.repositoryId,
  });
  await createAs(world, 'admin1', world.t1.installationId, { name: 'Same name', kind: 'individual' });
  const everything = await allPages(world, 100);
  const paged = await allPages(world, 3);
  expect(everything.names).toEqual([
    'Individual CLA',
    'Repository CLA',
    'Same name',
    'Same name',
    nameOf(1),
    nameOf(2),
    nameOf(3),
    nameOf(4),
  ]);
  expect(paged.pages).toBe(3);
  expect(paged).toEqual({ ...everything, pages: 3 });
  const single = await allPages(world, 1);
  expect(single).toEqual({ ...everything, pages: 8 });
});

test('a list with no limit holds 50 documents and a cursor to the rest; the last page has no cursor', async () => {
  const world = await documentWorld();
  await fillDocuments(world, world.t1.installationId, 58);
  const first = parsed(await listPage(world), documentListResponseSchema);
  expect(first.documents).toHaveLength(50);
  expect(first.nextCursor).not.toBeNull();
  const second = parsed(
    await listPage(world, `?cursor=${encodeURIComponent(first.nextCursor ?? '')}`),
    documentListResponseSchema,
  );
  expect(second.documents).toHaveLength(10);
  expect(second.nextCursor).toBeNull();
});

test('a limit that is not 1 to 100 in plain digits is 400 bad_request', async () => {
  const world = await documentWorld();
  const refused = ['0', '101', '-1', '1.5', '1e1', ' 5', '050', 'abc', '', '99999999999999999999'];
  for (const limit of refused) {
    const response = await listPage(world, `?limit=${encodeURIComponent(limit)}`);
    expect([response.statusCode, errorCodeOf(response)], limit).toEqual([400, 'bad_request']);
  }
  const accepted = await Promise.all(['1', '100'].map((limit) => listPage(world, `?limit=${limit}`)));
  expect(accepted.map((response) => response.statusCode)).toEqual([200, 200]);
});

test('a query key nobody defined is 400', async () => {
  const world = await documentWorld();
  expect((await listPage(world, '?installationId=2')).statusCode).toBe(400);
});

const cursorOf = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

/** Cursors nobody made: each is text that is not the base64url of a JSON list of a name and an id. */
const FORGED_CURSORS: readonly (readonly [string, string])[] = [
  ['text that is not base64url', 'not base64!'],
  ['one equals sign of padding', `${cursorOf(['a', 1])}=`],
  ['bytes that are not JSON', Buffer.from('not json', 'utf8').toString('base64url')],
  ['a JSON object', cursorOf({ name: 'a', id: 1 })],
  ['a list of one', cursorOf(['a'])],
  ['a list of three', cursorOf(['a', 1, 2])],
  ['an id that is text', cursorOf(['a', '1'])],
  ['an id of zero', cursorOf(['a', 0])],
  ['a name that is not text', cursorOf([1, 1])],
  ['a name with a NUL', cursorOf(['a\u0000b', 1])],
  ['a name with a lone surrogate', Buffer.from(String.raw`["\ud800",1]`, 'utf8').toString('base64url')],
  ['one character', 'A'],
  ['nothing', ''],
];

test('a cursor nobody made is 400 bad_request, whatever is wrong with it, and no list is read', async () => {
  const world = await documentWorld();
  for (const [label, cursor] of FORGED_CURSORS) {
    const response = await listPage(world, `?cursor=${encodeURIComponent(cursor)}`);
    expect([response.statusCode, errorCodeOf(response)], label).toEqual([400, 'bad_request']);
  }
});

test('a cursor that this server made but nobody holds the document of still works: it is a place in the order, not a reference', async () => {
  const world = await documentWorld();
  const response = await listPage(world, `?cursor=${cursorOf(['Jxxx', 1])}`);
  const page = parsed(response, documentListResponseSchema);
  expect(page.documents.map((document) => document.name)).toEqual(['Repository CLA']);
});

test('a repo admin sees the documents of the repository and, from the installation-wide ones, the id, the name and the version number only', async () => {
  const world = await documentWorld();
  const response = await world.ask('repoAdmin1', {
    method: 'GET',
    url: `/api/installations/${world.t1.installationId}/repositories/${world.t1.scoped.repositoryId}/documents`,
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const body = parsed(response, repositoryDocumentsResponseSchema);
  expect(body.repositoryScoped.map((document) => document.id)).toEqual([world.t1.scoped.documentId]);
  expect(body.installationScoped).toEqual([
    { id: world.t1.documentId, name: 'Individual CLA', activeVersion: { major: 1, minor: 0 } },
  ]);
  expect(response.body).not.toContain(world.t1.contentSha256);
});

test('an org admin asks for a repository that has no document of its own and gets the installation-wide ones', async () => {
  const world = await documentWorld();
  const response = await world.ask('admin1', {
    method: 'GET',
    url: `/api/installations/${world.t1.installationId}/repositories/${world.t1.plain.repositoryId}/documents`,
  });
  const body = parsed(response, repositoryDocumentsResponseSchema);
  expect(body.repositoryScoped).toEqual([]);
  expect(body.installationScoped.map((entry) => entry.id)).toEqual([world.t1.documentId]);
});

test('a repository that is removed has no list: 404 for the org admin too', async () => {
  const world = await documentWorld();
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-06-01T00:00:00Z') })
    .where('id', '=', world.t1.plain.repositoryId)
    .execute();
  const response = await world.ask('admin1', {
    method: 'GET',
    url: `/api/installations/${world.t1.installationId}/repositories/${world.t1.plain.repositoryId}/documents`,
  });
  expect(response.statusCode).toBe(404);
});
