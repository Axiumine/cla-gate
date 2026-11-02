// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { expect, test } from 'vitest';
import { causeOf, GIT_HOOK_VARIABLES, scrubGitHookEnv } from './test-support.ts';

test('the scrub removes every variable a git hook sets and keeps the rest', () => {
  const env: Record<string, string | undefined> = {
    PATH: '/usr/bin',
    HOME: '/home/test',
    ...Object.fromEntries(GIT_HOOK_VARIABLES.map((name) => [name, 'from-the-hook'])),
  };
  scrubGitHookEnv(env);
  expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/test' });
});

test('the scrub does nothing when none of the variables is set', () => {
  const env: Record<string, string | undefined> = { PATH: '/usr/bin' };
  scrubGitHookEnv(env);
  expect(env).toEqual({ PATH: '/usr/bin' });
});

test('importing the test support already cleaned this process: a scratch repository never sees the real index', () => {
  const inherited = GIT_HOOK_VARIABLES.filter((name) => Object.hasOwn(process.env, name));
  expect(inherited).toEqual([]);
});

test.each(['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_AUTHOR_NAME', 'GIT_COMMITTER_EMAIL'])(
  'the list names %s',
  (name) => {
    expect(GIT_HOOK_VARIABLES).toContain(name);
  },
);

test('causeOf returns the cause of the error that is thrown', () => {
  const cause = new RangeError('inner');
  expect(
    causeOf(() => {
      throw new Error('outer', { cause });
    }),
  ).toBe(cause);
});

test('causeOf returns undefined for an error without a cause, for a value that is not an error, and for no throw', () => {
  expect(
    causeOf(() => {
      throw new Error('plain');
    }),
  ).toBeUndefined();
  const notAnError: unknown = 'text';
  expect(
    causeOf(() => {
      throw notAnError;
    }),
  ).toBeUndefined();
  expect(causeOf(() => 1)).toBeUndefined();
});
