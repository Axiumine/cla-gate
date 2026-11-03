// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { declarationsOf, parseCss } from './css.ts';
import { applyUtilitiesOf, classNamesIn, utilitiesFor } from './tailwind.ts';

// E17-S11: the helper that gives a rendered component the CSS of its Tailwind classes.

test('the class names of an element and of everything inside it are listed once each', () => {
  const { container } = render(
    <section className="a b">
      <p className="b c">text</p>
      <p>no class</p>
    </section>,
  );
  expect(classNamesIn(container)).toHaveLength(3);
  expect(new Set(classNamesIn(container))).toEqual(new Set(['a', 'b', 'c']));
  const section = container.firstElementChild;
  expect(new Set(classNamesIn(section ?? container))).toEqual(new Set(['a', 'b', 'c']));
});

test('a class Tailwind knows gets the declarations it stands for, and one it does not know gets nothing', async () => {
  const sheet = parseCss(await utilitiesFor(['wrap-anywhere', 'not-a-utility']));
  expect(Object.fromEntries(declarationsOf(sheet, '.wrap-anywhere'))).toEqual({ 'overflow-wrap': 'anywhere' });
  expect(declarationsOf(sheet, '.not-a-utility').size).toBe(0);
});

test('the applied styles reach getComputedStyle, and taking them out again returns the element to its default', async () => {
  const { container } = render(<p className="wrap-anywhere">text</p>);
  const paragraph = container.querySelector('p');
  const before = document.querySelectorAll('style').length;
  const remove = await applyUtilitiesOf(container);
  expect(document.querySelectorAll('style')).toHaveLength(before + 1);
  expect(paragraph ? getComputedStyle(paragraph).overflowWrap : null).toBe('anywhere');
  remove();
  expect(document.querySelectorAll('style')).toHaveLength(before);
  expect(paragraph ? getComputedStyle(paragraph).overflowWrap : null).not.toBe('anywhere');
});
