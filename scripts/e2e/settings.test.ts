// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { githubFields } from '../../src/server/config/env-github.ts';
import { SECRET_VARIABLES } from '../../src/server/config/secret-files.ts';
import { PORT_MAX, PORT_MIN } from '../ci/lib/ports.ts';
import {
  appEnvironment,
  CONTAINER_VARIABLE,
  isCi,
  isInContainer,
  MAX_DIFF_PIXELS,
  PORT_VARIABLE,
  SNAPSHOT_PATH_TEMPLATE,
  serverPort,
} from './settings.ts';

test('the snapshot path has no platform part and sits next to the specs', () => {
  expect(SNAPSHOT_PATH_TEMPLATE).toBe('{testDir}/__screenshots__/{testFilePath}/{arg}{ext}');
  expect(SNAPSHOT_PATH_TEMPLATE).not.toContain('platform');
});

test('the tolerated number of different pixels is an explicit 20', () => {
  expect(MAX_DIFF_PIXELS).toBe(20);
});

test('the two environment variables have the names the scripts and the workflow use', () => {
  expect(CONTAINER_VARIABLE).toBe('E2E_CONTAINER');
  expect(PORT_VARIABLE).toBe('E2E_PORT');
});

test.each([
  ['1', true],
  ['0', false],
  ['true', false],
  [' 1', false],
  ['', false],
  [undefined, false],
])('E2E_CONTAINER %j means inside the container: %s', (value, inside) => {
  expect(isInContainer({ E2E_CONTAINER: value })).toBe(inside);
});

test.each([
  ['true', true],
  ['1', true],
  ['0', true],
  ['', false],
  [undefined, false],
])('CI %j means a CI run: %s', (value, ci) => {
  expect(isCi({ CI: value })).toBe(ci);
});

test.each([[String(PORT_MIN)], [String(PORT_MAX)], ['40000']])(
  'a port already chosen for the run (%s) is kept and nothing new is picked',
  async (given) => {
    let picked = 0;
    const port = await serverPort({ E2E_PORT: given }, () => {
      picked += 1;
      return Promise.resolve(1);
    });
    expect(port).toBe(Number(given));
    expect(picked).toBe(0);
  },
);

test.each([
  ['unset', undefined],
  ['empty', ''],
  ['the well-known 3000', '3000'],
  ['just below the range', String(PORT_MIN - 1)],
  ['just above the range', String(PORT_MAX + 1)],
  ['a long number', '4000000'],
  ['not a number', 'abc'],
  ['a number with text', '40000x'],
  ['negative', '-40000'],
  ['with a decimal', '40000.5'],
  ['in hex', '0x9c40'],
  ['in exponent form', '4e4'],
  ['with a leading space', ' 40000'],
  ['with leading zeros', '040000'],
])('a port that is %s is replaced by a fresh random one', async (_what, given) => {
  expect(await serverPort({ E2E_PORT: given }, () => Promise.resolve(41_234))).toBe(41_234);
});

const OPTIONS = { env: { DATABASE_URL: 'postgres://u:p@127.0.0.1:41000/db' }, port: 41_234 };
let counter = 0;
const counting = (bytes: number) => {
  counter += 1;
  return String(counter).padStart(2, '0').repeat(bytes);
};

test('the application runs on loopback, on the chosen port, against the database of the job', () => {
  const env = appEnvironment({ ...OPTIONS, randomHex: counting });
  expect(env).toMatchObject({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '41234',
    LOG_LEVEL: 'warn',
    PUBLIC_BASE_URL: 'http://127.0.0.1:41234',
    DATABASE_URL: 'postgres://u:p@127.0.0.1:41000/db',
  });
});

test('a missing database URL becomes an empty value, which the application reports by name', () => {
  expect(appEnvironment({ env: {}, port: 41_234, randomHex: counting })['DATABASE_URL']).toBe('');
});

test('every secret is random per call, 32 bytes long, and different from the others', () => {
  let n = 0;
  const randomHex = (bytes: number) => {
    n += 1;
    return n.toString(16).padStart(2, '0').repeat(bytes);
  };
  const first = appEnvironment({ ...OPTIONS, randomHex });
  const second = appEnvironment({ ...OPTIONS, randomHex });
  const secrets = ['SESSION_SECRET', 'GITHUB_WEBHOOK_SECRET', 'GITHUB_CLIENT_SECRET'];
  const values = secrets.flatMap((name) => [
    new Map(Object.entries(first)).get(name),
    new Map(Object.entries(second)).get(name),
  ]);
  expect(new Set(values).size).toBe(6);
  for (const value of values) {
    expect(value).toMatch(/^[0-9a-f]{64}$/);
  }
});

test('a real secret in the environment of the developer never reaches the application', () => {
  const real = {
    SESSION_SECRET: 'real-session',
    GITHUB_CLIENT_SECRET: 'real-client',
    GITHUB_APP_PRIVATE_KEY: 'real-key',
    GITHUB_APP_ID: '4242',
    GITHUB_ALLOWED_ACCOUNT_IDS: '777',
    OPERATOR_GITHUB_IDS: '778',
  };
  const env = appEnvironment({ env: { ...OPTIONS.env, ...real }, port: 41_234, randomHex: counting });
  expect(Object.values(env).join('\n')).not.toMatch(/real-/);
});

test('the GitHub App variables are blank, so the application starts without an App and none is inherited', () => {
  const env = appEnvironment({ ...OPTIONS, randomHex: counting });
  expect(env).toMatchObject({
    GITHUB_APP_ID: '',
    GITHUB_APP_PRIVATE_KEY: '',
    GITHUB_APP_PRIVATE_KEY_PREVIOUS: '',
    GITHUB_ALLOWED_ACCOUNT_IDS: '',
    OPERATOR_GITHUB_IDS: '',
  });
});

test('every GitHub App variable and the session secret of the server configuration is set, so none is inherited', () => {
  const env = appEnvironment({ ...OPTIONS, randomHex: counting });
  expect(Object.keys(env)).toEqual(expect.arrayContaining([...Object.keys(githubFields), 'SESSION_SECRET']));
});

test('the first-run token and the _FILE variant of every secret the application reads are blank, so none is inherited (E19-S02)', () => {
  const env = appEnvironment({ ...OPTIONS, randomHex: counting });
  const files = SECRET_VARIABLES.filter((name) => name !== 'MIGRATION_DATABASE_URL').map((name) => `${name}_FILE`);
  expect(files).toHaveLength(8);
  expect(
    Object.fromEntries(['SETUP_TOKEN', ...files].map((name) => [name, new Map(Object.entries(env)).get(name)])),
  ).toEqual(Object.fromEntries(['SETUP_TOKEN', ...files].map((name) => [name, ''])));
});
