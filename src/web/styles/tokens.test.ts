// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { colourTokens, declarationsOf, parseCss, themeTokens } from '../test-support/css.ts';
import appCss from './app.css?raw';
import tokensCss from './tokens.css?raw';

// E17-S05: the shape of tokens.css. The values of the colours are judged by src/web/theme/contrast.test.ts.

const tokens = themeTokens(tokensCss);
const names = [...tokens.light.keys()].filter((name) => name.startsWith('--'));
const namesWith = (prefix: string): string[] => names.filter((name) => name.startsWith(prefix));

test('the colour, spacing, radius and type tokens are custom properties of :root', () => {
  expect(colourTokens(tokens.light).size).toBeGreaterThanOrEqual(20);
  expect(namesWith('--space-').length).toBeGreaterThanOrEqual(8);
  expect(namesWith('--radius-').length).toBeGreaterThanOrEqual(3);
  expect(namesWith('--font-')).toEqual(['--font-sans', '--font-mono']);
  expect(namesWith('--size-').length).toBeGreaterThanOrEqual(5);
  expect(namesWith('--leading-').length).toBeGreaterThanOrEqual(2);
  expect(namesWith('--weight-').length).toBeGreaterThanOrEqual(3);
});

test('every custom property of :root is a colour, a space, a radius or a type token, and nothing else', () => {
  const colours = new Set(colourTokens(tokens.light).keys());
  const others = names.filter((name) => !colours.has(name));
  expect(others.filter((name) => !/^--(?:space|radius|font|size|leading|weight)-/.test(name))).toEqual([]);
});

test('the dark theme redefines colours only: spacing, radius and type do not change with the theme', () => {
  const colours = new Set(colourTokens(tokens.darkOverrides).keys());
  expect([...tokens.darkOverrides.keys()].filter((name) => name.startsWith('--') && !colours.has(name))).toEqual([]);
});

test('the spacing scale is whole multiples of --space-1, so a Tailwind step and its token agree', () => {
  const rem = (name: string): number => Number.parseFloat(tokens.light.get(name) ?? 'NaN');
  const scale = namesWith('--space-');
  expect(rem('--space-1')).toBe(0.25);
  for (const name of scale) {
    const step = Number(name.slice('--space-'.length));
    expect(tokens.light.get(name)).toMatch(/^[\d.]+rem$/);
    expect(rem(name)).toBeCloseTo(step * 0.25, 10);
  }
});

test('the colour-scheme property follows the active theme: both until it is known, then light or dark', () => {
  const root = parseCss(tokensCss);
  expect(declarationsOf(root, ':root').get('color-scheme')).toBe('light dark');
  expect(declarationsOf(root, ':root[data-theme="light"]').get('color-scheme')).toBe('light');
  expect(declarationsOf(root, ':root[data-theme="dark"]').get('color-scheme')).toBe('dark');
});

test('the fonts are the system stacks and nothing is loaded: no web font, no @font-face, no @import, no url()', () => {
  expect(tokens.light.get('--font-sans')).toMatch(/^system-ui,/);
  expect(tokens.light.get('--font-mono')).toMatch(/^ui-monospace,/);
  const loads: string[] = [];
  for (const css of [tokensCss, appCss]) {
    const root = parseCss(css);
    root.walkAtRules(/^(?:font-face|import)$/, (rule) => {
      loads.push(
        ...(rule.name === 'font-face' || /url\(|https?:|^["']?\/\//.test(rule.params)
          ? [`@${rule.name} ${rule.params}`]
          : []),
      );
    });
    root.walkDecls((declaration) => {
      loads.push(...(/url\(|https?:/i.test(declaration.value) ? [`${declaration.prop}: ${declaration.value}`] : []));
    });
  }
  expect(loads).toEqual([]);
});
