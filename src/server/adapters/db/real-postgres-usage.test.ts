// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

// E20-S03: two rules about how tests use the real-Postgres harness, enforced over every source file of the repository.
// 1. A test gates itself on the engine only through realPostgresOnly / realPostgresRolesOnly (test-support.ts), which
//    carry the skip reason and fail under REQUIRE_REAL_POSTGRES=1. A direct skip or run condition on the engine flag
//    would skip silently in the CI `postgres` job.
// 2. A test that uses withConnections decides its interleavings with the barrier and pg_locks, never with a timer.
// The fixtures below are assembled from pieces, so that this file does not match the patterns it looks for.

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const SCANNED = ['src', 'scripts'];
const GATE_CALL = ['skip', 'If'].join('');
const RUN_CALL = ['run', 'If'].join('');
const TIMER = ['set', 'Timeout'].join('');
const ENGINE = ['real', 'Postgres'].join('');
const URL_FLAG = ['test', 'DatabaseUrl'].join('');
const HARNESS = ['with', 'Connections'].join('');

// Written so that their own source text does not match them (`(?:skip|run)If` is not `skipIf`).
const DIRECT_USE =
  /\.(?:skip|run)If\([^)]*\b(?:real(?:Postgres)|test(?:DatabaseUrl)|DATABASE_URL)\b|\bskip:\s{0,4}!?\s{0,4}real(?:Postgres)\b/g;
const SLEEPS = /\bset(?:Timeout)\b/;
const USES_HARNESS = /\bwith(?:Connections)\(/;

/** 1-based lines of `text` that start a direct engine condition. */
function directUses(text: string): number[] {
  return [...text.matchAll(DIRECT_USE)].map((match) => text.slice(0, match.index).split('\n').length);
}

/** True when `text` builds connections and also waits with a timer. */
function sleepsBetweenConnections(text: string): boolean {
  return USES_HARNESS.test(text) && SLEEPS.test(text);
}

test.each([
  ['the plain form', `test.${GATE_CALL}(!${ENGINE})('x', () => {});`, [1]],
  ['a describe', `describe.${GATE_CALL}(!${ENGINE})('x', () => {});`, [1]],
  ['the inverse condition', `it.${RUN_CALL}(${ENGINE})('x', () => {});`, [1]],
  ['spaces and a line break', `\n\ntest.${GATE_CALL}(\n  !${ENGINE},\n)('x');`, [3]],
  ['the injected URL', `test.${GATE_CALL}(inject('${URL_FLAG}') === undefined)('x');`, [1]],
  ['the environment variable', `test.${GATE_CALL}(!process.env['DATABASE_URL'])('x');`, [1]],
  ['the skip option', `test('x', { skip: !${ENGINE} }, () => {});`, [1]],
  ['two uses', `test.${GATE_CALL}(!${ENGINE})('a');\ntest.${RUN_CALL}(${ENGINE})('b');`, [1, 2]],
  ['the helper', `${ENGINE}Only('x', async () => {});`, []],
  ['another condition', `test.${GATE_CALL}(process.platform !== 'linux')('x');`, []],
  ['an expectation on the flag', `expect(kind).toBe(${ENGINE} ? 'postgres' : 'pglite');`, []],
  ['a skip option unrelated to the engine', `test('x', { skip: slow }, () => {});`, []],
])('a direct engine condition is found in: %s', (_name, source, lines) => {
  expect(directUses(source)).toEqual(lines);
});

test.each([
  ['builds connections and sleeps', `${HARNESS}(2);\nawait ${TIMER}(resolve, 300);`, true],
  ['builds connections and does not sleep', `${HARNESS}(2);\nawait barrier();`, false],
  ['sleeps without connections', `await ${TIMER}(resolve, 300);`, false],
  ['mentions neither', 'const x = 1;', false],
])('a test that %s', (_name, source, expected) => {
  expect(sleepsBetweenConnections(source)).toBe(expected);
});

function listFiles(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a fixed directory of this repository
  return fs.readdirSync(path.join(ROOT, directory), { recursive: true, encoding: 'utf8' });
}

/** Every TypeScript file below the scanned directories, as a path relative to the repository root. */
function sourceFiles(): string[] {
  return SCANNED.flatMap((directory) =>
    listFiles(directory)
      .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
      .map((file) => path.join(directory, file)),
  );
}

function contentOf(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a file found below a fixed directory of this repository
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('the scan reaches the harness itself and the tests that use it', () => {
  const files = sourceFiles();
  expect(files).toContain('src/server/adapters/db/test-support.ts');
  expect(files).toContain('src/server/adapters/db/concurrency.test.ts');
  expect(files).toContain('src/server/adapters/db/migrator.test.ts');
});

test('no test gates itself on the engine except through realPostgresOnly or realPostgresRolesOnly', () => {
  const offenders = sourceFiles().flatMap((file) => directUses(contentOf(file)).map((line) => `${file}:${line}`));
  expect(offenders).toEqual([]);
});

test('no test that opens independent connections decides an interleaving with a timer', () => {
  const sleepers = sourceFiles().filter((file) => sleepsBetweenConnections(contentOf(file)));
  expect(sleepers).toEqual([]);
});
