// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { EventEmitter } from 'node:events';
import { HttpResponse } from 'msw';
import { expect, onTestFinished, test, vi } from 'vitest';
import { loadMigrationFiles } from './adapters/db/migration-files.ts';
import { migrate } from './adapters/db/migrator.ts';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { MIGRATIONS_DIRECTORY } from './adapters/db/test-support.ts';
import { appBody, hourlyTokens, mockGitHub, START } from './adapters/github/test-support.ts';
import { type BootOptions, boot } from './boot.ts';
import { testGitHubKey } from './config/test-support.ts';
import { githubInstallation, OWNER } from './services/admission-fixture/test-support.ts';
import { id } from './services/github-contract/test-support.ts';
import { InstallationNotAdmittedError } from './services/ports/github-errors.ts';
import { FakeClock } from './services/test-support.ts';
import { captureLogs, freePort, startFakeJobQueue, UNREACHABLE_DATABASE_URL } from './test-support.ts';

// What start-up wires between the GitHub App and the database (E05-S07): the stored gate behind the installation tokens,
// the admission policy with the App owner in it, and the log line that names the effective account ids.

class FakeProcess extends EventEmitter {
  exitCode: number | string | null | undefined;
}

const key = testGitHubKey();

async function migratedDatabase() {
  const db = await openPgliteDatabase();
  await migrate(db, await loadMigrationFiles(MIGRATIONS_DIRECTORY));
  return db;
}

/** Boots on a migrated PGlite and a free port, with the made-up key; `env` adds to the environment. */
async function start(env: Record<string, string> = {}, extra: Partial<BootOptions> = {}) {
  const logs = captureLogs();
  const signals = new FakeProcess();
  const db = await migratedDatabase();
  const createDb = vi.fn(() => db);
  const server = await boot({
    env: {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      LOG_LEVEL: 'info',
      GITHUB_APP_ID: '4242',
      GITHUB_APP_PRIVATE_KEY: key.pem,
      ...env,
    },
    signals,
    createDb,
    createJobQueue: startFakeJobQueue,
    clock: new FakeClock(START),
    logDestination: logs.destination,
    // These tests are about the gate and the policy; the reconciliation has its own (boot-reconcile.test.ts).
    reconcileOnStart: false,
    ...extra,
  });
  onTestFinished(async () => {
    await server?.close();
  });
  return { server, signals, createDb, logs };
}

const policyLines = (logs: ReturnType<typeof captureLogs>) =>
  logs.lines().filter((line) => line['msg'] === 'github.admission_policy');

function githubWithTokens() {
  const clock = new FakeClock(START);
  return mockGitHub([key.publicKey], {
    mint: hourlyTokens(clock),
    use: () => HttpResponse.json({ total_count: 0, repositories: [] }),
  });
}

test('the start-up log names the effective account ids: the configured ones and the App owner, ascending', async () => {
  githubWithTokens();
  const { logs } = await start({ GITHUB_ALLOWED_ACCOUNT_IDS: '77, 42, 77' });
  const lines = policyLines(logs);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ level: 30, accountIds: [42, 77, 9001] });
});

test('with no list the owner account alone is logged as the effective policy', async () => {
  githubWithTokens();
  const { logs } = await start();
  expect(policyLines(logs)[0]).toMatchObject({ accountIds: [9001] });
});

test('an admitted stored installation gets a token and is served through the booted client', async () => {
  const routes = githubWithTokens();
  const { server } = await start();
  await server?.installations.upsertInstallation({
    githubInstallationId: id(11),
    accountId: OWNER,
    accountLogin: 'acme',
    accountType: 'Organization',
    suspendedAt: null,
    admission: { status: 'admitted', reason: null, decidedAt: new Date(START) },
  });
  expect(await server?.github?.client.listInstallationRepositories(id(11))).toEqual([]);
  expect(routes.mints.map((call) => call.installationId)).toEqual(['11']);
});

test('a rejected stored installation is refused by the booted client before any request', async () => {
  const routes = githubWithTokens();
  const { server } = await start();
  await server?.installations.upsertInstallation({
    githubInstallationId: id(11),
    accountId: id(5000),
    accountLogin: 'stranger',
    accountType: 'Organization',
    suspendedAt: null,
  });
  await expect(server?.github?.client.listInstallationRepositories(id(11))).rejects.toEqual(
    new InstallationNotAdmittedError('rejected'),
  );
  expect(routes.mints).toEqual([]);
});

test('an account removed from the list is refused after the restart, although its stored row still says admitted', async () => {
  const routes = githubWithTokens();
  const { server } = await start({ GITHUB_ALLOWED_ACCOUNT_IDS: '77' });
  await server?.installations.upsertInstallation({
    githubInstallationId: id(11),
    accountId: id(5000),
    accountLogin: 'was-allowed',
    accountType: 'Organization',
    suspendedAt: null,
    admission: { status: 'admitted', reason: null, decidedAt: new Date(START) },
  });
  await expect(server?.github?.client.listInstallationRepositories(id(11))).rejects.toEqual(
    new InstallationNotAdmittedError('rejected'),
  );
  expect(routes.mints).toEqual([]);
});

test('an installation with no stored row is refused by the booted client before any request', async () => {
  const routes = githubWithTokens();
  const { server } = await start();
  await expect(server?.github?.client.listInstallationRepositories(id(11))).rejects.toEqual(
    new InstallationNotAdmittedError('unknown'),
  );
  expect(routes.mints).toEqual([]);
});

test('the booted admission service serves the owner and the listed accounts and rejects every other, for the operator list', async () => {
  githubWithTokens();
  const { server, logs } = await start({ GITHUB_ALLOWED_ACCOUNT_IDS: '42' });
  const outcomes = await Promise.all([
    server?.admission?.admit(githubInstallation(11, OWNER)),
    server?.admission?.admit(githubInstallation(12, 42)),
    server?.admission?.admit(githubInstallation(13, 43)),
  ]);
  expect(outcomes.map((outcome) => outcome?.admitted)).toEqual([true, true, false]);
  const listed = await server?.installations.listInstallationsForOperator();
  expect(listed?.map((entry) => [entry.githubInstallationId, entry.admissionStatus, entry.admissionReason])).toEqual([
    [11, 'admitted', null],
    [12, 'admitted', null],
    [13, 'rejected', 'account_not_allowed'],
  ]);
  expect(logs.lines().filter((line) => line['msg'] === 'installation.rejected')).toHaveLength(1);
});

test('a GitHub outage at start-up warns that the owner is pending; the effective ids are logged by the first use', async () => {
  const state = { up: false };
  mockGitHub([key.publicKey], {
    app: () => (state.up ? HttpResponse.json(appBody()) : new HttpResponse(null, { status: 503 })),
  });
  const { server, logs } = await start({ GITHUB_ALLOWED_ACCOUNT_IDS: '42' });
  const pending = logs.lines().find((line) => line['msg'] === 'github.admission_policy_pending');
  expect(pending).toMatchObject({ level: 40, accountIds: [42] });
  expect(policyLines(logs)).toEqual([]);
  state.up = true;
  const outcome = await server?.admission?.admit(githubInstallation(11, OWNER));
  expect(outcome?.admitted).toBe(true);
  expect(policyLines(logs)[0]).toMatchObject({ accountIds: [42, 9001] });
});

test('while the owner is unknown nothing is admitted: the decision fails and writes no row', async () => {
  mockGitHub([key.publicKey], { app: () => new HttpResponse(null, { status: 503 }) });
  const { server } = await start();
  await expect(server?.admission?.admit(githubInstallation(11, OWNER))).rejects.toMatchObject({
    name: 'GitHubUnavailableError',
  });
  expect(await server?.installations.listInstallationsForOperator()).toEqual([]);
});

test('without a GitHub App there is no admission service and no policy line, and the stored installations are there', async () => {
  const { server, logs } = await start({ GITHUB_APP_ID: '', GITHUB_APP_PRIVATE_KEY: '' });
  expect(server?.github).toBeUndefined();
  expect(server?.admission).toBeUndefined();
  expect(await server?.installations.listInstallationsForOperator()).toEqual([]);
  expect(policyLines(logs)).toEqual([]);
});

test('a login in GITHUB_ALLOWED_ACCOUNT_IDS stops the start before anything is opened, naming the variable', async () => {
  const written: string[] = [];
  const { server, signals, createDb } = await start(
    { GITHUB_ALLOWED_ACCOUNT_IDS: 'octocat' },
    {
      err: (line) => {
        written.push(line);
      },
    },
  );
  expect(server).toBeUndefined();
  expect(signals.exitCode).toBe(1);
  expect(createDb).not.toHaveBeenCalled();
  expect(written).toEqual(['ConfigError: Invalid environment configuration: GITHUB_ALLOWED_ACCOUNT_IDS']);
});
