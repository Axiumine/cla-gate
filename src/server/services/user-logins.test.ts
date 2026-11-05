// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { migratedTestDatabase } from '../adapters/db/test-support.ts';
import { loginsOf } from './user-logins.ts';

// The login of a person as `users` holds it (E16-S02, E15-S07): by numeric GitHub id, and only for the people the instance has seen.

async function setup() {
  const { db } = await migratedTestDatabase();
  await db
    .insertInto('users')
    .values([
      { github_id: 101, login: 'ada', name: null, avatar_url: null },
      { github_id: 102, login: 'erased-102', name: null, avatar_url: null },
      { github_id: 103, login: 'grace', name: null, avatar_url: null },
    ])
    .execute();
  return db;
}

test('the logins of the people it knows are returned by id, and a person it has no row for is missing', async () => {
  const db = await setup();
  expect(await loginsOf(db, [101, 102, 999])).toEqual(
    new Map([
      [101, 'ada'],
      [102, 'erased-102'],
    ]),
  );
});

test('no id is an empty map and asks the database nothing', async () => {
  const db = await setup();
  expect(await loginsOf(db, [])).toEqual(new Map());
});

test('an id given twice is looked up once', async () => {
  const db = await setup();
  expect(await loginsOf(db, [103, 103, 103])).toEqual(new Map([[103, 'grace']]));
  expect(await loginsOf(db, [101, 103, 101])).toEqual(
    new Map([
      [101, 'ada'],
      [103, 'grace'],
    ]),
  );
});

test('a list of 70,000 ids, more than a statement has parameters, is one statement and finds the people in it', async () => {
  const db = await setup();
  const ids = Array.from({ length: 70_000 }, (_unused, index) => 200_000 + index);
  expect(await loginsOf(db, [...ids, 101, 103])).toEqual(
    new Map([
      [101, 'ada'],
      [103, 'grace'],
    ]),
  );
});
