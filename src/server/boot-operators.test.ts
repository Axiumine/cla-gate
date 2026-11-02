// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse } from 'msw';
import { expect, onTestFinished, test, vi } from 'vitest';
import { OPERATOR_INSTALLATIONS_PATH } from '../shared/operator.ts';
import { loadMigrationFiles } from './adapters/db/migration-files.ts';
import { migrate } from './adapters/db/migrator.ts';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { createSessionStore } from './adapters/db/sessions.ts';
import { MIGRATIONS_DIRECTORY } from './adapters/db/test-support.ts';
import { appBody, mockGitHub } from './adapters/github/test-support.ts';
import { boot } from './boot.ts';
import { AUTH_ENV } from './config/auth-fixture/test-support.ts';
import { testGitHubKey } from './config/test-support.ts';
import { FakeClock } from './services/test-support.ts';
import { captureLogs, FakeProcess, freePort, UNREACHABLE_DATABASE_URL } from './test-support.ts';

// What start-up decides about the instance operators (E11-S08): the effective ids in the log, the owner of the App read from
// the self-check of E05-S02, and the policy the running server guards the operator route with.

const START = '2026-11-02T10:00:00.000Z';
const signing = testGitHubKey();

/** What `GET /app` answers for an App owned by an account of this type. */
const ownedBy = (type: 'User' | 'Organization') => ({
  owner: { login: 'owner', id: 9001, type, site_admin: false },
});

/** Serves GitHub with an App owned by an account of this type. */
function githubOwnedBy(type: 'User' | 'Organization') {
  mockGitHub([signing.publicKey], { app: () => HttpResponse.json(appBody(ownedBy(type))) });
}

/** Boots on a migrated PGlite and a free port, with a session for each of `people` (GitHub ids); `env` adds to the environment. */
async function start(env: Record<string, string> = {}, people: readonly number[] = []) {
  const logs = captureLogs();
  const signals = new FakeProcess();
  const clock = new FakeClock(START);
  const db = await openPgliteDatabase();
  await migrate(db, await loadMigrationFiles(MIGRATIONS_DIRECTORY));
  const store = createSessionStore(db, { idleSeconds: 600, absoluteSeconds: 1200 });
  const cookies = new Map<number, string>();
  for (const githubId of people) {
    const user = await db
      .insertInto('users')
      .values({ github_id: githubId, login: `login-${githubId}`, name: null, avatar_url: null })
      .returning('id')
      .executeTakeFirstOrThrow();
    cookies.set(githubId, `__Host-cla_session=${(await store.create({ userId: user.id }, clock.now())).id}`);
  }
  const createDb = vi.fn(() => db);
  const server = await boot({
    env: {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      LOG_LEVEL: 'info',
      GITHUB_APP_ID: '4242',
      GITHUB_APP_PRIVATE_KEY: signing.pem,
      ...AUTH_ENV,
      ...env,
    },
    signals,
    createDb,
    clock,
    logDestination: logs.destination,
    reconcileOnStart: false,
  });
  onTestFinished(async () => {
    await server?.close();
  });
  const list = (githubId: number) =>
    fetch(`${server?.address}${OPERATOR_INSTALLATIONS_PATH}`, { headers: { cookie: cookies.get(githubId) ?? '' } });
  return { server, signals, createDb, logs, list };
}

const policyLines = (logs: ReturnType<typeof captureLogs>) =>
  logs.lines().filter((line) => line['msg'] === 'github.operator_policy');

test.each([
  ['a user and the variable unset', 'User', {}, [9001]],
  ['an organisation and the variable unset', 'Organization', {}, []],
  ['a user and the variable naming others', 'User', { OPERATOR_GITHUB_IDS: '77, 42, 77' }, [42, 77]],
  ['an organisation and the variable naming others', 'Organization', { OPERATOR_GITHUB_IDS: '77, 42' }, [42, 77]],
] as const)(
  'the start-up log names the effective operator ids when the App is owned by %s',
  async (_label, type, env, ids) => {
    githubOwnedBy(type);
    const { logs } = await start(env);
    const lines = policyLines(logs);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 30, operatorIds: ids });
  },
);

test('the running server lets the owner of the App list the installations when it is a user, and nobody else', async () => {
  githubOwnedBy('User');
  const { list } = await start({}, [9001, 1001]);
  const [owner, other] = await Promise.all([list(9001), list(1001)]);
  expect([owner.status, other.status]).toEqual([200, 404]);
  expect(await owner.json()).toEqual({ installations: [] });
});

test('the running server has no operator when the App is owned by an organisation and the variable is unset', async () => {
  githubOwnedBy('Organization');
  const { list } = await start({}, [9001, 1001]);
  expect([(await list(9001)).status, (await list(1001)).status]).toEqual([404, 404]);
});

test('the running server takes the operators from the variable and leaves the owner of the App out', async () => {
  githubOwnedBy('User');
  const { list } = await start({ OPERATOR_GITHUB_IDS: '1001' }, [9001, 1001]);
  expect([(await list(9001)).status, (await list(1001)).status]).toEqual([404, 200]);
});

test('a GitHub outage at start-up warns that the operator is pending; the ids are logged by the first use, once the owner is known', async () => {
  const state = { up: false };
  mockGitHub([signing.publicKey], {
    app: () => (state.up ? HttpResponse.json(appBody(ownedBy('User'))) : new HttpResponse(null, { status: 503 })),
  });
  const { logs, list } = await start({}, [9001, 1001]);
  expect(logs.lines().find((line) => line['msg'] === 'github.operator_policy_pending')).toMatchObject({ level: 40 });
  expect(policyLines(logs)).toEqual([]);
  expect([(await list(9001)).status, (await list(1001)).status]).toEqual([502, 502]);
  state.up = true;
  expect([(await list(9001)).status, (await list(1001)).status]).toEqual([200, 404]);
  expect(policyLines(logs)[0]).toMatchObject({ operatorIds: [9001] });
});

test('with the variable set an outage at start-up changes nothing: GitHub is not asked, the ids are logged at once', async () => {
  mockGitHub([signing.publicKey], { app: () => new HttpResponse(null, { status: 503 }) });
  const { logs, list } = await start({ OPERATOR_GITHUB_IDS: '1001' }, [1001]);
  expect(logs.lines().find((line) => line['msg'] === 'github.operator_policy_pending')).toBeUndefined();
  expect(policyLines(logs)[0]).toMatchObject({ operatorIds: [1001] });
  expect((await list(1001)).status).toBe(200);
});

test.each([
  ['unset', {}, []],
  ['set', { OPERATOR_GITHUB_IDS: '1001' }, [1001]],
] as const)(
  'without a GitHub App the variable %s gives the operators %j: the owner is not known',
  async (_label, env, ids) => {
    const { server, logs } = await start({ GITHUB_APP_ID: '', GITHUB_APP_PRIVATE_KEY: '', ...env });
    expect(server?.github).toBeUndefined();
    expect(policyLines(logs)[0]).toMatchObject({ operatorIds: ids });
  },
);

test('a login in OPERATOR_GITHUB_IDS stops the start before anything is opened, naming the variable', async () => {
  const written: string[] = [];
  const signals = new FakeProcess();
  const createDb = vi.fn(() => openPgliteDatabase());
  const server = await boot({
    env: { DATABASE_URL: UNREACHABLE_DATABASE_URL, OPERATOR_GITHUB_IDS: 'octocat' },
    signals,
    createDb,
    logDestination: captureLogs().destination,
    err: (line) => {
      written.push(line);
    },
  });
  expect(server).toBeUndefined();
  expect(signals.exitCode).toBe(1);
  expect(createDb).not.toHaveBeenCalled();
  expect(written).toEqual(['ConfigError: Invalid environment configuration: OPERATOR_GITHUB_IDS']);
});
