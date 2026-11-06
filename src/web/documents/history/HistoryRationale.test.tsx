// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../../i18n/index.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
import { RATIONALE_PREVIEW } from './RationaleCell.tsx';
import { historyVersion, openHistory, rowOf, V1_0, V1_1 } from './test-support.ts';

// E18-S11: a rationale of up to 200 characters is shown whole; a longer one is cut at 200 and can be expanded and folded again.

const LONG = `${'Zzzz clarified the grant. '.repeat(12)}The end.`;

/** The history with the rationale of 1.1 replaced. */
const withRationale = (rationale: string) => ({ versions: [historyVersion(), { ...V1_1, rationale }, V1_0] });

const SHOW = /Show all|Show less/;
const expander = (number: string) => within(rowOf(number)).getByRole('button', { name: SHOW });

test('a rationale of exactly 200 characters is shown whole, with nothing to expand', async () => {
  const exact = 'x'.repeat(RATIONALE_PREVIEW);
  await openHistory({ history: withRationale(exact) });
  expect(rowOf('1.1').querySelectorAll('td')[3]?.textContent).toBe(exact);
  expect(within(rowOf('1.1')).queryByRole('button', { name: SHOW })).toBeNull();
});

test('a rationale of 201 characters is cut at 200 with an ellipsis, and the whole text stays for a screen reader', async () => {
  const text = `${'y'.repeat(RATIONALE_PREVIEW)}z`;
  await openHistory({ history: withRationale(text) });
  const cell = rowOf('1.1').querySelectorAll('td')[3];
  expect(cell?.querySelector('[aria-hidden="true"]')?.textContent).toBe(`${'y'.repeat(RATIONALE_PREVIEW)}…`);
  expect(cell?.querySelector('.sr-only')?.textContent).toBe(text);
  expect(expander('1.1')).toHaveAttribute('aria-expanded', 'false');
});

test('"Show all" shows the whole rationale, says it is expanded, and "Show less" folds it again', async () => {
  const { user } = await openHistory({ history: withRationale(LONG) });
  const button = expander('1.1');
  await user.click(button);
  const cell = rowOf('1.1').querySelectorAll('td')[3];
  expect(cell?.textContent).toContain(LONG);
  expect(cell?.querySelector('[aria-hidden="true"]')).toBeNull();
  const open = expander('1.1');
  expect(open).toHaveTextContent(messages['history.rationale.less']);
  expect(open).toHaveAttribute('aria-expanded', 'true');
  expect(open.getAttribute('aria-controls')).toBe(cell?.querySelector('div > div')?.id);
  await user.click(open);
  expect(expander('1.1')).toHaveAttribute('aria-expanded', 'false');
  expect(rowOf('1.1').querySelectorAll('td')[3]?.querySelector('[aria-hidden="true"]')).not.toBeNull();
});

test('each row expands on its own', async () => {
  const { user } = await openHistory({
    history: { versions: [historyVersion({ rationale: LONG }), { ...V1_1, rationale: LONG }, V1_0] },
  });
  await user.click(expander('2.0'));
  expect(expander('2.0')).toHaveAttribute('aria-expanded', 'true');
  expect(expander('1.1')).toHaveAttribute('aria-expanded', 'false');
});

test('the button can be used with the keyboard, and the list passes axe expanded and folded', async () => {
  const { user, container } = await openHistory({ history: withRationale(LONG) });
  await expectNoA11yViolations(container);
  expander('1.1').focus();
  await user.keyboard('{Enter}');
  expect(expander('1.1')).toHaveAttribute('aria-expanded', 'true');
  await expectNoA11yViolations(container);
  expect(screen.getAllByRole('button', { name: messages['history.rationale.less'] })).toHaveLength(1);
});
