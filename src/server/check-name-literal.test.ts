// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';
import { CHECK_RUN_NAME } from '../shared/check.ts';

// E09-S02: the Check Run name is exported once. A rename has to happen in src/shared/check.ts and nowhere else, so a source
// file that types the name again (and could keep the old one after a rename) fails this test. It reads the sources with the
// TypeScript parser, which sees a string literal and nothing else: a longer string that contains the name (the comment marker
// `<!-- cla-platform:license/cla:v1 -->`), a comment or a template with a substitution is not a literal of exactly that value.

const SRC = path.resolve(import.meta.dirname, '..');
const CHECK_FILE = 'shared/check.ts';

/** The opening of a template substitution, spelled so that no ordinary string in this file looks like a template. */
const SUBSTITUTION = ['$', '{'].join('');

/** True for the files that are test code and may spell the name on their own: tests and the helpers they share. */
function isTestFile(file: string): boolean {
  return /\.test\.tsx?$/u.test(file) || /(?:^|\/)test-support(?:\.tsx?|\/)/u.test(file);
}

/** True when `source` has a string literal (single, double or backtick without a substitution) whose value is exactly `value`. */
function hasLiteral(source: string, value: string): boolean {
  const file = ts.createSourceFile('scanned.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node): boolean =>
    ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === value) ||
    ts.forEachChild(node, (child) => (visit(child) ? true : undefined)) === true;
  return visit(file);
}

/** The files under `src/` (relative to it, with `/`) that are not tests or test helpers and hold the literal `license/cla`. */
function filesSpellingTheName(): string[] {
  const entries = readdirSync(SRC, { recursive: true, withFileTypes: true });
  return (
    entries
      .filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name) && !entry.name.endsWith('.d.ts'))
      .map((entry) => path.relative(SRC, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
      .filter((file) => !isTestFile(file))
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: a file just listed from the source folder
      .filter((file) => hasLiteral(readFileSync(path.join(SRC, file), 'utf8'), CHECK_RUN_NAME))
      .sort((a, b) => a.localeCompare(b))
  );
}

test('no source file but src/shared/check.ts spells the name as a string literal', () => {
  expect(filesSpellingTheName()).toEqual([CHECK_FILE]);
});

test.each([
  ['a single-quoted string', "export const a = 'license/cla';", true],
  ['a double-quoted string', 'export const a = "license/cla";', true],
  ['a template without a substitution', 'export const a = `license/cla`;', true],
  ['a property key', "export const a = { 'license/cla': 1 };", true],
  ['a JSX attribute', 'export const a = <i title="license/cla" />;', true],
  ['a comparison', "export const a = (name: string) => name === 'license/cla';", true],
  ['the comment marker, a longer string', "export const a = '<!-- cla-platform:license/cla:v1 -->';", false],
  ['a string that ends with the name', "export const a = 'x license/cla';", false],
  ['a string that starts with the name', "export const a = 'license/cla ';", false],
  ['a template with a substitution', `export const a = \`license/${SUBSTITUTION}b}\`;`, false],
  ['a comment', '// license/cla\nexport const a = 1;', false],
  [
    'the imported constant',
    "import { CHECK_RUN_NAME } from '../shared/check.ts';\nexport const a = CHECK_RUN_NAME;",
    false,
  ],
])('the scanner sees %s: %s', (_what, source, found) => {
  expect(hasLiteral(source, 'license/cla')).toBe(found);
});

test.each([
  ['a test file', 'server/domain/webhook-routing.test.ts', true],
  ['a React test file', 'web/ui/button.test.tsx', true],
  ['a test helper', 'server/domain/test-support.ts', true],
  ['a test helper in a folder', 'server/adapters/github/webhook-fixture/test-support.ts', true],
  ['a folder of test helpers', 'web/test-support/render.tsx', true],
  ['the router', 'server/domain/webhook-routing-checks.ts', false],
  ['the constant itself', 'shared/check.ts', false],
  ['a file whose name ends like a helper', 'server/domain/my-test-support.ts', false],
])('%s counts as test code: %s', (_what, file, isTest) => {
  expect(isTestFile(file)).toBe(isTest);
});
