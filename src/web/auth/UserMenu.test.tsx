// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { ALICE } from '../test-support/session.ts';

// E17-S08: the user menu: the avatar and "Log out" for someone logged in, "Log in with GitHub" for anyone else.

test('a logged-in visitor gets the avatar and "Log out", and no login link', async () => {
  const { container } = renderWithProviders(<AppRouter />, { session: ALICE });
  const account = (await screen.findByRole('button', { name: messages['auth.logout'] })).parentElement;
  expect(account?.querySelector('img')).toHaveAttribute('src', 'https://avatars.githubusercontent.com/u/4711?v=4');
  expect(screen.queryByRole('link', { name: messages['auth.login'] })).toBeNull();
  expect(container.textContent).not.toContain('4711');
});

test('an avatar on another host is not loaded: the initials of the login are shown instead', async () => {
  const hostile = { ...ALICE, user: { ...ALICE.user, avatarUrl: 'https://evil.example/avatar.png' } };
  renderWithProviders(<AppRouter />, { session: hostile });
  const account = (await screen.findByRole('button', { name: messages['auth.logout'] })).parentElement;
  expect(account?.querySelector('img')).toBeNull();
  expect(account).toHaveTextContent('OC');
  expect(document.querySelector('img[src*="evil.example"]')).toBeNull();
});

test('a visitor without a session gets "Log in with GitHub" that returns to the page they are on', async () => {
  renderWithProviders(<AppRouter />, { route: '/no/such/page?x=1' });
  const login = await screen.findByRole('link', { name: messages['auth.login'] });
  expect(login).toHaveAttribute('href', '/api/auth/login?return_to=%2Fno%2Fsuch%2Fpage%3Fx%3D1');
  expect(screen.queryByRole('button', { name: messages['auth.logout'] })).toBeNull();
});

test('nothing is shown while the server has not said who is logged in', () => {
  renderWithProviders(<AppRouter />, { session: ALICE });
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
});

test('the menu is reached with the keyboard: Tab arrives at "Log out"', async () => {
  const { user } = renderWithProviders(<AppRouter />, { session: ALICE });
  await screen.findByRole('button', { name: messages['auth.logout'] });
  await user.tab();
  expect(screen.getByRole('button', { name: messages['auth.logout'] })).toHaveFocus();
});

test('both forms pass axe', async () => {
  const loggedIn = renderWithProviders(<AppRouter />, { session: ALICE });
  await loggedIn.findByRole('button', { name: messages['auth.logout'] });
  await expectNoA11yViolations(loggedIn.container);
  loggedIn.unmount();
  const anonymous = renderWithProviders(<AppRouter />);
  await anonymous.findAllByRole('link', { name: messages['auth.login'] });
  await expectNoA11yViolations(anonymous.container);
});
