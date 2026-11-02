// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { EventEmitter } from 'node:events';
import { expect, onTestFinished, test } from 'vitest';
import { loadMigrationFiles } from './adapters/db/migration-files.ts';
import { migrate } from './adapters/db/migrator.ts';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import { MIGRATIONS_DIRECTORY } from './adapters/db/test-support.ts';
import { gatedHttpWorld } from './adapters/github/http-world/test-support.ts';
import { createLogger } from './adapters/http/logger.ts';
import { type BootOptions, boot } from './boot.ts';
import { reconcileInBackground } from './boot-reconcile.ts';
import { testGitHubKey } from './config/test-support.ts';
import { id, installation, repositories } from './services/github-contract/test-support.ts';
import type { InstallationSync } from './services/installation-sync.ts';
import { FakeGate } from './services/test-support.ts';
import { captureLogs, freePort, UNREACHABLE_DATABASE_URL } from './test-support.ts';

// The reconciliation of the installations that runs once in the background after start-up (E05-S08).

class FakeProcess extends EventEmitter {
  exitCode: number | string | null | undefined;
}

const signer = testGitHubKey();

/** The account that owns the App in the mocked GitHub (`appBody`). */
const OWNER = 9001;

/** Boots on a migrated PGlite and a free port against the mocked GitHub; `extra` adds to the boot options. */
async function start(env: Record<string, string> = {}, extra: Partial<BootOptions> = {}) {
  const logs = captureLogs();
  const db = await openPgliteDatabase();
  await migrate(db, await loadMigrationFiles(MIGRATIONS_DIRECTORY));
  const server = await boot({
    env: {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      LOG_LEVEL: 'info',
      GITHUB_APP_ID: '4242',
      GITHUB_APP_PRIVATE_KEY: signer.pem,
      ...env,
    },
    signals: new FakeProcess(),
    createDb: () => db,
    logDestination: logs.destination,
    ...extra,
  });
  onTestFinished(async () => {
    await server?.close();
  });
  return { server, logs, db };
}

const ownerAccount = { id: id(OWNER), login: 'acme', type: 'Organization' as const };

test('after start-up the installations GitHub lists are reconciled once, in the background', async () => {
  const world = await gatedHttpWorld(signer, new FakeGate());
  world.addInstallation(installation(11, 'acme', { account: ownerAccount }), repositories(100, 2));
  world.addInstallation(installation(12, 'stranger'), repositories(200, 1));
  const { server, logs, db } = await start();
  await server?.reconciliation;
  const rows = await db
    .selectFrom('installations')
    .select(['github_installation_id', 'admission_status'])
    .orderBy('id')
    .execute();
  expect(rows).toEqual([
    { github_installation_id: 11, admission_status: 'admitted' },
    { github_installation_id: 12, admission_status: 'rejected' },
  ]);
  expect(await db.selectFrom('repositories').select('github_repo_id').orderBy('github_repo_id').execute()).toEqual([
    { github_repo_id: 100 },
    { github_repo_id: 101 },
  ]);
  // The rejected installation 12 was looked at (GET) and never given a token or asked for its repositories.
  const tokenRequests = world.requests.filter((request) => request.includes('/access_tokens'));
  expect(tokenRequests).toEqual(['POST /app/installations/11/access_tokens']);
  const messages = logs.lines().map((line) => line['msg']);
  expect(messages.filter((message) => message === 'installation.reconciled')).toHaveLength(1);
  expect(messages.indexOf('installation.reconciled')).toBeGreaterThan(
    messages.findIndex((message) => String(message).startsWith('Server listening')),
  );
  expect(server?.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
});

test('with reconcileOnStart false nothing is reconciled and GitHub is not asked for its installations', async () => {
  const world = await gatedHttpWorld(signer, new FakeGate());
  world.addInstallation(installation(11, 'acme'), repositories(100, 1));
  const { server, db } = await start({}, { reconcileOnStart: false });
  expect(server?.reconciliation).toBeUndefined();
  expect(server?.sync).toBeDefined();
  expect(await db.selectFrom('installations').select('id').execute()).toEqual([]);
  expect(world.requests.filter((request) => request.includes('/app/installations'))).toEqual([]);
});

test('without a GitHub App there is no sync and no reconciliation', async () => {
  const { server } = await start({ GITHUB_APP_ID: '', GITHUB_APP_PRIVATE_KEY: '' });
  expect(server?.sync).toBeUndefined();
  expect(server?.reconciliation).toBeUndefined();
});

test('a reconciliation that fails is logged as a warning and never rejects: the server stays up', async () => {
  const logs = captureLogs();
  const failing: InstallationSync = {
    syncInstallation: () => Promise.reject(new Error('not used')),
    reconcileInstallations: () => Promise.reject(new Error('GitHub is unreachable')),
  };
  const logger = createLogger({ logLevel: 'info' }, logs.destination);
  await expect(reconcileInBackground(failing, logger)).resolves.toBeUndefined();
  expect(logs.lines().find((line) => line['msg'] === 'installation.reconcile_failed')).toMatchObject({ level: 40 });
});
