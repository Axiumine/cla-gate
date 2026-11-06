// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { visibleText } from '../ui/user-text.ts';
import {
  installationOf,
  operatorList,
  operatorTable,
  rejectedOf,
  renderOperator,
  rowsOf,
  serveOperator,
} from './test-support.ts';

// E18-S13: an account login is a display snapshot of text that GitHub holds and a person chose. It is drawn as text in the table and
// nowhere as markup, and no login reaches the title of the tab or the announcement of the page: the page is about the instance, not
// about one account.

const NAMES = [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES].map(
  (name) => [JSON.stringify(name).slice(0, 40), name] as const,
);

/** Elements and attributes that a browser would act on, beyond what `activeContent` looks for. */
const ACTIVE = '[onerror], [onclick], [onload], style, iframe, object, embed';

test.each(NAMES)('the login %s is text in the cell, with the hidden characters written out', async (_label, name) => {
  serveOperator(operatorList([installationOf({ accountLogin: name }), rejectedOf({ accountLogin: name })]));
  renderOperator();
  const table = await operatorTable();
  const main = screen.getByRole('main');
  expect(rowsOf(table).map((cells) => cells[0])).toEqual([visibleText(name), visibleText(name)]);
  expect(activeContent(main)).toEqual([]);
  expect(main.querySelectorAll(ACTIVE)).toHaveLength(0);
  expect(table.querySelectorAll('a')).toHaveLength(0);
});

test.each(NAMES)(
  'the login %s is not in the title of the tab or in the announcement of the page',
  async (_label, name) => {
    serveOperator(operatorList([installationOf({ accountLogin: name })]));
    renderOperator();
    await operatorTable();
    const expected = `${messages['operator.title']} · CLA`;
    expect(document.title).toBe(expected);
    expect(document.title).toBe(visibleText(document.title));
    expect(screen.getByText(messages['operator.title'], { selector: '[role="status"]' })).toBeInTheDocument();
  },
);

test('a login of 300 letters with no space stays in the table that scrolls on its own, and the table passes axe', async () => {
  const name = `<img src=x onerror=alert(1)> ${'n'.repeat(300)}`;
  serveOperator(operatorList([installationOf({ accountLogin: name }), rejectedOf()]));
  const { container } = renderOperator();
  const table = await operatorTable();
  expect(table.parentElement).toHaveClass('overflow-x-auto');
  expect(rowsOf(table)[0]?.[0]).toBe(visibleText(name));
  await expectNoA11yViolations(container);
});

test('a hostile login is only ever the login: the stored reason and the id beside it stay what the endpoint said', async () => {
  const name = '<script>alert(1)</script>';
  serveOperator(operatorList([rejectedOf({ accountLogin: name })]));
  renderOperator();
  const table = await operatorTable();
  const [cells] = rowsOf(table);
  expect(cells?.[0]).toBe(name);
  expect(cells?.[2]).toBe('100002');
  expect(table.querySelectorAll('td:nth-child(4) code')[0]?.textContent).toBe('account_not_allowed');
});
