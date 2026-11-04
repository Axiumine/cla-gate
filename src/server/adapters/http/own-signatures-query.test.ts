// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { cursorOf, failureOf, ownSignaturesWorld, pageOf } from './own-signatures-fixture/test-support.ts';

// The query string of `GET /api/me/signatures` (E13-S06): `limit` from 1 to 100 in plain digits, an opaque `cursor`, and no other
// key. The person is the one of the session, so a key that names a person is an error and not a request answered for the caller.
// The query is read after the session, so none of these cases is told to a request with no session (own-signatures-routes.test.ts).

const ADA = 1234;
const GOOD_INSTANT = '2026-10-15T09:00:00.000000Z';

async function adaWithTwoSignatures() {
  const world = await ownSignaturesWorld();
  const ada = await world.login(ADA);
  await seedSignatures(world.db, world.t1, [{ githubId: ADA, signedAtMs: 1000 }]);
  await seedSignatures(world.db, world.t2, [{ githubId: ADA, signedAtMs: 2000 }]);
  return { world, ada };
}

/** Asks with each query string in turn and checks that every one is a 400 `bad_request`; the case that fails is named in the message. */
async function expectEveryOneRefused(queries: readonly (readonly [what: string, query: string])[]): Promise<void> {
  const { world, ada } = await adaWithTwoSignatures();
  for (const [what, query] of queries) {
    expect(failureOf(await world.list(ada, query)), what).toEqual([400, 'bad_request']);
  }
}

test.each([
  ['a limit of 1', '?limit=1', 1],
  ['a limit of 2', '?limit=2', 2],
  ['a limit of 100', '?limit=100', 2],
  ['no limit', '', 2],
])('%s is accepted and holds the page to its size', async (_what, query, count) => {
  const { world, ada } = await adaWithTwoSignatures();
  expect(pageOf(await world.list(ada, query)).items).toHaveLength(count);
});

test('a limit that is not a plain number from 1 to 100 is a 400', async () => {
  await expectEveryOneRefused([
    ['zero', '?limit=0'],
    ['101', '?limit=101'],
    ['999', '?limit=999'],
    ['1000', '?limit=1000'],
    ['negative', '?limit=-1'],
    ['a decimal', '?limit=1.5'],
    ['with a leading zero', '?limit=05'],
    ['with a plus sign', '?limit=%2B5'],
    ['in exponent form', '?limit=1e1'],
    ['text', '?limit=ten'],
    ['empty', '?limit='],
    ['given twice', '?limit=1&limit=2'],
  ]);
});

test('a key that is not in the schema is a 400, so the request is not answered for anybody: userId, githubId, login and the rest', async () => {
  await expectEveryOneRefused([
    ['userId', '?userId=2'],
    ['githubId', '?githubId=2'],
    ['user_id', '?user_id=2'],
    ['login', '?login=eve'],
    ['installationId', '?installationId=1'],
    ['state', '?state=active'],
    ['a key with a valid limit', '?limit=5&userId=2'],
  ]);
});

const BAD_CURSORS: readonly (readonly [what: string, cursor: string])[] = [
  ['an empty cursor', ''],
  ['text that is not base64url', '!!!'],
  ['base64url with padding', `${cursorOf([GOOD_INSTANT, 1])}=`],
  ['text with a stray character', `${cursorOf([GOOD_INSTANT, 1])}!`],
  ['base64url of text that is not JSON', Buffer.from('not json').toString('base64url')],
  ['an empty object', cursorOf({})],
  ['an empty array', cursorOf([])],
  ['an instant alone', cursorOf([GOOD_INSTANT])],
  ['three elements', cursorOf([GOOD_INSTANT, 1, 2])],
  ['an object with the two keys', cursorOf({ signedAt: GOOD_INSTANT, id: 1 })],
  ['an instant to the millisecond', cursorOf(['2026-10-15T09:00:00.000Z', 1])],
  ['an instant with seven decimals', cursorOf(['2026-10-15T09:00:00.0000000Z', 1])],
  ['an instant with an offset', cursorOf(['2026-10-15T09:00:00.000000+01:00', 1])],
  ['an instant that is not a date', cursorOf(['2026-13-45T25:61:61.000000Z', 1])],
  ['an instant in the year 0000', cursorOf(['0000-01-01T00:00:00.000000Z', 1])],
  ['an instant with SQL after it', cursorOf([`${GOOD_INSTANT}'; drop table signatures; --`, 1])],
  ['an instant as a number', cursorOf([1_760_000_000, 1])],
  ['an id of 0', cursorOf([GOOD_INSTANT, 0])],
  ['a negative id', cursorOf([GOOD_INSTANT, -1])],
  ['a decimal id', cursorOf([GOOD_INSTANT, 1.5])],
  ['an id as text', cursorOf([GOOD_INSTANT, '1'])],
  ['an id beyond a safe integer', Buffer.from(`["${GOOD_INSTANT}", 9007199254740993]`).toString('base64url')],
  ['a cursor beyond 1024 characters', 'a'.repeat(1025)],
];

test('a cursor that is not one the server wrote is a 400: not base64url, not JSON, not an instant and an id', async () => {
  await expectEveryOneRefused(BAD_CURSORS.map(([what, cursor]) => [what, `?cursor=${encodeURIComponent(cursor)}`]));
});

test('a cursor that is altered after the server made it is a 400 and never an error of the database', async () => {
  const { world, ada } = await adaWithTwoSignatures();
  const { nextCursor } = pageOf(await world.list(ada, '?limit=1'));
  expect(nextCursor).not.toBeNull();
  const cursor = nextCursor ?? '';
  const altered = [
    ['without its first character', cursor.slice(1)],
    ['without its last character', cursor.slice(0, -1)],
    ['with a character added', `${cursor}A`],
    ['with a character that is not base64url added', `${cursor}@`],
    ['with its first character replaced', cursor.replace(/./u, '@')],
    ['in capitals', cursor.toUpperCase()],
  ] as const;
  await expectEveryOneRefused(altered.map(([what, text]) => [what, `?cursor=${encodeURIComponent(text)}`]));
});

test('a cursor of the format the server writes, made by hand, is a place in the list: it starts the page at that row', async () => {
  const { world, ada } = await adaWithTwoSignatures();
  const all = pageOf(await world.list(ada));
  const second = all.items[1];
  const cursor = cursorOf(['2026-10-15T09:00:01.000000Z', second?.id]);
  expect(pageOf(await world.list(ada, `?cursor=${cursor}`)).items.map((item) => item.id)).toEqual([second?.id]);
  expect(pageOf(await world.list(ada, `?cursor=${cursorOf([GOOD_INSTANT, 1])}`)).items).toEqual([]);
});

test('the error of a bad request never echoes the cursor or the key', async () => {
  const { world, ada } = await adaWithTwoSignatures();
  const response = await world.list(ada, '?zzzzkey=zzzzvalue');
  expect(response.statusCode).toBe(400);
  expect(response.body).not.toContain('zzzz');
  const bad = await world.list(ada, `?cursor=${encodeURIComponent('zzzz!')}`);
  expect(bad.statusCode).toBe(400);
  expect(bad.body).not.toContain('zzzz');
});
