// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { expect, test } from 'vitest';
import { webConfigs } from './eslint-config.ts';

const linter = new Linter();

/** The rule ids that fire for `code` as if it were the file `filename`, using the real web blocks. */
function violations(filename: string, code: string): string[] {
  const parser = { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } };
  return linter.verify(code, [parser, ...webConfigs], { filename }).map((message) => message.ruleId ?? 'parse-error');
}

const COMPONENT = 'src/web/Panel.tsx';

test.each([
  [
    'a hook called conditionally',
    "import { useState } from 'react';\nexport function Panel({ on }: { on: boolean }) {\n  if (on) {\n    useState(0);\n  }\n  return <p />;\n}",
    'react-hooks/rules-of-hooks',
  ],
  [
    'an effect that misses a dependency',
    "import { useEffect } from 'react';\nexport function Panel({ id }: { id: number }) {\n  useEffect(() => {\n    document.title = String(id);\n  }, []);\n  return <p />;\n}",
    'react-hooks/exhaustive-deps',
  ],
  [
    'state set while rendering',
    "import { useState } from 'react';\nexport function Panel() {\n  const [n, setN] = useState(0);\n  setN(n + 1);\n  return <p />;\n}",
    'react-hooks/set-state-in-render',
  ],
])('src/web may not have %s', (_what, code, rule) => {
  expect(violations(COMPONENT, code)).toContain(rule);
});

test('a component that follows the rules is clean', () => {
  const code =
    'import { useEffect, useState } from \'react\';\nexport function Panel({ id }: { id: number }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    document.title = String(id);\n  }, [id]);\n  return <button type="button" onClick={() => { setN(n + 1); }}>{n}</button>;\n}';
  expect(violations(COMPONENT, code)).toEqual([]);
});

test('the rules apply to src/web only: the same mistake elsewhere is not their business', () => {
  const code =
    "import { useState } from 'react';\nexport function panel(on: boolean) {\n  if (on) {\n    useState(0);\n  }\n}";
  expect(violations(COMPONENT, code)).toContain('react-hooks/rules-of-hooks');
  expect(violations('src/server/panel.ts', code)).toEqual([]);
});

// E17-S02: no user-visible string is written inline in a component, so a second language is a catalog addition. The
// selectors are in scripts/web/eslint-config.ts (not eslint.config.mjs, so that this test can import them); the real
// eslint.config.mjs appends the same blocks, which scripts/web/wiring.test.ts pins.

const SYNTAX = 'no-restricted-syntax';
const page = (jsx: string): string => `export function Panel() {\n  return ${jsx};\n}`;

test.each([
  ['a word in an element', '<p>Hello</p>'],
  ['two words in a button', '<button type="button">Save changes</button>'],
  ['text after an expression', '<p>{count} items</p>'],
  ['text before an expression', '<p>Total: {count}</p>'],
  ['text on a line of its own', '<p>\n  Hello\n</p>'],
  ['a letter that is not ASCII', '<p>Größe</p>'],
  ['a letter of another script', '<p>日本語</p>'],
  ['a single letter', '<p>x</p>'],
  ['text in a fragment', '<>Hello</>'],
  ['an aria-label', '<button type="button" aria-label="Close" />'],
  ['a title', '<button type="button" title="Close" />'],
  ['a placeholder', '<input placeholder="Your name" />'],
  ['an alt', '<img alt="A cat" src="/cat.png" />'],
  ['a label', '<Field label="Name" />'],
  ['a string in braces', '<button type="button" aria-label={\'Close\'} />'],
  ['a template literal without expressions', '<button type="button" title={`Close`} />'],
  ['a template literal with an expression', `<button type="button" aria-label={\`Close \${name}\`} />`],
])('inline text is refused: %s', (_what, jsx) => {
  expect(violations('src/web/Panel.tsx', page(jsx))).toContain(SYNTAX);
});

test.each([
  ['a catalog call as a child', "<p>{t('app.name')}</p>"],
  ['a catalog call as an aria-label', '<button type="button" aria-label={t(\'common.close\')} />'],
  ['a variable as a title', '<button type="button" title={title} />'],
  ['an empty alt, the way to mark a decorative image', '<img alt="" src="/cat.png" />'],
  ['an empty alt in braces', '<img alt={\'\'} src="/cat.png" />'],
  ['whitespace between elements', '<div>\n  <p>{value}</p>\n</div>'],
  ['a number as a child', '<p>{42}</p>'],
  ['a symbol that is no letter', '<p>→ ✓ · 1/2</p>'],
  ['a character reference', '<p>&nbsp;&copy;</p>'],
  ['a template literal without a letter in a title', `<button type="button" title={\`\${a}\${b}\`} />`],
  [
    'strings in props that nobody reads out',
    '<a className="link" href="/x" role="status" data-testid="x" id="main" />',
  ],
  ['a string as the key of a call inside a prop', '<button type="button" aria-label={t(\'common.close\', {})} />'],
])('allowed: %s', (_what, jsx) => {
  expect(violations('src/web/Panel.tsx', page(jsx))).toEqual([]);
});

test.each([
  ['a test file', 'src/web/Panel.test.tsx'],
  ['a test helper', 'src/web/test-support/render.tsx'],
])('inline text is allowed in %s, which writes the strings it asserts on', (_what, filename) => {
  expect(violations(filename, page('<p aria-label="Close">Hello</p>'))).toEqual([]);
});

test('the rule is for the .tsx files of src/web: the same code in another source directory is not its business', () => {
  const code = page('<p aria-label="Close">Hello</p>');
  expect(violations('src/server/Panel.tsx', code)).toEqual([]);
  expect(violations('src/shared/Panel.tsx', code)).toEqual([]);
});

test('the message tells the developer what to do instead', () => {
  const parser = { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } };
  const [finding, ...rest] = linter.verify(page('<p>Hello</p>'), [parser, ...webConfigs], {
    filename: 'src/web/Panel.tsx',
  });
  expect(rest).toEqual([]);
  expect(finding?.message).toBe('User-visible text comes from the message catalog: use t(...) from useT() (E17-S02).');
});

test('the layering rule still holds in a component: the new selectors add to it, they do not replace it', () => {
  const imports =
    "export const lazy = () => import('../server/app.ts');\nexport const other = (x: string) => import(x);";
  const rules = violations('src/web/Panel.tsx', imports);
  expect(rules).toEqual([SYNTAX, SYNTAX]);
});
