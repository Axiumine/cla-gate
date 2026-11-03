// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { loadConfig } from '../../src/server/config/env.ts';
import { envSchema } from '../../src/server/config/env-schema.ts';
import { loadMigrateConfig } from '../../src/server/config/migrate-config.ts';
import { SECRET_VARIABLES } from '../../src/server/config/secret-files.ts';
import { readText } from '../ci/lib/test-support.ts';
import {
  assignments,
  checkout,
  effectiveEnvironment,
  notPassed,
  ROOT,
  readCompose,
  STACK_SUBNET,
  serviceNamed,
  unknownNames,
  withDefault,
} from './test-support.ts';

// E19-S04: the stack and the application's environment schema stay in step. A setting added to the code cannot be forgotten in
// the stack: every non-secret field is in .env.example and passed to `app` with a default, unless it is listed below with
// its reason; and a variable the schema does not know cannot be passed.

/** Fields of the schema that `app` does not take from compose, each with the reason. */
const NOT_FOR_COMPOSE: ReadonlyMap<string, string> = new Map([
  ['NODE_ENV', 'the image sets production, and production is what the stack is'],
  ['HOST', 'the image sets 0.0.0.0, the only address that is reachable from outside the container'],
  [
    'PORT',
    'the container side is always 3000 (EXPOSE, HEALTHCHECK, the port mapping); PORT in compose is the host port',
  ],
  ['WEB_ROOT', 'the image keeps the built single-page app where the server looks for it by default'],
]);

const FIELDS = Object.keys(envSchema.shape);
/** The variables the schema reads as secrets: each has a `_FILE` variant. The migration command's own variable is one of them. */
const SECRETS: readonly string[] = SECRET_VARIABLES;
const EXEMPT = new Set(NOT_FOR_COMPOSE.keys());
const app = serviceNamed(readCompose(), 'app');
const migrate = serviceNamed(readCompose(), 'migrate');
const environment = app.environment ?? {};
const dotenv = assignments(readText(path.join(ROOT, '.env.example')));
const NON_SECRET = FIELDS.filter((field) => !SECRETS.includes(field));

test('every non-secret field of the schema is in .env.example', () => {
  expect(NON_SECRET.filter((field) => !dotenv.has(field))).toEqual([]);
});

test('every non-secret field is passed to app with a default, except the ones listed with a reason', () => {
  expect(notPassed(environment, FIELDS, SECRETS, EXEMPT)).toEqual([]);
});

test('a field that is neither passed nor listed is found, and so is a variable the schema does not know', () => {
  expect(
    notPassed({ LOG_LEVEL: withDefault('LOG_LEVEL', 'info') }, ['LOG_LEVEL', 'NEW_SETTING', 'NODE_ENV'], [], EXEMPT),
  ).toEqual(['NEW_SETTING']);
  expect(notPassed({ NEW_SETTING: 'literal' }, ['NEW_SETTING'], [], new Set())).toEqual(['NEW_SETTING']);
  expect(
    unknownNames(
      { LOG_LEVEL: 'x', EXTRA: 'x', DATABASE_URL: 'x', DATABASE_URL_FILE: 'x', OTHER_FILE: 'x' },
      ['LOG_LEVEL', 'DATABASE_URL'],
      ['DATABASE_URL'],
    ),
  ).toEqual(['EXTRA', 'DATABASE_URL', 'OTHER_FILE']);
});

test('the environment of a container follows compose: a value in the file wins, an empty one means the default, a secret file moves', () => {
  const synthetic = {
    TAKEN: withDefault('TAKEN', 'default'),
    EMPTY: withDefault('EMPTY', 'default'),
    ABSENT: withDefault('ABSENT', 'default'),
    LITERAL: 'literal',
    KEY_FILE: '/run/secrets/key',
  };
  expect(
    effectiveEnvironment(
      synthetic,
      new Map([
        ['TAKEN', 'given'],
        ['EMPTY', ''],
      ]),
      '/scratch',
    ),
  ).toEqual({
    TAKEN: 'given',
    EMPTY: 'default',
    ABSENT: 'default',
    LITERAL: '',
    KEY_FILE: '/scratch/key',
  });
});

test('app is passed nothing that the schema does not know: only its fields, and the _FILE of its secrets', () => {
  expect(unknownNames(environment, FIELDS, SECRETS)).toEqual([]);
});

test('no secret is passed as a value: only the _FILE variants appear, one for each secret the server reads', () => {
  const served = SECRETS.filter((name) => name !== 'MIGRATION_DATABASE_URL');
  expect(Object.keys(environment).filter((name) => SECRETS.includes(name))).toEqual([]);
  expect(served.filter((name) => environment[`${name}_FILE`] !== `/run/secrets/${name.toLowerCase()}`)).toEqual([]);
});

test('migrate gets the owner connection from its file and nothing else from the schema', () => {
  expect(unknownNames(migrate.environment ?? {}, [], SECRETS)).toEqual([]);
  expect(Object.keys(migrate.environment ?? {})).toEqual(['MIGRATION_DATABASE_URL_FILE']);
});

test('the exceptions are fields of the schema with a reason, and app really is not passed them', () => {
  expect([...NOT_FOR_COMPOSE.keys()].filter((name) => !FIELDS.includes(name))).toEqual([]);
  expect([...NOT_FOR_COMPOSE.values()].filter((reason) => reason.length < 20)).toEqual([]);
  expect([...NOT_FOR_COMPOSE.keys()].filter((name) => name in environment)).toEqual([]);
});

test('the compose-only settings are in .env.example with the defaults the stack uses', () => {
  expect([
    dotenv.get('BIND_ADDRESS'),
    dotenv.get('EDGE_SUBNET'),
    dotenv.get('PORT'),
    dotenv.get('TRUST_PROXY'),
  ]).toEqual(['127.0.0.1', STACK_SUBNET, '3000', STACK_SUBNET]);
});

// ------------------------------------------------------------------------------------------------- what the app does with it

/** The environment the app container gets from a fresh checkout whose only decision is PUBLIC_BASE_URL. */
function containerEnvironment(box: ReturnType<typeof checkout>, dotenvFile: ReadonlyMap<string, string>) {
  return {
    ...effectiveEnvironment(environment, dotenvFile, box.files),
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '3000',
    PUBLIC_BASE_URL: 'https://cla.example.com',
  };
}

test('with only PUBLIC_BASE_URL set and the secrets initialised, the app starts in setup mode with the generated token', () => {
  const box = checkout();
  box.run();
  const config = loadConfig(containerEnvironment(box, new Map()));
  expect([config.mode, config.setupToken?.reveal(), config.publicBaseUrl]).toEqual([
    'setup',
    box.read('setup_token').trim(),
    'https://cla.example.com',
  ]);
  expect(config.databaseUrl.reveal()).toBe(box.read('database_url').trim());
  expect(config.sessionSecret?.reveal()).toBe(box.read('session_secret').trim());
});

test('the defaults in the compose file are the defaults of the schema, and the trusted proxy is the stack subnet', () => {
  const box = checkout();
  box.run();
  const stack = loadConfig(containerEnvironment(box, new Map()));
  const bare = loadConfig({
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PUBLIC_BASE_URL: 'https://cla.example.com',
    DATABASE_URL: box.read('database_url').trim(),
    SETUP_TOKEN: box.read('setup_token').trim(),
  });
  const pick = (config: typeof stack) => ({
    logLevel: config.logLevel,
    workers: config.workerConcurrency,
    sweep: config.sweepIntervalMinutes,
    session: config.session,
    retention: config.networkMetadataRetentionDays,
    source: config.source,
    webRoot: config.webRoot,
    port: config.port,
    mode: config.mode,
  });
  expect(pick(stack)).toEqual(pick(bare));
  expect(stack.trustProxy).not.toEqual(bare.trustProxy);
});

test('a .env copied from the example changes nothing the defaults say: every setting it carries means the same as the default', () => {
  const box = checkout();
  box.run();
  const withExample = loadConfig(containerEnvironment(box, dotenv));
  const withDefaults = loadConfig(containerEnvironment(box, new Map()));
  expect({
    ...withExample,
    databaseUrl: undefined,
    sessionSecret: undefined,
    setupToken: undefined,
    github: undefined,
  }).toEqual({
    ...withDefaults,
    databaseUrl: undefined,
    sessionSecret: undefined,
    setupToken: undefined,
    github: undefined,
  });
});

test('migrate reads the owner connection from its file, and the two URLs name the two roles', () => {
  const box = checkout();
  box.run();
  const owner = loadMigrateConfig({
    NODE_ENV: 'production',
    MIGRATION_DATABASE_URL_FILE: path.join(box.files, 'migration_database_url'),
  }).databaseUrl.reveal();
  const runtime = loadConfig(containerEnvironment(box, new Map())).databaseUrl.reveal();
  expect([new URL(owner).username, new URL(runtime).username]).toEqual(['cla_owner', 'cla_app']);
  expect([new URL(owner).host, new URL(runtime).host, new URL(owner).pathname]).toEqual([
    'postgres:5432',
    'postgres:5432',
    '/cla',
  ]);
});
