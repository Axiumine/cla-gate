// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { findColourLiterals } from '../test-support/colour-literals.ts';

// E17-S05: a colour is written in tokens.css and nowhere else in src/web: not in a component, a stylesheet, the page or a
// test. A component names a role (a Tailwind class, a var()), so the dark theme and the contrast checks reach it. This reads
// every source file of src/web as text, so a new file is covered without being listed.

const FILES = import.meta.glob<string>('../**/*.{ts,tsx,css,html}', { query: '?raw', import: 'default', eager: true });
// Keys are relative to this directory: its own files start with ./ and the rest of src/web with ../.
const TOKENS = './tokens.css';

test('the glob reads the source of src/web: its stylesheets, its page, its components and its test helpers', () => {
  const paths = Object.keys(FILES);
  expect(paths).toContain(TOKENS);
  expect(paths).toContain('./app.css');
  expect(paths).toContain('../test-support/colour-literals.ts');
  expect(paths).toContain('../index.html');
  expect(paths).toContain('../main.tsx');
  expect(paths.length).toBeGreaterThan(40);
});

test('tokens.css holds colour literals: it is the one file that may', () => {
  expect(findColourLiterals(new Map(Object.entries(FILES)).get(TOKENS) ?? '').length).toBeGreaterThan(40);
});

test('no other file of src/web holds a hex colour or a colour function', () => {
  const found = Object.entries(FILES)
    .filter(([path]) => path !== TOKENS)
    .flatMap(([path, text]) => findColourLiterals(text).map((literal) => `${path}: ${literal}`));
  expect(found).toEqual([]);
});
