// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { inspect } from 'node:util';
import { expect, test, vi } from 'vitest';
import { ConfigError } from './config-error.ts';
import { loadConfig } from './env.ts';
import { buildEnvSchema } from './env-schema.ts';
import { loadMigrateConfig } from './migrate-config.ts';
import { SECRET_VARIABLES } from './secret-files.ts';
import { SAMPLE_DATABASE_URL, sampleEnvironment, secretDirectory } from './secret-fixture/test-support.ts';

// E19-S02, the hostile test: for every variable the value `LEAKCANARY-<name>` is either refused, or (for the variables that
// accept any text of that length) accepted and then unprintable. Whichever way it goes, the canary never appears in an
// error, in a line, in the loaded configuration, or on stdout or stderr. Secrets are tried through their file as well.

const CANARY = 'LEAKCANARY';
const LISTED: readonly string[] = SECRET_VARIABLES;
/**
 * Every variable of the schema: the sample environment names one value for each. The schema itself is built inside a test, not
 * here, because a table made at import runs before any test; the first test checks that the two agree.
 */
const VARIABLES = Object.keys(sampleEnvironment());

/** The variables for which the canary is a valid value as it is: any text of that length (and, for HOST and WEB_ROOT, any text). */
const ACCEPTS_THE_CANARY = [
  'HOST',
  'WEB_ROOT',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_WEBHOOK_SECRET_PREVIOUS',
];

/** Everything a configuration or an error shows to whoever prints it. */
function shown(value: unknown): string {
  return [String(value), inspect(value, { depth: 8 }), JSON.stringify(value)].join('\n');
}

/** Runs `load` and returns what it threw, or the value it returned; stdout and stderr must stay silent. */
function attempt<T>(load: () => T): { readonly error: ConfigError } | { readonly config: T } {
  const stdout = vi.spyOn(process.stdout, 'write');
  const stderr = vi.spyOn(process.stderr, 'write');
  try {
    return { config: load() };
  } catch (error) {
    if (error instanceof ConfigError) {
      return { error };
    }
    throw error;
  } finally {
    expect([stdout.mock.calls, stderr.mock.calls]).toEqual([[], []]);
  }
}

/** Asserts that the canary is nowhere in an error: its message, its lines, its issues, its variables, its stack and its inspection. */
function expectNoCanaryIn(error: ConfigError): void {
  const everything = [
    error.message,
    ...error.lines,
    shown(error.issues),
    shown(error.variables),
    String(error.stack),
    shown(error),
  ];
  expect(everything.join('\n')).not.toContain(CANARY);
}

test('the variables tried below are the variables of the schema', () => {
  expect(VARIABLES.toSorted((a, b) => a.localeCompare(b))).toEqual(
    Object.keys(buildEnvSchema().shape).toSorted((a, b) => a.localeCompare(b)),
  );
});

test.each(VARIABLES)('LEAKCANARY as the value of %s is refused, or accepted and never printed', (name) => {
  const outcome = attempt(() => loadConfig({ DATABASE_URL: SAMPLE_DATABASE_URL, [name]: `${CANARY}-${name}` }));
  if ('error' in outcome) {
    expect(ACCEPTS_THE_CANARY).not.toContain(name);
    expect(outcome.error.variables.length).toBeGreaterThan(0);
    expectNoCanaryIn(outcome.error);
    return;
  }
  expect(ACCEPTS_THE_CANARY).toContain(name);
  if (LISTED.includes(name)) {
    expect(shown(outcome.config)).not.toContain(CANARY);
  }
});

test.each(SECRET_VARIABLES.filter((name) => name !== 'MIGRATION_DATABASE_URL'))(
  'LEAKCANARY as the content of the file of %s is refused, or accepted and never printed',
  (name) => {
    const files = secretDirectory();
    const file = files.write(name.toLowerCase(), `${CANARY}-${name}\n`);
    const outcome = attempt(() => loadConfig({ DATABASE_URL: SAMPLE_DATABASE_URL, [`${name}_FILE`]: file }));
    if ('error' in outcome) {
      expect(ACCEPTS_THE_CANARY).not.toContain(name);
      expectNoCanaryIn(outcome.error);
      return;
    }
    expect(ACCEPTS_THE_CANARY).toContain(name);
    expect(shown(outcome.config)).not.toContain(CANARY);
  },
);

test('LEAKCANARY as DATABASE_URL, from the value or from the file, is refused without a trace of it', () => {
  const files = secretDirectory();
  for (const env of [
    { DATABASE_URL: `${CANARY}-DATABASE_URL` },
    { DATABASE_URL_FILE: files.write('database_url', `${CANARY}-DATABASE_URL`) },
  ]) {
    const outcome = attempt(() => loadConfig(env));
    expect('error' in outcome).toBe(true);
    if ('error' in outcome) {
      expectNoCanaryIn(outcome.error);
    }
  }
});

test.each([
  ['MIGRATION_DATABASE_URL', 'the value'],
  ['DATABASE_URL', 'the value, with no owner connection'],
])('the migration command refuses LEAKCANARY as %s (%s) without a trace of it', (name) => {
  const outcome = attempt(() => loadMigrateConfig({ [name]: `${CANARY}-${name}` }));
  expect('error' in outcome).toBe(true);
  if ('error' in outcome) {
    expect(outcome.error.variables).toEqual([name]);
    expectNoCanaryIn(outcome.error);
  }
});

test.each(['MIGRATION_DATABASE_URL', 'DATABASE_URL'])(
  'the migration command refuses a file of %s that holds LEAKCANARY without a trace of it',
  (name) => {
    const files = secretDirectory();
    const file = files.write('url', `${CANARY}-${name}`);
    const outcome = attempt(() => loadMigrateConfig({ [`${name}_FILE`]: file }));
    expect('error' in outcome).toBe(true);
    if ('error' in outcome) {
      expect(outcome.error.variables).toEqual([name]);
      expectNoCanaryIn(outcome.error);
    }
  },
);
