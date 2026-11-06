// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';

// E18-S01: no screen sets markup. The CLA text is drawn from the sanitised tree by React (`MarkdownView`), and every string a
// person controls is a text node (`UserText`), so `dangerouslySetInnerHTML` and the other ways to write a string as markup are
// not needed anywhere in src/web. This reads every source file of the app, so a new screen is covered without being listed.

const FILES = import.meta.glob<string>(['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}', '!../../test-support/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The ways to hand a string to the DOM as markup: the React prop, the two properties, and the insertion method. */
const MARKUP_SETTERS =
  /dangerouslySetInnerHTML\s*=|\.(?:inner|outer)HTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(/;

test('the glob reads the sources of the screens and of the component that draws a CLA text', () => {
  const paths = Object.keys(FILES);
  expect(paths).toContain('./MarkdownView.tsx');
  expect(paths).toContain('../../sign/SignView.tsx');
  expect(paths).toContain('../../ui/UserText.tsx');
  expect(paths.length).toBeGreaterThan(80);
});

test('no source of the app sets markup from a string', () => {
  const found = Object.entries(FILES)
    .filter(([, text]) => MARKUP_SETTERS.test(text))
    .map(([path]) => path);
  expect(found).toEqual([]);
});

test.each([
  '<div dangerouslySetInnerHTML={{ __html: text }} />',
  'node.innerHTML = text;',
  'node.outerHTML=text;',
  'node.insertAdjacentHTML("beforeend", text);',
  'document.write(text);',
])('the check finds %s', (line) => {
  expect(MARKUP_SETTERS.test(line)).toBe(true);
});

test.each(['// never dangerouslySetInnerHTML', 'const html = node.innerHTML;', 'node.textContent = text;'])(
  'the check leaves %s alone',
  (line) => {
    expect(MARKUP_SETTERS.test(line)).toBe(false);
  },
);
