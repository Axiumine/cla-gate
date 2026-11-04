// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { copyOf, on, openSettings, SNIPPET } from './test-support.ts';

// E22-S03: the copy buttons of the snippet. Each form has its own button, named for it, and the result is said in the live region.

afterEach(() => {
  vi.restoreAllMocks();
});

const NAMED = [
  [messages['repository.badge.markdown'], SNIPPET.markdown],
  [messages['repository.badge.html'], SNIPPET.html],
] as const;

test.each(NAMED)('Copy puts the %s snippet on the clipboard, and a polite live region says so', async (name, text) => {
  const { user } = openSettings([on()]);
  await screen.findByRole('textbox', { name: name });
  const write = vi.spyOn(navigator.clipboard, 'writeText');
  await user.click(copyOf(name));
  expect(write).toHaveBeenCalledExactlyOnceWith(text);
  const said = messages['repository.badge.copied'].replace('{name}', name);
  await waitFor(() => {
    expect(screen.getByText(said)).toBeInTheDocument();
  });
  expect(screen.getByText(said).closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
});

test('the two buttons are told apart by name, not by position, and none of them is a bare "Copy"', async () => {
  const { container } = openSettings([on()]);
  await screen.findByRole('textbox', { name: messages['repository.badge.markdown'] });
  expect(copyOf(messages['repository.badge.markdown'])).toBeInTheDocument();
  expect(copyOf(messages['repository.badge.html'])).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: messages['repository.badge.copy'] })).toBeNull();
  await expectNoA11yViolations(container);
});

test.each([
  [
    'the Clipboard API is missing',
    () => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }),
  ],
  [
    'the Clipboard API refuses',
    () => vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied')),
  ],
])(
  'when %s, the message says to select and copy by hand, and nothing is announced as copied',
  async (_what, arrange) => {
    const { user } = openSettings([on()]);
    await screen.findByRole('textbox', { name: messages['repository.badge.markdown'] });
    arrange();
    await user.click(copyOf(messages['repository.badge.markdown']));
    expect(await screen.findByText(messages['repository.badge.copyUnavailable'])).toBeInTheDocument();
    expect(
      screen.queryByText(messages['repository.badge.copied'].replace('{name}', messages['repository.badge.markdown'])),
    ).toBeNull();
  },
);

test('the snippet is shown as the value of a field and never as markup: the HTML form puts no element on the page', async () => {
  const { container } = openSettings([on()]);
  await screen.findByRole('textbox', { name: messages['repository.badge.html'] });
  expect(container.querySelector('img[src*="badge.svg"]')).toBeNull();
  expect(container.querySelector('a[href*="/sign/"]')).toBeNull();
});
