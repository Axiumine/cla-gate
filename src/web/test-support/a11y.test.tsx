// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { render } from '@testing-library/react';
import axe from 'axe-core';
import { createElement } from 'react';
import { expect, test, vi } from 'vitest';
import { a11yViolations, expectNoA11yViolations } from './a11y.ts';

// E17-S06: the axe helper passes a clean page, fails a broken one with a message that names the rule and the element, and
// runs with the two rules that jsdom (no layout, no cascade) or a fragment (no landmarks) would get wrong turned off. The
// broken pages are built with createElement, because the Biome a11y rules rightly refuse to lint them as JSX.

test('a labelled button and a labelled field pass', async () => {
  const { container } = render(
    <form>
      <label htmlFor="name">Name</label>
      <input id="name" />
      <button type="button">Save</button>
    </form>,
  );
  await expectNoA11yViolations(container);
});

test('an image without alternative text fails, and the failure names the rule and the element', async () => {
  const { container } = render(createElement('img', { src: 'logo.png' }));
  expect(await a11yViolations(container)).toEqual(['image-alt: Images must have alternative text [img]']);
  await expect(expectNoA11yViolations(container)).rejects.toThrow(/image-alt/u);
});

test.each([
  ['a button without a name', 'button', 'button-name'],
  ['an input without a label', 'input', 'label'],
  ['a link without text', 'a', 'link-name'],
])('%s fails', async (_what, tag, rule) => {
  const { container } = render(createElement('div', null, createElement(tag, { href: '/somewhere' })));
  const violations = await a11yViolations(container);
  expect(violations).toHaveLength(1);
  expect(violations[0]?.startsWith(`${rule}:`)).toBe(true);
});

test('every violation is reported, one line each', async () => {
  const { container } = render(
    createElement('div', null, createElement('img', { src: 'a.png' }), createElement('button', { type: 'button' })),
  );
  const violations = await a11yViolations(container);
  expect(violations.map((line) => line.split(':')[0])).toEqual(expect.arrayContaining(['image-alt', 'button-name']));
  expect(violations).toHaveLength(2);
});

test('color-contrast is switched off, because jsdom cannot compute a colour', async () => {
  const run = vi.spyOn(axe, 'run');
  const { container } = render(<p>text</p>);
  await expectNoA11yViolations(container);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]?.[1]).toMatchObject({ rules: { 'color-contrast': { enabled: false } } });
});

test('a fragment outside any landmark passes: the region rule is off, the shell tests assert the landmarks', async () => {
  render(<p>Some text outside any landmark</p>);
  await expectNoA11yViolations(document.body);
});
