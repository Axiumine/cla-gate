// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { versionListResponseSchema } from '../../../shared/cla-history.ts';
import {
  type DocumentWorld,
  documentWorld,
  errorCodeOf,
  listVersionsAs,
  parsed,
  storeVersion,
} from './document-fixture/test-support.ts';

// The pages of GET .../documents/:documentId/versions (E12-S05): the order, the limit and the cursor, which is a zod-validated
// opaque value, so a cursor that was cut, edited or made up is a 400.

const wide = (world: DocumentWorld) => ({ installationId: world.t1.installationId, documentId: world.t1.documentId });

/** Adds the versions 1.1, 1.2, 2.0 and 2.1 to the installation-wide document, which has 1.0, past the routes. */
async function fiveVersions(world: DocumentWorld): Promise<void> {
  for (const [major, minor] of [
    [1, 1],
    [1, 2],
    [2, 0],
    [2, 1],
  ] as const) {
    await storeVersion(world, world.t1.documentId, {
      major,
      minor,
      text: `Wording ${major}.${minor}\n`,
      rationale: 'r',
    });
  }
}

/** Every page of the history, following the cursors: the numbers in the order they arrive and the number of pages. */
async function allPages(world: DocumentWorld, limit: number) {
  const numbers: string[] = [];
  let pages = 0;
  let cursor: string | null = null;
  do {
    const cursorPart = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
    const response = await listVersionsAs(world, 'admin1', wide(world), `?limit=${limit}${cursorPart}`);
    expect(response.statusCode).toBe(200);
    const page = parsed(response, versionListResponseSchema);
    expect(page.versions.length).toBeLessThanOrEqual(limit);
    numbers.push(...page.versions.map((version) => `${version.major}.${version.minor}`));
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor !== null);
  return { numbers, pages };
}

test('pages of 2 follow the cursors through the five versions by major and minor, newest first, none skipped and none repeated', async () => {
  const world = await documentWorld();
  await fiveVersions(world);
  const everything = await allPages(world, 100);
  expect(everything).toEqual({ numbers: ['2.1', '2.0', '1.2', '1.1', '1.0'], pages: 1 });
  expect(await allPages(world, 2)).toEqual({ ...everything, pages: 3 });
  expect(await allPages(world, 1)).toEqual({ ...everything, pages: 5 });
  expect(await allPages(world, 5)).toEqual(everything);
});

test('the order is by the numbers and not by the time of publication or the id: a lower number published later is still below', async () => {
  const world = await documentWorld();
  await storeVersion(world, world.t1.documentId, { major: 3, minor: 0, text: 'Three\n', rationale: 'r' });
  await storeVersion(world, world.t1.documentId, { major: 2, minor: 5, text: 'Two five\n', rationale: 'r' });
  await storeVersion(world, world.t1.documentId, { major: 2, minor: 10, text: 'Two ten\n', rationale: 'r' });
  expect((await allPages(world, 100)).numbers).toEqual(['3.0', '2.10', '2.5', '1.0']);
});

test('a list with no limit holds 50 versions and a cursor to the rest; the last page has no cursor', async () => {
  const world = await documentWorld();
  for (let minor = 1; minor <= 52; minor += 1) {
    await storeVersion(world, world.t1.documentId, { major: 1, minor, text: `Wording ${minor}\n`, rationale: 'r' });
  }
  const first = parsed(await listVersionsAs(world, 'admin1', wide(world)), versionListResponseSchema);
  expect(first.versions).toHaveLength(50);
  expect(first.nextCursor).not.toBeNull();
  const second = parsed(
    await listVersionsAs(world, 'admin1', wide(world), `?cursor=${encodeURIComponent(first.nextCursor ?? '')}`),
    versionListResponseSchema,
  );
  expect(second.versions.map((version) => version.minor)).toEqual([2, 1, 0]);
  expect(second.nextCursor).toBeNull();
});

test('a limit that is not 1 to 100 in plain digits is 400 bad_request, and a key nobody defined is too', async () => {
  const world = await documentWorld();
  for (const limit of ['0', '101', '-1', '1.5', '1e1', ' 5', '050', 'abc', '', '99999999999999999999']) {
    const response = await listVersionsAs(world, 'admin1', wide(world), `?limit=${encodeURIComponent(limit)}`);
    expect([response.statusCode, errorCodeOf(response)], limit).toEqual([400, 'bad_request']);
  }
  const unknownKey = await listVersionsAs(world, 'admin1', wide(world), '?installationId=2');
  expect(unknownKey.statusCode).toBe(400);
  const accepted = await Promise.all(
    ['1', '100'].map((limit) => listVersionsAs(world, 'admin1', wide(world), `?limit=${limit}`)),
  );
  expect(accepted.map((response) => response.statusCode)).toEqual([200, 200]);
});

const cursorOf = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

/** Cursors nobody made: each is text that is not the base64url of a JSON list of a major and a minor. */
const FORGED_CURSORS: readonly (readonly [string, string])[] = [
  ['text that is not base64url', 'not base64!'],
  ['one equals sign of padding', `${cursorOf([1, 0])}=`],
  ['bytes that are not JSON', Buffer.from('not json', 'utf8').toString('base64url')],
  ['a JSON object', cursorOf({ major: 1, minor: 0 })],
  ['a list of one', cursorOf([1])],
  ['a list of three', cursorOf([1, 0, 0])],
  ['a major that is text', cursorOf(['1', 0])],
  ['a minor that is text', cursorOf([1, '0'])],
  ['a major of zero', cursorOf([0, 0])],
  ['a negative minor', cursorOf([1, -1])],
  ['a minor with a fraction', cursorOf([1, 0.5])],
  ['a major the integer column cannot hold', cursorOf([2_147_483_648, 0])],
  ['a minor the integer column cannot hold', cursorOf([1, 2_147_483_648])],
  ['a null', cursorOf(null)],
  ['one character', 'A'],
  ['nothing', ''],
];

test('a cursor nobody made is 400 bad_request, whatever is wrong with it, and no history is read', async () => {
  const world = await documentWorld();
  for (const [label, cursor] of FORGED_CURSORS) {
    const response = await listVersionsAs(world, 'admin1', wide(world), `?cursor=${encodeURIComponent(cursor)}`);
    expect([response.statusCode, errorCodeOf(response)], label).toEqual([400, 'bad_request']);
  }
});

test('a cursor is a place in the order and not a reference: one that names a number the document does not have still starts at the next lower one', async () => {
  const world = await documentWorld();
  await fiveVersions(world);
  const page = async (cursor: string) =>
    parsed(
      await listVersionsAs(world, 'admin1', wide(world), `?cursor=${encodeURIComponent(cursor)}`),
      versionListResponseSchema,
    ).versions.map((version) => `${version.major}.${version.minor}`);
  expect(await page(cursorOf([1, 7]))).toEqual(['1.2', '1.1', '1.0']);
  expect(await page(cursorOf([1, 0]))).toEqual(['1.0']);
  expect(await page(cursorOf([99, 0]))).toEqual(['2.1', '2.0', '1.2', '1.1', '1.0']);
});

test("a cursor from the history of tenant 1 gives the admin of tenant 2 only tenant 2's own versions", async () => {
  const world = await documentWorld();
  await fiveVersions(world);
  const first = parsed(await listVersionsAs(world, 'admin1', wide(world), '?limit=1'), versionListResponseSchema);
  const asOther = await listVersionsAs(
    world,
    'admin2',
    { installationId: world.t2.installationId, documentId: world.t2.documentId },
    `?cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
  );
  const page = parsed(asOther, versionListResponseSchema);
  expect(page.versions.map((version) => version.id)).toEqual([world.t2.versionId]);
  expect(page.versions.map((version) => version.id)).not.toContain(world.t1.versionId);
});
