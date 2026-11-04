// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';
import { CONSENT_TEXTS } from '../shared/consent.ts';

// E13-S01: the server is the only source of the consent sentence. The sign page shows the text that the context endpoint
// returns (E13-S02) and sends back the id it was given, so the web code neither imports the registry nor holds a sentence of
// its own: a copy there could drift from the wording an id stands for, and a signature would then prove the wrong thing.

const WEB = path.resolve(import.meta.dirname, '../web');

/** True for the files that are test code: the web tests fake the server's answers and may hold any text of their own. */
function isTestCode(file: string): boolean {
  return /\.test\.tsx?$|(?:^|\/)test-support(?:\.tsx?|\/)/u.test(file);
}

/** The last part of a module specifier that names the registry: `consent` or `consent.ts`, after any folders. */
const REGISTRY_MODULE = /(?:^|\/)consent(?:\.ts)?$/u;

/** The expression that names the module in an import, an export from or an `import()` call, if `node` is one of them. */
function specifierOf(node: ts.Node): ts.Node | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier;
  }
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
    ? node.arguments[0]
    : undefined;
}

/** The module specifiers a source file imports, re-exports from or loads with `import()`. Strings that are not those are not seen. */
function moduleSpecifiers(source: string): string[] {
  const file = ts.createSourceFile('scanned.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    const named = specifierOf(node);
    if (named !== undefined && ts.isStringLiteralLike(named)) {
      specifiers.push(named.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return specifiers;
}

/** What is wrong with the contents of one web file, if anything: it names the registry, or it holds one of the sentences. */
function findings(source: string, sentences: readonly string[]): string[] {
  return [
    ...(moduleSpecifiers(source).some((specifier) => REGISTRY_MODULE.test(specifier))
      ? ['imports the consent registry']
      : []),
    ...(sentences.some((sentence) => source.includes(sentence)) ? ['holds a consent sentence'] : []),
  ];
}

/** Every file of the web code that is not test code, with what is wrong with it. */
function webFindings(): [file: string, finding: string][] {
  const sentences = Object.values(CONSENT_TEXTS).map((entry) => entry.text);
  return readdirSync(WEB, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(WEB, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .filter((file) => !isTestCode(file))
    .flatMap((file) =>
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: a file just listed from the web source folder
      findings(readFileSync(path.join(WEB, file), 'utf8'), sentences).map((finding): [string, string] => [
        file,
        finding,
      ]),
    );
}

test('no web file outside the tests imports the consent registry or holds a consent sentence', () => {
  expect(webFindings()).toEqual([]);
});

test('the scan looks at the web code: it finds source files', () => {
  const listed = readdirSync(WEB, { recursive: true }).map(String);
  expect(listed.filter((file) => /\.tsx?$/u.test(file) && !isTestCode(file)).length).toBeGreaterThan(20);
});

test.each([
  ['a relative import', "import { getConsentText } from '../../shared/consent.ts';", ['imports the consent registry']],
  [
    'an import without extension',
    'import { CONSENT_TEXTS } from "../shared/consent";',
    ['imports the consent registry'],
  ],
  ['a type import', "import type { ConsentKind } from '../shared/consent.ts'", ['imports the consent registry']],
  ['a dynamic import', "const m = await import('../shared/consent.ts');", ['imports the consent registry']],
  ['an export from', "export { CURRENT_CONSENT_ID } from '../shared/consent.ts';", ['imports the consent registry']],
  ['a side-effect import', "import '../shared/consent.ts';", ['imports the consent registry']],
  ['a string that only looks like a path', "const route = '../shared/consent.ts';", []],
  ['a comment', "// import { x } from '../shared/consent.ts';\nexport const a = 1;", []],
  ['another module', "import { x } from '../shared/consent-other.ts';", []],
  ['a module in a folder of that name', "import { x } from '../consent/other.ts';", []],
  ['a module that ends like the registry', "import { x } from '../shared/no-consent.ts';", []],
  ['a sentence', "const label = 'I agree to the terms';", ['holds a consent sentence']],
  ['a sentence inside a template', 'const label = `x I agree to the terms y`;', ['holds a consent sentence']],
  ['other text', "const label = 'I agree';", []],
  [
    'an import and a sentence',
    "import a from './consent.ts'; const label = 'I agree to the terms';",
    ['imports the consent registry', 'holds a consent sentence'],
  ],
])('the scanner sees %s', (_what, source, expected) => {
  expect(findings(source, ['I agree to the terms'])).toEqual(expected);
});

test.each([
  ['a test file', 'sign/page.test.tsx', true],
  ['a TypeScript test file', 'api/client.test.ts', true],
  ['a test helper', 'test-support/render.tsx', true],
  ['a test helper file', 'sign/test-support.ts', true],
  ['a page', 'sign/page.tsx', false],
  ['a file whose name ends like a helper', 'sign/my-test-support.ts', false],
  ['a catalogue', 'i18n/en.json', false],
])('%s counts as test code: %s', (_what, file, isTest) => {
  expect(isTestCode(file)).toBe(isTest);
});
