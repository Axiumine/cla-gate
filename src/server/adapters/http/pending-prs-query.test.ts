// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { encodeCursor } from './cursor.ts';
import { errorCodeOf, pageOf, pendingWorld } from './pending-prs-fixture/test-support.ts';

// What the query string of `GET /api/installations/:installationId/pending-prs` may carry (E15-S07): every value is checked, and a value
// that fails is a `400 bad_request`, after the guard has let the call through, so a stranger learns nothing of how it is read.

const POSITION = '2026-10-15T09:00:00.000000Z';

test.each([
  ['a repository id that is not digits', 'repositoryId=abc'],
  ['a repository id of 0', 'repositoryId=0'],
  ['a negative repository id', 'repositoryId=-1'],
  ['a repository id with a leading zero', 'repositoryId=01'],
  ['an empty repository id', 'repositoryId='],
  ['a repository id beyond what a number holds exactly', 'repositoryId=99999999999999999999'],
  ['a repeated repository id', 'repositoryId=1&repositoryId=2'],
  ['a reason that is not one of the six', 'reason=pending'],
  ['an empty reason', 'reason='],
  ['a reason in capitals', 'reason=OTHER'],
  ['a repeated reason', 'reason=other&reason=no_active_cla'],
  ['an evaluation_failed reason, which is listed as other', 'reason=evaluation_failed'],
  ['a limit of 0', 'limit=0'],
  ['a limit of 101', 'limit=101'],
  ['a limit with a sign', 'limit=%2B5'],
  ['a limit that is not an integer', 'limit=1.5'],
  ['a limit that is not a number', 'limit=many'],
  ['an empty limit', 'limit='],
  ['an empty cursor', 'cursor='],
  ['a parameter nobody defined', 'login=ada'],
  ['the installation named in the query', 'installationId=2'],
])('%s is a 400 bad_request', async (_name, query) => {
  const { pending, t1 } = await pendingWorld();
  const response = await pending('admin1', t1.installationId, `?${query}`);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
});

test.each([
  ['text that is not base64url', 'not a cursor!'],
  ['base64url padding', `${encodeCursor([POSITION, 1])}=`],
  ['a cursor of more than 1024 characters', 'A'.repeat(1025)],
  ['base64url of text that is not JSON', Buffer.from('zzzz', 'utf8').toString('base64url')],
  ['an object', encodeCursor({ updatedAt: POSITION, id: 1 })],
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
  ['SQL in the instant', encodeCursor(["2026-10-15T09:00:00.000000Z'; drop table pr_evaluations;--", 1])],
])('a tampered cursor (%s) is a 400 bad_request', async (_name, cursor) => {
  const { pending, t1 } = await pendingWorld();
  const response = await pending('admin1', t1.installationId, `?cursor=${encodeURIComponent(cursor)}`);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
});

test('a cursor the server made, with a character appended, is a 400', async () => {
  const world = await pendingWorld();
  const { pending, t1 } = world;
  await world.db
    .insertInto('pr_evaluations')
    .values(
      [101, 102].map((prNumber) => ({
        installation_id: t1.installationId,
        repository_id: t1.plain.repositoryId,
        pr_number: prNumber,
        head_sha: 'd'.repeat(40),
        result: 'failure' as const,
        details: '{}',
      })),
    )
    .execute();
  const cursor = pageOf(await pending('admin1', t1.installationId, '?limit=1')).nextCursor ?? '';
  expect(cursor).not.toBe('');
  expect((await pending('admin1', t1.installationId, `?limit=1&cursor=${cursor}`)).statusCode).toBe(200);
  expect((await pending('admin1', t1.installationId, `?limit=1&cursor=${cursor}A`)).statusCode).toBe(400);
});

test('a cursor the server did not make, made out of a valid place, is accepted and reads from that place', async () => {
  const { pending, t1 } = await pendingWorld();
  const cursor = encodeCursor(['2999-01-01T00:00:00.000000Z', 2_000_000_000]);
  expect(pageOf(await pending('admin1', t1.installationId, `?cursor=${cursor}`)).items).toEqual([]);
});

test('the query of a caller who may not ask is not read: a stranger with a bad query is told 404, and a request with no session 401', async () => {
  const { pending, t1 } = await pendingWorld();
  expect((await pending('member1', t1.installationId, '?reason=pending')).statusCode).toBe(404);
  expect((await pending('admin2', t1.installationId, '?limit=0')).statusCode).toBe(404);
  expect((await pending(null, t1.installationId, '?reason=pending')).statusCode).toBe(401);
});

test.each(['abc', '0', '-1', '01', '1.5'])('the path .../installations/%s/pending-prs is a 400', async (id) => {
  const { ask } = await pendingWorld();
  const response = await ask('admin1', { method: 'GET', url: `/api/installations/${id}/pending-prs` });
  expect(response.statusCode).toBe(400);
});

test('the accepted limits are 1 and 100, and a limit with a leading zero is refused', async () => {
  const { pending, t1 } = await pendingWorld();
  expect(pageOf(await pending('admin1', t1.installationId, '?limit=1')).items).toEqual([]);
  expect(pageOf(await pending('admin1', t1.installationId, '?limit=100')).items).toEqual([]);
  expect((await pending('admin1', t1.installationId, '?limit=010')).statusCode).toBe(400);
});
