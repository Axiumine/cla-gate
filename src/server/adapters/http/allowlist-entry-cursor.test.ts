// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { EntryPosition, RepositoryEntryFrom } from '../../services/allowlist-entry-types.ts';
import {
  entryCursor,
  readEntryCursor,
  readRepositoryEntryCursor,
  repositoryEntryCursor,
} from './allowlist-entry-cursor.ts';
import { encodeCursor } from './cursor.ts';
import { AppError } from './errors.ts';

/** What reading `cursor` with `read` throws, or the value it returns when it does not. */
const outcome = (read: (cursor: string) => unknown, cursor: string): unknown => {
  try {
    return read(cursor);
  } catch (error) {
    return error;
  }
};

const FIRST: EntryPosition = { kind: 'user', loginSnapshot: 'ada-lovelace', id: 7 };

const POSITIONS: readonly EntryPosition[] = [
  FIRST,
  { kind: 'bot', loginSnapshot: 'dependabot[bot]', id: 9_007_199_254_740_991 },
  { kind: 'org_members', loginSnapshot: null, id: 1 },
];

test.each(POSITIONS)('the cursor of the position %j reads back as that position', (position) => {
  expect(readEntryCursor(entryCursor(position))).toEqual(position);
});

test.each(POSITIONS)('the cursor of a repository list at the position %j reads back in either section', (position) => {
  for (const section of ['own', 'inherited'] as const) {
    const from: RepositoryEntryFrom = { section, position };
    expect(readRepositoryEntryCursor(repositoryEntryCursor(from))).toEqual(from);
  }
});

test('the cursors are the base64url of the triple [kind, login, id] and of the quadruple [section, kind, login, id]', () => {
  const position = { kind: 'user', loginSnapshot: 'ada', id: 3 } as const;
  expect(entryCursor(position)).toBe(Buffer.from('["user","ada",3]').toString('base64url'));
  expect(repositoryEntryCursor({ section: 'inherited', position })).toBe(
    Buffer.from('["inherited","user","ada",3]').toString('base64url'),
  );
});

const BAD_TRIPLES = [
  ['text that is not base64url', '%%%'],
  ['padding', `${entryCursor(FIRST)}=`],
  ['something that is not JSON', Buffer.from('nope').toString('base64url')],
  ['a pair', encodeCursor(['user', 1])],
  ['a quadruple', encodeCursor(['own', 'user', 'ada', 1])],
  ['an object', encodeCursor({ kind: 'user', loginSnapshot: 'ada', id: 1 })],
  ['a kind nobody defined', encodeCursor(['admin', 'ada', 1])],
  ['a login with markup', encodeCursor(['user', '<img src=x onerror=zzzz>', 1])],
  ['a login with a trailing newline', encodeCursor(['user', 'ada\n', 1])],
  ['a login that is not text', encodeCursor(['user', 5, 1])],
  ['an id of 0', encodeCursor(['user', 'ada', 0])],
  ['an id with a fraction', encodeCursor(['user', 'ada', 1.5])],
  ['an id as text', encodeCursor(['user', 'ada', '1'])],
] as const;

test.each(BAD_TRIPLES)('a cursor of the installation list that is %s is a 400 bad_request', (_label, cursor) => {
  const error = outcome(readEntryCursor, cursor);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ status: 400, code: 'bad_request' });
});

const BAD_QUADRUPLES = [
  ['a triple', encodeCursor(['user', 'ada', 1])],
  ['a section nobody defined', encodeCursor(['all', 'user', 'ada', 1])],
  ['a kind nobody defined', encodeCursor(['own', 'admin', 'ada', 1])],
  ['a login with markup', encodeCursor(['own', 'user', '<img src=x onerror=zzzz>', 1])],
  ['an id of 0', encodeCursor(['own', 'user', 'ada', 0])],
  ['text that is not base64url', '%%%'],
] as const;

test.each(BAD_QUADRUPLES)('a cursor of the repository list that is %s is a 400 bad_request', (_label, cursor) => {
  const error = outcome(readRepositoryEntryCursor, cursor);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ status: 400, code: 'bad_request' });
});
