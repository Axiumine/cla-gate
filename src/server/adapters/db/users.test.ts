// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { asRuntimeRole, migratedRuntimeDatabase, migratedTestDatabase } from './test-support.ts';
import { type UserSnapshot, upsertUser } from './users.ts';

// The user row of a login (E10-S05): keyed on the numeric GitHub id, refreshed at every login, never keyed on the login.

const T0 = new Date('2026-11-02T10:00:00.000Z');
const T1 = new Date('2026-11-02T11:00:00.000Z');

const alice: UserSnapshot = {
  githubId: parseGithubId(1001),
  login: 'alice',
  name: 'Alice',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1001?v=4',
};

test('a new person gets a row with the snapshot and the time of the login', async () => {
  const { db } = await migratedTestDatabase();
  const id = await upsertUser(db, alice, T0);
  const row = await db.selectFrom('users').selectAll().executeTakeFirstOrThrow();
  expect(row).toEqual({
    id,
    github_id: 1001,
    login: 'alice',
    name: 'Alice',
    avatar_url: 'https://avatars.githubusercontent.com/u/1001?v=4',
    created_at: T0,
    updated_at: T0,
  });
});

test('a returning person keeps the row and its id; the snapshot and the update time are refreshed, the creation time is not', async () => {
  const { db } = await migratedTestDatabase();
  const first = await upsertUser(db, alice, T0);
  const second = await upsertUser(db, { ...alice, login: 'alice-renamed', name: null, avatarUrl: null }, T1);
  expect(second).toBe(first);
  const rows = await db.selectFrom('users').selectAll().execute();
  expect(rows).toEqual([
    {
      id: first,
      github_id: 1001,
      login: 'alice-renamed',
      name: null,
      avatar_url: null,
      created_at: T0,
      updated_at: T1,
    },
  ]);
});

test('the id is the identity: the same login on another id is another person, and a changed login is the same person', async () => {
  const { db } = await migratedTestDatabase();
  const first = await upsertUser(db, alice, T0);
  const other = await upsertUser(db, { ...alice, githubId: parseGithubId(2002) }, T0);
  const again = await upsertUser(db, { ...alice, login: 'someone-else' }, T1);
  expect(other).not.toBe(first);
  expect(again).toBe(first);
  const logins = await db.selectFrom('users').select(['github_id', 'login']).orderBy('github_id').execute();
  expect(logins).toEqual([
    { github_id: 1001, login: 'someone-else' },
    { github_id: 2002, login: 'alice' },
  ]);
});

test('it rolls back with the transaction it runs in', async () => {
  const { db } = await migratedTestDatabase();
  const rollback = new Error('roll back');
  await expect(
    db.transaction().execute(async (trx) => {
      await upsertUser(trx, alice, T0);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(await db.selectFrom('users').select('id').execute()).toEqual([]);
});

test('cla_app can run the upsert, both the insert and the update of an existing row', async () => {
  const { db } = await migratedRuntimeDatabase();
  const ids = await asRuntimeRole(db, async (trx) => [
    await upsertUser(trx, alice, T0),
    await upsertUser(trx, { ...alice, login: 'renamed' }, T1),
  ]);
  expect(ids[1]).toBe(ids[0]);
  const row = await db.selectFrom('users').select('login').executeTakeFirstOrThrow();
  expect(row.login).toBe('renamed');
});
