// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { AtRule, Declaration, Rule } from 'postcss';
import { expect, test } from 'vitest';
import { atRulesOf, colourTokens, declarationsOf, parseCss, themeTokens } from '../test-support/css.ts';
import appCss from './app.css?raw';
import tokensCss from './tokens.css?raw';

// E17-S05: app.css, the stylesheet index.html links: Tailwind, the mapping of the tokens to Tailwind's @theme, and the
// base rules. Each rule is read from the parsed stylesheet, not matched in its text.

const app = parseCss(appCss);
const tokens = themeTokens(tokensCss);

/** The declarations directly inside an at-rule, as a map. */
function declarationsIn(atRule: AtRule | undefined): Map<string, string> {
  const found = new Map<string, string>();
  atRule?.each((node) => {
    if (node.type === 'decl') {
      found.set(node.prop, node.value);
    }
  });
  return found;
}

/** The first rule with exactly this selector list inside an at-rule, as its declarations. */
function ruleIn(atRule: AtRule | undefined, selector: string): Map<string, string> {
  const found = new Map<string, string>();
  atRule?.walkRules((rule: Rule) => {
    if (rule.selector.replace(/\s+/g, ' ') === selector) {
      rule.walkDecls((declaration: Declaration) => {
        found.set(declaration.prop, declaration.value);
      });
    }
  });
  return found;
}

const THEME = atRulesOf(app, 'theme', 'inline')[0];
const MAPPING = declarationsIn(THEME);
const BASE = atRulesOf(app, 'layer', 'base')[0];

test("the sheet imports Tailwind's reset and utilities without its default theme, then the tokens, in a fixed layer order", () => {
  expect(atRulesOf(app, 'import').map((rule) => rule.params)).toEqual([
    '"tailwindcss/preflight.css" layer(base)',
    '"tailwindcss/utilities.css" layer(utilities) source(none)',
    '"./tokens.css"',
  ]);
  expect(atRulesOf(app, 'layer', 'theme, base, components, utilities')).toHaveLength(1);
});

test('utilities come from the components of src/web and not from the tests', () => {
  expect(atRulesOf(app, 'source').map((rule) => rule.params)).toEqual([
    '"../**/*.{ts,tsx}"',
    'not "../**/*.test.{ts,tsx}"',
    'not "../**/test-support{,.ts}"',
  ]);
});

test('every colour token has its Tailwind colour, which reads the token itself', () => {
  const colours = [...colourTokens(tokens.light).keys()];
  expect(colours.length).toBeGreaterThan(0);
  for (const token of colours) {
    expect(MAPPING.get(`--color-${token.slice(2)}`)).toBe(`var(${token})`);
  }
  expect([...MAPPING.keys()].filter((name) => name.startsWith('--color-'))).toHaveLength(colours.length);
});

test("spacing, radius and type map to tokens: Tailwind's step is --space-1, and every size and weight has its token", () => {
  expect(MAPPING.get('--spacing')).toBe('var(--space-1)');
  expect(MAPPING.get('--radius-md')).toBe('var(--radius-control)');
  expect(MAPPING.get('--radius-lg')).toBe('var(--radius-surface)');
  expect(MAPPING.get('--radius-full')).toBe('var(--radius-pill)');
  expect(MAPPING.get('--font-ui')).toBe('var(--font-sans)');
  expect(MAPPING.get('--font-code')).toBe('var(--font-mono)');
  for (const size of ['xs', 'sm', 'base', 'lg', 'xl', '2xl']) {
    expect(MAPPING.get(`--text-${size}`)).toBe(`var(--size-${size})`);
    expect(MAPPING.get(`--text-${size}--line-height`)).toMatch(/^var\(--leading-(?:normal|tight)\)$/);
  }
  for (const weight of ['normal', 'medium', 'semibold']) {
    expect(MAPPING.get(`--font-weight-${weight}`)).toBe(`var(--weight-${weight})`);
  }
});

test('the mapping holds only references to tokens that exist, and none of them is a token of the same name', () => {
  const defined = new Set([...tokens.light.keys()]);
  expect(MAPPING.size).toBeGreaterThan(0);
  for (const [name, value] of MAPPING) {
    const reference = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
    expect(reference, `${name} is a plain var() of a token`).toBeDefined();
    expect(defined.has(reference ?? ''), `${name} -> ${reference ?? ''} exists in tokens.css`).toBe(true);
    expect(reference).not.toBe(name);
  }
});

test('the breakpoints are the one theme value written out, as media queries cannot read a custom property', () => {
  const declared = declarationsIn(atRulesOf(app, 'theme').find((rule) => rule.params === ''));
  expect(Object.fromEntries(declared)).toEqual({
    '--breakpoint-sm': '40rem',
    '--breakpoint-md': '48rem',
    '--breakpoint-lg': '64rem',
    '--breakpoint-xl': '80rem',
  });
});

test('the page widths are written out too, because max-w-2xl and max-w-5xl have no rule without them (E17-S09)', () => {
  const declared = atRulesOf(app, 'theme')
    .filter((rule) => rule.params === '')
    .map(declarationsIn)
    .flatMap((map) => [...map])
    .filter(([name]) => name.startsWith('--container-'));
  expect(Object.fromEntries(declared)).toEqual({ '--container-2xl': '42rem', '--container-5xl': '64rem' });
});

test('the md breakpoint, where the navigation stops collapsing, is 768 px (E17-S09)', () => {
  const declared = declarationsIn(atRulesOf(app, 'theme').find((rule) => rule.params === ''));
  const rem = Number.parseFloat(declared.get('--breakpoint-md') ?? '');
  expect(rem * 16).toBe(768);
});

test('the dark: variant follows data-theme, so a utility obeys the choice of the person and not the system alone', () => {
  const [variant] = atRulesOf(app, 'custom-variant');
  expect(variant?.params).toBe('dark (&:where(:root[data-theme="dark"], :root[data-theme="dark"] *))');
});

test('the body takes its colours and font from the tokens', () => {
  expect(Object.fromEntries(ruleIn(BASE, 'body'))).toMatchObject({
    'background-color': 'var(--page)',
    color: 'var(--fg)',
    'font-family': 'var(--font-sans)',
  });
  expect(ruleIn(BASE, 'a').get('color')).toBe('var(--link)');
});

test('every focusable element gets a 2px ring in the focus token, set off from the element, in the base layer', () => {
  const ring = ruleIn(BASE, ':focus-visible');
  expect(ring.get('outline')).toBe('2px solid var(--focus)');
  expect(ring.get('outline-offset')).toBe('2px');
});

test('reduced motion switches off transitions, animations and smooth scrolling for every element and pseudo-element', () => {
  const [media, ...others] = atRulesOf(app, 'media', '(prefers-reduced-motion: reduce)');
  expect(others).toEqual([]);
  expect(media?.parent?.type).toBe('root');
  const all = ruleIn(media, '*, ::before, ::after');
  expect(Object.fromEntries(all)).toEqual({ animation: 'none', 'scroll-behavior': 'auto', transition: 'none' });
});

test('forced colours keep the borders of controls visible, in a system colour a component can still override', () => {
  const [media, ...others] = atRulesOf(app, 'media', '(forced-colors: active)');
  expect(others).toEqual([]);
  expect(media?.parent).toBe(BASE);
  const controls = ruleIn(media, ':where(button, input, select, textarea, summary, [role="button"], [role="tab"])');
  expect(controls.get('border')).toBe('1px solid ButtonText');
});

test('the tokens file is the only one that defines a value: app.css declares no custom property but its theme mapping', () => {
  const customProperties: string[] = [];
  app.walkDecls(/^--/, (declaration) => {
    if (declaration.parent?.type !== 'atrule') {
      customProperties.push(declaration.prop);
    }
  });
  expect(customProperties).toEqual([]);
  expect(declarationsOf(app, ':root').size).toBe(0);
});
