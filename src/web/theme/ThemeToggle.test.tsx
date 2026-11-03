// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { systemColorScheme } from '../test-support/theme.ts';
import { ThemeToggle } from './ThemeToggle.tsx';

// E17-S09: the theme toggle, a radio group of system, light and dark on useTheme() (E17-S05).

const radio = (mode: Mode) => screen.getByRole('radio', { name: messages[`theme.${mode}`] });
const theme = () => document.documentElement.getAttribute('data-theme');
const stored = () => localStorage.getItem('cla.theme');

type Mode = 'system' | 'light' | 'dark';

/** Presses an arrow key the way a person does, held until the focus has moved: Radix checks the radio it lands on while the key is down. */
async function arrowTo(user: UserEvent, key: string, mode: Mode): Promise<void> {
  await user.keyboard(`{${key}>}`);
  await waitFor(() => {
    expect(radio(mode)).toHaveFocus();
  });
  await user.keyboard(`{/${key}}`);
}

test('it is a radio group named by the catalog, with the three modes labelled by the catalog, system first and chosen', () => {
  renderWithProviders(<ThemeToggle />);
  expect(screen.getByRole('radiogroup', { name: messages['theme.label'] })).toBeInTheDocument();
  expect(screen.getAllByRole('radio').map((item) => item.getAttribute('value'))).toEqual(['system', 'light', 'dark']);
  expect(screen.getAllByRole('radio').map((item) => item.getAttribute('aria-checked'))).toEqual([
    'true',
    'false',
    'false',
  ]);
  expect(screen.getByText(messages['theme.dark'])).toBeInTheDocument();
});

test('choosing a mode with the pointer applies it to the page and remembers it, on the radio or on its label', async () => {
  const { user } = renderWithProviders(<ThemeToggle />);
  await user.click(radio('dark'));
  expect([theme(), stored(), radio('dark').getAttribute('aria-checked')]).toEqual(['dark', 'dark', 'true']);
  await user.click(screen.getByText(messages['theme.light']));
  expect([theme(), stored(), radio('light').getAttribute('aria-checked')]).toEqual(['light', 'light', 'true']);
});

test('the arrow keys move between the modes and choose the one they land on, and wrap round', async () => {
  const { user } = renderWithProviders(<ThemeToggle />);
  radio('system').focus();
  await arrowTo(user, 'ArrowRight', 'light');
  expect([theme(), stored()]).toEqual(['light', 'light']);
  await arrowTo(user, 'ArrowRight', 'dark');
  expect([theme(), stored()]).toEqual(['dark', 'dark']);
  await arrowTo(user, 'ArrowRight', 'system');
  expect(stored()).toBe('system');
  await arrowTo(user, 'ArrowLeft', 'dark');
  expect([theme(), stored()]).toEqual(['dark', 'dark']);
});

test('the group is one tab stop, on the chosen mode, and Space chooses the focused one', async () => {
  const { user } = renderWithProviders(
    <>
      <button type="button">before</button>
      <ThemeToggle />
      <button type="button">after</button>
    </>,
  );
  await user.click(radio('light'));
  screen.getByRole('button', { name: 'before' }).focus();
  await user.tab();
  expect(radio('light')).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(radio('light')).toHaveFocus();
  await arrowTo(user, 'ArrowRight', 'dark');
  radio('light').focus();
  await user.keyboard(' ');
  expect([radio('light').getAttribute('aria-checked'), stored()]).toEqual(['true', 'light']);
});

test('the stored choice is the one shown when the page starts', () => {
  localStorage.setItem('cla.theme', 'dark');
  renderWithProviders(<ThemeToggle />);
  expect(radio('dark').getAttribute('aria-checked')).toBe('true');
  expect(theme()).toBe('dark');
});

test('on "system" the page follows the system preference, and a chosen mode ignores it', async () => {
  const { user } = renderWithProviders(<ThemeToggle />);
  act(() => {
    systemColorScheme.set(true);
  });
  expect(theme()).toBe('dark');
  expect(radio('system').getAttribute('aria-checked')).toBe('true');
  await user.click(radio('light'));
  act(() => {
    systemColorScheme.set(false);
    systemColorScheme.set(true);
  });
  expect(theme()).toBe('light');
});

test('the options lie in a row and the group passes axe', async () => {
  const { container } = renderWithProviders(<ThemeToggle />);
  expect(screen.getByRole('radiogroup')).toHaveClass('flex-row!');
  await expectNoA11yViolations(container);
});
