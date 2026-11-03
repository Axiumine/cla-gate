// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { hexColour as hex } from './colour-literals.ts';
import { atRulesOf, colourTokens, declarationsOf, parseCss, themeTokens } from './css.ts';

// E17-S05: the stylesheet reader that the token tests share.

const SHEET = `
/* :root { --ignored: red; } */
:root { --a: 1; --b: "x; --c: 2"; }
:root, :host { --a: 3; }
@media (width > 1px) { :root { --d: 4; } }
:root[data-theme="dark"] { --a: 5; }
.x { --a: 6; }
@layer base { @media (forced-colors: active) { .y { border: 1px solid ButtonText; } } }
`;

test('the declarations of a selector are merged across its rules, nested ones included, later values winning', () => {
  expect(Object.fromEntries(declarationsOf(parseCss(SHEET), ':root'))).toEqual({
    '--a': '3',
    '--b': '"x; --c: 2"',
    '--d': '4',
  });
});

test('a selector matches only whole selectors, not a part of one, and not text in comments or strings', () => {
  const root = parseCss(SHEET);
  expect(Object.fromEntries(declarationsOf(root, ':root[data-theme="dark"]'))).toEqual({ '--a': '5' });
  expect(declarationsOf(root, ':host').get('--a')).toBe('3');
  expect(declarationsOf(root, '.y').get('--ignored')).toBeUndefined();
  expect(declarationsOf(root, 'nothing').size).toBe(0);
});

test('at-rules are found by name, and by name and parameters, at any depth', () => {
  const root = parseCss(SHEET);
  expect(atRulesOf(root, 'media')).toHaveLength(2);
  expect(atRulesOf(root, 'media', '(forced-colors: active)')).toHaveLength(1);
  expect(atRulesOf(root, 'media', '(prefers-reduced-motion: reduce)')).toEqual([]);
  expect(atRulesOf(root, 'layer')).toHaveLength(1);
});

test('the two themes: the dark one is the light one with the overrides of the dark rule', () => {
  const { light, dark, darkOverrides } = themeTokens(SHEET);
  expect(light.get('--a')).toBe('3');
  expect(darkOverrides.get('--a')).toBe('5');
  expect(dark.get('--a')).toBe('5');
  expect(dark.get('--d')).toBe('4');
  expect([...darkOverrides.keys()]).toEqual(['--a']);
});

test('the colour tokens are the custom properties whose value is a #rrggbb colour', () => {
  const declarations = new Map([
    ['--page', hex('F6F8FA')],
    ['--space', '1rem'],
    ['--short', hex('fff')],
    ['--alpha', hex('ffffff80')],
    ['--var', 'var(--page)'],
    ['color', hex('000000')],
  ]);
  expect([...colourTokens(declarations).keys()]).toEqual(['--page']);
});
