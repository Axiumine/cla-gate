// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, expect, test, vi } from 'vitest';
import { sessionFields } from './auth-fields.ts';
import { TEST_SESSION_SECRET } from './auth-fixture/test-support.ts';
import { loadConfig } from './env.ts';
import { portField } from './env-fields.ts';
import { githubFields } from './env-github.ts';
import { issuesOf } from './env-rules.ts';
import { buildEnvSchema } from './env-schema.ts';
import { retentionFields } from './retention-fields.ts';
import { SAMPLE_DATABASE_URL } from './secret-fixture/test-support.ts';
import { defaultWebRoot } from './web-root.ts';

// The environment schema and the field groups under it are made by functions, on each call. A schema built when the module
// loads would be evaluated before any test runs, and the mutation gate would then run the whole suite once for every mutant in
// it (docs/quality-gates.md, "Module-level code"). These tests pin what that must not change: the order of the fields, which is
// the order of the issues of a failed parse, the independence of two calls, and that no call reads `process.env`.

afterEach(() => {
  vi.unstubAllEnvs();
});

test('the fields are in the order the issues of a failed parse come in: server, GitHub App, sessions, retention', () => {
  expect(Object.keys(buildEnvSchema().shape)).toEqual([
    'NODE_ENV',
    'HOST',
    'PORT',
    'LOG_LEVEL',
    'DATABASE_URL',
    'PUBLIC_BASE_URL',
    'TRUST_PROXY',
    'SESSION_SECRET',
    'SETUP_TOKEN',
    'WORKER_CONCURRENCY',
    'SWEEP_INTERVAL_MINUTES',
    'WEB_ROOT',
    'SOURCE_URL',
    'SOURCE_COMMIT',
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_APP_PRIVATE_KEY_PREVIOUS',
    'GITHUB_ALLOWED_ACCOUNT_IDS',
    'OPERATOR_GITHUB_IDS',
    'GITHUB_WEBHOOK_SECRET',
    'GITHUB_WEBHOOK_SECRET_PREVIOUS',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'SESSION_IDLE_SECONDS',
    'SESSION_ABSOLUTE_SECONDS',
    'NETWORK_METADATA_RETENTION_DAYS',
    'RECORD_NETWORK_METADATA',
    'RETENTION_WEBHOOK_DELIVERIES_DAYS',
    'RETENTION_BATCH_SIZE',
  ]);
});

test('a failed parse reports its issues in the order of the fields, whichever group they are in', () => {
  const result = buildEnvSchema().safeParse({
    RETENTION_BATCH_SIZE: 'x',
    SESSION_IDLE_SECONDS: 'x',
    GITHUB_APP_ID: 'x',
    SOURCE_COMMIT: 'x',
    PORT: 'x',
  });
  expect(result.error && issuesOf(result.error).map((issue) => issue.variable)).toEqual([
    'PORT',
    'DATABASE_URL',
    'SOURCE_COMMIT',
    'GITHUB_APP_ID',
    'SESSION_IDLE_SECONDS',
    'RETENTION_BATCH_SIZE',
  ]);
});

test.each([
  ['the environment schema', buildEnvSchema],
  ['the GitHub App fields', githubFields],
  ['the session fields', sessionFields],
  ['the retention fields', retentionFields],
  ['a single field', portField],
])('%s is made on each call: two calls give two separate objects', (_name, make: () => object) => {
  expect(make()).not.toBe(make());
});

test('two schemas parse the same input to the same result, and a parse leaves nothing behind for the next', () => {
  const env = { DATABASE_URL: SAMPLE_DATABASE_URL, PORT: '8080', HOST: 'localhost' };
  const first = buildEnvSchema().parse(env);
  const second = buildEnvSchema().parse(env);
  expect([second.PORT, second.HOST, second.LOG_LEVEL]).toEqual([8080, 'localhost', 'info']);
  expect([first.PORT, first.HOST, first.LOG_LEVEL]).toEqual([8080, 'localhost', 'info']);
  expect(buildEnvSchema().parse({ DATABASE_URL: SAMPLE_DATABASE_URL })).toMatchObject({
    PORT: 3000,
    HOST: '127.0.0.1',
  });
});

test('neither the schema nor loadConfig reads process.env: only the environment they are given counts', () => {
  vi.stubEnv('PORT', '4000');
  vi.stubEnv('HOST', 'stubbed.example.test');
  vi.stubEnv('WEB_ROOT', '/stubbed/web');
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  const config = loadConfig({ DATABASE_URL: SAMPLE_DATABASE_URL });
  expect(config).toMatchObject({ port: 3000, host: '127.0.0.1', webRoot: defaultWebRoot(), sessionSecret: undefined });
  expect(buildEnvSchema().parse({ DATABASE_URL: SAMPLE_DATABASE_URL })).toMatchObject({
    PORT: 3000,
    HOST: '127.0.0.1',
  });
});
