// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { sessionResponseSchema } from '../../../shared/auth.ts';
import { HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { COOKIE_NAME } from './auth-fixture/test-support.ts';
import { ALICE, callbackWorld, type FakeAccount, setCookies } from './callback-fixture/test-support.ts';

// GET /api/auth/callback (E10-S05), what is kept of the account: a name is whatever its owner typed, bounded and stored as it
// is; an avatar only from GitHub's own host; only the addresses GitHub says are verified, and only in the session row.

/** The same address over the scheme that is not encrypted. */
const plain = (address: string): string => address.replace(/^https:/, 'http:');

const withName = (name: string | null): FakeAccount => ({ ...ALICE, name });

test.each(HOSTILE_NAMES)(
  'the hostile name %j is stored verbatim, in the table and in what the session shows',
  async (name) => {
    const world = await callbackWorld();
    world.github.account = withName(name);
    const { response } = await world.signIn();
    expect(response.headers.location).toBe('/');
    const row = await world.db.selectFrom('users').select('name').executeTakeFirstOrThrow();
    expect(row.name).toBe(name);
    const cookie = (setCookies(response)[1] ?? '').split(';')[0] ?? '';
    const seen = await world.app.inject({ url: '/api/auth/session', headers: { cookie } });
    expect(sessionResponseSchema.parse(seen.json()).user.name).toBe(name);
  },
);

test('a name of 300 characters is cut to 255', async () => {
  const world = await callbackWorld();
  world.github.account = withName(`${'a'.repeat(254)}${'b'.repeat(46)}`);
  await world.signIn();
  const row = await world.db.selectFrom('users').select('name').executeTakeFirstOrThrow();
  expect(row.name).toBe(`${'a'.repeat(254)}b`);
});

test('a name of 300 emoji is cut to 255 whole emoji, never through one', async () => {
  const world = await callbackWorld();
  const emoji = String.fromCodePoint(0x1f600);
  world.github.account = withName(emoji.repeat(300));
  await world.signIn();
  const row = await world.db.selectFrom('users').select('name').executeTakeFirstOrThrow();
  expect(row.name).toBe(emoji.repeat(255));
});

test('a hostile name of 300 characters is cut and still stored verbatim up to the cut', async () => {
  const world = await callbackWorld();
  const hostile = `=HYPERLINK("http://evil.example","x")${'x'.repeat(300)}`;
  world.github.account = withName(hostile);
  await world.signIn();
  const row = await world.db.selectFrom('users').select('name').executeTakeFirstOrThrow();
  expect(row.name).toBe(hostile.slice(0, 255));
});

test('a person without a name is stored without one', async () => {
  const world = await callbackWorld();
  world.github.account = withName(null);
  await world.signIn();
  const row = await world.db.selectFrom('users').select('name').executeTakeFirstOrThrow();
  expect(row.name).toBeNull();
});

test('a user answer that leaves out the name and the avatar is stored with neither', async () => {
  const world = await callbackWorld();
  world.github.answer.user = () => Response.json({ id: ALICE.id, login: ALICE.login, type: 'User' });
  const { response } = await world.signIn();
  expect(response.headers.location).toBe('/');
  const row = await world.db.selectFrom('users').select(['name', 'avatar_url']).executeTakeFirstOrThrow();
  expect(row).toEqual({ name: null, avatar_url: null });
});

test.each([
  ['another host', 'https://evil.example/u/1001?v=4'],
  ['a look-alike host', 'https://avatars.githubusercontent.com.evil.example/u/1'],
  ['the avatar host as a user name', 'https://avatars.githubusercontent.com@evil.example/u/1'],
  ['plain HTTP', plain('https://avatars.githubusercontent.com/u/1001')],
  ['a data URL', 'data:image/svg+xml,<svg onload=alert(1)>'],
  ['a script URL', 'javascript:alert(1)'],
  ['a relative path', '/u/1001'],
])('an avatar on %s is stored as null', async (_label, avatarUrl) => {
  const world = await callbackWorld();
  world.github.account = { ...ALICE, avatarUrl };
  const { response } = await world.signIn();
  expect(response.headers.location).toBe('/');
  const row = await world.db.selectFrom('users').select('avatar_url').executeTakeFirstOrThrow();
  expect(row.avatar_url).toBeNull();
  const cookie = (setCookies(response)[1] ?? '').split(';')[0] ?? '';
  const seen = await world.app.inject({ url: '/api/auth/session', headers: { cookie } });
  expect(sessionResponseSchema.parse(seen.json()).user.avatarUrl).toBeNull();
});

test('an avatar on the avatar host is kept', async () => {
  const world = await callbackWorld();
  await world.signIn();
  const row = await world.db.selectFrom('users').select('avatar_url').executeTakeFirstOrThrow();
  expect(row.avatar_url).toBe('https://avatars.githubusercontent.com/u/1001?v=4');
});

test('a person with no verified address logs in with an empty list', async () => {
  const world = await callbackWorld();
  world.github.account = { ...ALICE, emails: [{ email: 'alice@example.org', primary: true, verified: false }] };
  const { response } = await world.signIn();
  expect(response.headers.location).toBe('/');
  const row = await world.db.selectFrom('sessions').select(['id', 'verified_emails']).executeTakeFirstOrThrow();
  expect(row.verified_emails).toEqual([]);
  expect(await world.store.verifiedEmails(row.id)).toEqual([]);
});

test('a person with no address at all logs in with an empty list', async () => {
  const world = await callbackWorld();
  world.github.account = { ...ALICE, emails: [] };
  const { response } = await world.signIn();
  expect(response.headers.location).toBe('/');
  const row = await world.db.selectFrom('sessions').select('id').executeTakeFirstOrThrow();
  expect(await world.store.verifiedEmails(row.id)).toEqual([]);
});

test('thirty verified addresses are kept as twenty, the first ones, with the address as reported and the primary flag', async () => {
  const world = await callbackWorld();
  const emails = Array.from({ length: 30 }, (_unused, index) => ({
    email: index === 0 ? 'Alice.Mixed@Example.ORG' : `alice${index}@example.org`,
    primary: index === 0,
    verified: true,
  }));
  world.github.account = { ...ALICE, emails };
  await world.signIn();
  const row = await world.db.selectFrom('sessions').select('id').executeTakeFirstOrThrow();
  const kept = await world.store.verifiedEmails(row.id);
  expect(kept).toHaveLength(20);
  expect(kept[0]).toEqual({ email: 'Alice.Mixed@Example.ORG', primary: true });
  expect(kept[19]).toEqual({ email: 'alice19@example.org', primary: false });
});

test('the addresses live in the session row alone: the users table and the audit log hold none', async () => {
  const world = await callbackWorld();
  await world.signIn();
  const elsewhere = JSON.stringify([
    await world.db.selectFrom('users').selectAll().execute(),
    await world.db.selectFrom('audit_log').selectAll().execute(),
  ]);
  expect(elsewhere).not.toContain('@example.org');
  const session = await world.db.selectFrom('sessions').select('verified_emails').executeTakeFirstOrThrow();
  expect(JSON.stringify(session.verified_emails)).toContain('alice@example.org');
});

test('a session says nothing about tenants: it holds no installation', async () => {
  const world = await callbackWorld();
  await world.signIn();
  const row = await world.db.selectFrom('sessions').selectAll().executeTakeFirstOrThrow();
  expect(Object.keys(row).filter((column) => column.includes('install'))).toEqual([]);
  expect(COOKIE_NAME).toBe('__Host-cla_session');
});
