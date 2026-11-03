// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { RequestId } from './RequestId.tsx';

// E17-S07: the request id in <code> with a copy button.

const ID = 'req-00000001';

test('the id is in a <code> element after its label', () => {
  renderWithProviders(<RequestId id={ID} />);
  expect(screen.getByText('Request ID')).toBeInTheDocument();
  const code = screen.getByText(ID);
  expect(code.tagName).toBe('CODE');
});

test('the copy button has a name of its own and puts the id on the clipboard, and the result is announced', async () => {
  const { user } = renderWithProviders(<RequestId id={ID} />);
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  await user.click(screen.getByRole('button', { name: 'Copy request ID' }));
  expect(await screen.findByText('Request ID copied')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Request ID copied');
  expect(await navigator.clipboard.readText()).toBe(ID);
});

test('Enter and Space on the focused button copy too', async () => {
  const { user } = renderWithProviders(<RequestId id={ID} />);
  const writeText = vi.spyOn(navigator.clipboard, 'writeText');
  await user.tab();
  expect(screen.getByRole('button', { name: 'Copy request ID' })).toHaveFocus();
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  expect(writeText).toHaveBeenCalledTimes(2);
  expect(writeText).toHaveBeenCalledWith(ID);
  await user.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Copy request ID' })).toHaveFocus();
});

test('a clipboard that refuses is told to the person, and nothing crashes', async () => {
  const { user } = renderWithProviders(<RequestId id={ID} />);
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
  await user.click(screen.getByRole('button', { name: 'Copy request ID' }));
  expect(await screen.findByText('The request ID could not be copied')).toBeInTheDocument();
});

test('a browser with no Clipboard API is told the same', async () => {
  const { user } = renderWithProviders(<RequestId id={ID} />);
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  await user.click(screen.getByRole('button', { name: 'Copy request ID' }));
  expect(await screen.findByText('The request ID could not be copied')).toBeInTheDocument();
});

test('it passes axe, before and after a copy', async () => {
  const { container, user } = renderWithProviders(<RequestId id={ID} />);
  await expectNoA11yViolations(container);
  await user.click(screen.getByRole('button', { name: 'Copy request ID' }));
  await screen.findByText('Request ID copied');
  await expectNoA11yViolations(container);
});
