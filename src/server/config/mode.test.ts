// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { GITHUB_APP_VARIABLES, type ModeEnv, resolveMode } from './mode.ts';

// E19-S02: the mode follows from which of the five GitHub App variables are set. All five is `normal`; none is `setup`, and
// production then needs a setup token; some is an error in production, listing the missing ones.

const ALL: ModeEnv = {
  NODE_ENV: 'production',
  GITHUB_APP_ID: '1',
  GITHUB_APP_PRIVATE_KEY: 'key',
  GITHUB_WEBHOOK_SECRET: 'hook',
  GITHUB_CLIENT_ID: 'id',
  GITHUB_CLIENT_SECRET: 'client',
};
const NONE: ModeEnv = { NODE_ENV: 'production' };
const TOKEN = { SETUP_TOKEN: 'token' };

/** What `resolveMode` says, with each problem as `VARIABLE` (the rules have their own tests). */
function resolved(env: ModeEnv): { mode: string; problems: string[] } {
  const { mode, problems } = resolveMode(env);
  return { mode, problems: problems.map((problem) => problem.variable) };
}

test('the five variables are the App id, the key, the webhook secret and the client id and secret', () => {
  expect(GITHUB_APP_VARIABLES).toEqual([
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_WEBHOOK_SECRET',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
  ]);
});

test.each([
  ['production', 'production'],
  ['development', 'development'],
  ['test', 'test'],
])('all five set in %s is normal mode with no problem, token or not', (_label, nodeEnv) => {
  expect(resolved({ ...ALL, NODE_ENV: nodeEnv })).toEqual({ mode: 'normal', problems: [] });
  expect(resolved({ ...ALL, ...TOKEN, NODE_ENV: nodeEnv })).toEqual({ mode: 'normal', problems: [] });
});

test('none set in production is setup mode, and without a token the token is the one problem', () => {
  expect(resolved({ ...NONE, ...TOKEN })).toEqual({ mode: 'setup', problems: [] });
  expect(resolved(NONE)).toEqual({ mode: 'setup', problems: ['SETUP_TOKEN'] });
});

test('the problem of a missing token says what to do, in the words of the story', () => {
  expect(resolveMode(NONE).problems).toEqual([
    {
      variable: 'SETUP_TOKEN',
      rule: 'required while no GitHub App is configured; set it, or set the GITHUB_* variables',
    },
  ]);
});

test.each(['development', 'test'])(
  'none set in %s is setup mode only when a token is offered, and never a problem',
  (nodeEnv) => {
    expect(resolved({ NODE_ENV: nodeEnv, ...TOKEN })).toEqual({ mode: 'setup', problems: [] });
    expect(resolved({ NODE_ENV: nodeEnv })).toEqual({ mode: 'normal', problems: [] });
  },
);

test.each(GITHUB_APP_VARIABLES)('production with only %s missing lists that one', (missing) => {
  expect(resolved({ ...ALL, [missing]: undefined })).toEqual({ mode: 'normal', problems: [missing] });
});

test.each(GITHUB_APP_VARIABLES)('production with only %s set lists the other four, in order', (given) => {
  const env: ModeEnv = { NODE_ENV: 'production', [given]: 'x' };
  expect(resolved(env).problems).toEqual(GITHUB_APP_VARIABLES.filter((name) => name !== given));
  expect(resolved({ ...env, ...TOKEN }).problems).toEqual(GITHUB_APP_VARIABLES.filter((name) => name !== given));
});

test('every missing variable is told the same rule: all five, or none', () => {
  const rules = new Set(resolveMode({ NODE_ENV: 'production', GITHUB_APP_ID: '1' }).problems.map((p) => p.rule));
  expect([...rules]).toEqual([
    'required: some GitHub App variables are set, so all five are needed (or none, for setup mode)',
  ]);
});

test.each(['development', 'test'])(
  'part of the App in %s is normal mode and no problem: the variables stay optional there',
  (nodeEnv) => {
    const env: ModeEnv = { NODE_ENV: nodeEnv, GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'client' };
    expect(resolved(env)).toEqual({ mode: 'normal', problems: [] });
    expect(resolved({ ...env, ...TOKEN })).toEqual({ mode: 'normal', problems: [] });
  },
);

test('a variable that holds a value that failed its own check still counts as set', () => {
  expect(resolved({ ...NONE, GITHUB_APP_ID: 'not digits' }).problems).toEqual([
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_WEBHOOK_SECRET',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
  ]);
});
