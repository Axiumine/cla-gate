// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { asRuntimeRole, migratedRuntimeDatabase, migratedTestDatabase } from '../adapters/db/test-support.ts';
import { Secret } from '../config/secret.ts';
import { completeLogin, type LoginContext } from './login.ts';
import { type GithubLogin, type GithubLoginProfile, LoginFailure, type RevokeResult } from './ports/github-login.ts';
import { FakeClock } from './test-support.ts';

// The login service (E10-S05) without HTTP: what it does with the three calls the port makes available, in which order, and
// what it writes. The calls are scripted here; the real ones are exercised against a mocked GitHub in the callback tests.

const LIMITS = { idleSeconds: 28_800, absoluteSeconds: 604_800 };
const PROFILE: GithubLoginProfile = {
  githubId: parseGithubId(1001),
  login: 'alice',
  name: 'Alice',
  avatarUrl: null,
  verifiedEmails: [{ email: 'alice@example.org', primary: true }],
};
const TOKEN = new Secret('ghu_made-up-token');

interface Script {
  exchange?: () => Promise<Secret>;
  identity?: () => Promise<GithubLoginProfile>;
  revoke?: () => Promise<RevokeResult>;
}

/** A service over a migrated database and a port whose calls are scripted; `calls` lists what it was asked, in order. */
async function setup(script: Script = {}, open = migratedTestDatabase) {
  const { db } = await open();
  const calls: string[] = [];
  const revoked: Secret[] = [];
  const warnings: { fields: object; message: string }[] = [];
  const github: GithubLogin = {
    exchange: (code, verifier) => {
      calls.push(`exchange ${code} ${verifier}`);
      return script.exchange?.() ?? Promise.resolve(TOKEN);
    },
    identity: (token) => {
      calls.push(`identity ${token === TOKEN}`);
      return script.identity?.() ?? Promise.resolve(PROFILE);
    },
    revoke: (token) => {
      calls.push('revoke');
      revoked.push(token);
      return script.revoke?.() ?? Promise.resolve({ ok: true });
    },
  };
  const context: LoginContext = {
    db,
    github,
    limits: LIMITS,
    clock: new FakeClock('2026-11-02T10:00:00.000Z'),
    log: { warn: (fields, message) => warnings.push({ fields, message }) },
  };
  return { db, context, calls, revoked, warnings };
}

const ATTEMPT = { code: 'the-code', verifier: 'the-verifier', presentedSessionRowId: undefined };

test('a login runs the exchange, the identity and the revocation in that order, with the same Secret', async () => {
  const { context, calls, revoked } = await setup();
  const result = await completeLogin(context, ATTEMPT);
  expect(result.ok).toBe(true);
  expect(calls).toEqual(['exchange the-code the-verifier', 'identity true', 'revoke']);
  expect(revoked).toEqual([TOKEN]);
});

test('it creates the user, a session of that user and returns the plain id for the cookie only', async () => {
  const { db, context } = await setup();
  const result = await completeLogin(context, ATTEMPT);
  expect(result.ok && result.session.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const user = await db.selectFrom('users').select(['id', 'github_id', 'login']).executeTakeFirstOrThrow();
  expect(user).toMatchObject({ github_id: 1001, login: 'alice' });
  const session = await db.selectFrom('sessions').select(['user_id', 'verified_emails']).executeTakeFirstOrThrow();
  expect(session).toEqual({ user_id: user.id, verified_emails: [{ email: 'alice@example.org', primary: true }] });
});

test('the session is deleted that the browser presented, in the same transaction as the new one', async () => {
  const { db, context } = await setup();
  const first = await completeLogin(context, ATTEMPT);
  const presented = first.ok ? first.session.rowId : -1;
  const second = await completeLogin(context, { ...ATTEMPT, presentedSessionRowId: presented });
  const rows = await db.selectFrom('sessions').select('id').execute();
  expect(second.ok && rows).toEqual([{ id: second.ok ? second.session.rowId : -2 }]);
});

test('a refusal of the exchange ends the login before the identity, with nothing to revoke', async () => {
  const failure = () => Promise.reject(new LoginFailure('exchange_failed'));
  const { db, context, calls } = await setup({ exchange: failure });
  expect(await completeLogin(context, ATTEMPT)).toEqual({ ok: false, reason: 'exchange_failed' });
  expect(calls).toEqual(['exchange the-code the-verifier']);
  expect(await db.selectFrom('users').select('id').execute()).toEqual([]);
});

test('a refusal of the identity is the reason, the token is revoked and nothing is written', async () => {
  const failure = () => Promise.reject(new LoginFailure('unsupported_account'));
  const { db, context, calls } = await setup({ identity: failure });
  expect(await completeLogin(context, ATTEMPT)).toEqual({ ok: false, reason: 'unsupported_account' });
  expect(calls).toEqual(['exchange the-code the-verifier', 'identity true', 'revoke']);
  expect(await db.selectFrom('users').select('id').execute()).toEqual([]);
  expect(await db.selectFrom('sessions').select('id').execute()).toEqual([]);
});

test('an error that is no LoginFailure is a bug: it is not turned into a reason, and the token is still revoked', async () => {
  const { context, calls } = await setup({ identity: () => Promise.reject(new TypeError('a bug')) });
  await expect(completeLogin(context, ATTEMPT)).rejects.toThrow('a bug');
  expect(calls).toEqual(['exchange the-code the-verifier', 'identity true', 'revoke']);
});

test('a bug in the exchange is not turned into a reason either', async () => {
  const { context } = await setup({ exchange: () => Promise.reject(new RangeError('another bug')) });
  await expect(completeLogin(context, ATTEMPT)).rejects.toThrow('another bug');
});

test.each([
  ['a status', { ok: false, status: 404 } as const, 404],
  ['no answer', { ok: false, status: null } as const, null],
])('a revocation that fails with %s is a warning with the status and nothing else', async (_label, result, status) => {
  const { context, warnings } = await setup({ revoke: () => Promise.resolve(result) });
  expect((await completeLogin(context, ATTEMPT)).ok).toBe(true);
  expect(warnings).toEqual([{ fields: { status }, message: 'auth.token_revoke_failed' }]);
});

test('a revocation that works logs nothing', async () => {
  const { context, warnings } = await setup();
  await completeLogin(context, ATTEMPT);
  expect(warnings).toEqual([]);
});

test('cla_app can run the whole login: the upsert of the user, the deletion of the presented session and the new session', async () => {
  const { db, context } = await setup({}, migratedRuntimeDatabase);
  await asRuntimeRole(db, async (trx) => {
    const first = await completeLogin({ ...context, db: trx }, ATTEMPT);
    const presented = first.ok ? first.session.rowId : undefined;
    await completeLogin({ ...context, db: trx }, { ...ATTEMPT, presentedSessionRowId: presented });
  });
  expect(await db.selectFrom('users').select('id').execute()).toHaveLength(1);
  expect(await db.selectFrom('sessions').select('id').execute()).toHaveLength(1);
});
