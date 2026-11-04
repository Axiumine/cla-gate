// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { encodeCursor } from './cursor.ts';
import { errorCodeOf, idsOf, pageOf, searchWorld } from './signature-search-fixture/test-support.ts';

// What the query string of `GET /api/installations/:installationId/signatures` may carry (E15-S02): every value is checked, and a
// value that fails is a `400 bad_request`, after the guard has let the call through, so a stranger learns nothing of how it is read.

const POSITION = '2026-10-15T09:00:00.000000Z';

test.each([
  ['a document id that is not digits', 'documentId=abc'],
  ['a document id of 0', 'documentId=0'],
  ['a negative document id', 'documentId=-1'],
  ['a document id with a leading zero', 'documentId=01'],
  ['an empty document id', 'documentId='],
  ['a state that is not one of the four', 'state=pending'],
  ['an empty state', 'state='],
  ['a state in capitals', 'state=ACTIVE'],
  ['a repeated state', 'state=active&state=revoked'],
  ['a GitHub id that is not digits', 'githubUserId=ada'],
  ['a GitHub id of 0', 'githubUserId=0'],
  ['a GitHub id beyond what a number holds exactly', 'githubUserId=99999999999999999999'],
  ['an empty login', 'login='],
  ['a login with a NUL', 'login=a%00b'],
  ['a login of 101 characters', `login=${'a'.repeat(101)}`],
  ['a repeated login', 'login=a&login=b'],
  ['a limit of 0', 'limit=0'],
  ['a limit of 101', 'limit=101'],
  ['a limit with a sign', 'limit=%2B5'],
  ['a limit that is not an integer', 'limit=1.5'],
  ['a limit that is not a number', 'limit=many'],
  ['an empty limit', 'limit='],
  ['an empty cursor', 'cursor='],
  ['a parameter nobody defined', 'userId=2'],
  ['the installation named in the query', 'installationId=2'],
])('%s is a 400 bad_request', async (_name, query) => {
  const { search, t1 } = await searchWorld();
  const response = await search('admin1', t1.installationId, `?${query}`);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
});

test.each([
  ['text that is not base64url', 'not a cursor!'],
  ['base64url padding', `${encodeCursor([POSITION, 1])}=`],
  ['a cursor of more than 1024 characters', 'A'.repeat(1025)],
  ['base64url of text that is not JSON', Buffer.from('zzzz', 'utf8').toString('base64url')],
  ['an object', encodeCursor({ signedAt: POSITION, id: 1 })],
  ['an instant and no id', encodeCursor([POSITION])],
  ['an id and an instant in the wrong order', encodeCursor([1, POSITION])],
  ['three elements', encodeCursor([POSITION, 1, 1])],
  ['an instant to the millisecond', encodeCursor(['2026-10-15T09:00:00.000Z', 1])],
  ['an instant with an offset', encodeCursor(['2026-10-15T09:00:00.000000+02:00', 1])],
  ['an instant that is not on the calendar', encodeCursor(['2026-02-31T09:00:00.000000Z', 1])],
  ['an instant in the year 0', encodeCursor(['0000-01-01T00:00:00.000000Z', 1])],
  ['an id of 0', encodeCursor([POSITION, 0])],
  ['a negative id', encodeCursor([POSITION, -3])],
  ['an id that is text', encodeCursor([POSITION, '1'])],
  ['an id that is not an integer', encodeCursor([POSITION, 1.5])],
  ['SQL in the instant', encodeCursor(["2026-10-15T09:00:00.000000Z'; drop table signatures;--", 1])],
])('a tampered cursor (%s) is a 400 bad_request', async (_name, cursor) => {
  const { search, t1 } = await searchWorld();
  const response = await search('admin1', t1.installationId, `?cursor=${encodeURIComponent(cursor)}`);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
});

test('a cursor the server did not make, made out of a valid place, is accepted and reads from that place', async () => {
  const { search, t1 } = await searchWorld();
  const cursor = encodeCursor(['2999-01-01T00:00:00.000000Z', 2_000_000_000]);
  expect(idsOf(await search('admin1', t1.installationId, `?cursor=${cursor}`))).toEqual([t1.signatureId]);
  expect(pageOf(await search('admin1', t1.installationId, `?cursor=${encodeCursor([POSITION, 1])}`)).items).toEqual([]);
});

test('the query of a caller who may not ask is not read: a stranger with a bad query is told 404, and a request with no session 401', async () => {
  const { search, t1 } = await searchWorld();
  expect((await search('member1', t1.installationId, '?state=pending')).statusCode).toBe(404);
  expect((await search('admin2', t1.installationId, '?limit=0')).statusCode).toBe(404);
  expect((await search(null, t1.installationId, '?state=pending')).statusCode).toBe(401);
});

test.each(['abc', '0', '-1', '01', '1.5'])('the path .../installations/%s/signatures is a 400', async (id) => {
  const { ask } = await searchWorld();
  const response = await ask('admin1', { method: 'GET', url: `/api/installations/${id}/signatures` });
  expect(response.statusCode).toBe(400);
});

test('the accepted limits are 1 and 100, and a limit with a leading zero is refused', async () => {
  const { search, t1 } = await searchWorld();
  expect(pageOf(await search('admin1', t1.installationId, '?limit=1')).items).toHaveLength(1);
  expect(pageOf(await search('admin1', t1.installationId, '?limit=100')).items).toHaveLength(1);
  expect((await search('admin1', t1.installationId, '?limit=010')).statusCode).toBe(400);
});
