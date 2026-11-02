// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { createPgBoss, ownerBossOptions, runtimeBossOptions } from './boss.ts';
import { QUEUES } from './queues.ts';

// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password -- made-up value: the tests only look at how the options are built
const URL_WITH_PASSWORD = 'postgres://cla_app:made-up-pw@127.0.0.1:1/cla';

test('the runtime role starts pg-boss without creating or migrating the schema, without the timekeeper and without reindexing', () => {
  expect(runtimeBossOptions(URL_WITH_PASSWORD)).toEqual({
    connectionString: URL_WITH_PASSWORD,
    schema: 'pgboss',
    max: 10,
    migrate: false,
    createSchema: false,
    schedule: false,
    reindex: false,
  });
});

test('the runtime options leave the maintenance on: it expires stuck jobs and deletes old ones', () => {
  expect(runtimeBossOptions(URL_WITH_PASSWORD)).not.toHaveProperty('supervise');
});

test('the owner installs and migrates the schema and runs no maintenance, no timekeeper and no instance registry', () => {
  expect(ownerBossOptions(URL_WITH_PASSWORD)).toEqual({
    connectionString: URL_WITH_PASSWORD,
    schema: 'pgboss',
    max: 2,
    bamIntervalSeconds: 10,
    migrate: true,
    createSchema: true,
    supervise: false,
    schedule: false,
    registerInstance: false,
  });
});

test('createPgBoss builds the real pg-boss without connecting to anything', async () => {
  const boss = createPgBoss(runtimeBossOptions(URL_WITH_PASSWORD));
  const errors: Error[] = [];
  boss.on('error', (error) => errors.push(error));
  await boss.stop();
  expect(errors).toEqual([]);
});

test('the queues are the nine of the epic, each once, in lower case', () => {
  expect(QUEUES).toEqual([
    'evaluate-pr',
    'evaluate-head-sha',
    'close-pr',
    'recheck-comment',
    'sync-installation',
    'revoke-user-sessions',
    'sweep',
    'sweep-installation',
    'job-dead-letter',
  ]);
  expect(new Set(QUEUES).size).toBe(QUEUES.length);
});
