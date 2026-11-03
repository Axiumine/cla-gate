// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { TestAppRoutes } from '../test-support/app-routes.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { ALICE } from '../test-support/session.ts';

// E17-S09: the application shell: the landmarks, the skip link, the collapsing navigation, the header slot and the user menu.

function Plain() {
  return (
    <p>
      <Link to="/login/failed">Next</Link>
    </p>
  );
}

function TenantSwitcher() {
  return <button type="button">Switch tenant</button>;
}

const pages = [
  { path: '/', access: 'public', component: Plain, title: 'landing.title' },
  {
    path: '/login/failed',
    access: 'public',
    component: Plain,
    title: 'login.failed.title',
    headerSlot: <TenantSwitcher />,
  },
] as const;

const menuButton = () => screen.getByRole('button', { name: messages['nav.menu'] });
const links = () => screen.getByRole('navigation', { name: messages['nav.label'] }).querySelector('ul');

test('the page has the four landmarks once each: header, a named nav, main with its target id, and footer', async () => {
  renderWithProviders(<AppRouter />);
  await screen.findAllByRole('link', { name: messages['auth.login'] });
  expect(screen.getAllByRole('banner')).toHaveLength(1);
  expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
  expect(screen.getAllByRole('navigation')).toHaveLength(1);
  expect(screen.getByRole('navigation', { name: messages['nav.label'] })).toBeInTheDocument();
  const main = screen.getByRole('main');
  expect([main.id, main.getAttribute('tabindex'), main.tagName]).toEqual(['main', '-1', 'MAIN']);
  expect(screen.getByRole('banner').tagName).toBe('HEADER');
  expect(screen.getByRole('contentinfo').tagName).toBe('FOOTER');
});

test('the landmarks come in reading order: skip link, header, main, footer', async () => {
  renderWithProviders(<AppRouter />);
  await screen.findAllByRole('link', { name: messages['auth.login'] });
  const order = [
    screen.getByRole('link', { name: messages['nav.skip'] }),
    screen.getByRole('banner'),
    screen.getByRole('main'),
    screen.getByRole('contentinfo'),
  ];
  for (const [index, element] of order.entries()) {
    const next = order[index + 1];
    expect(next === undefined || element.compareDocumentPosition(next) === Node.DOCUMENT_POSITION_FOLLOWING).toBe(true);
  }
});

test('"Skip to content" is the first thing Tab reaches, and it points at the main landmark', async () => {
  const { user } = renderWithProviders(<AppRouter />);
  await screen.findAllByRole('link', { name: messages['auth.login'] });
  await user.tab();
  const skip = screen.getByRole('link', { name: messages['nav.skip'] });
  expect(skip).toHaveFocus();
  expect(skip).toHaveAttribute('href', '#main');
  expect(document.getElementById('main')).toBe(screen.getByRole('main'));
  expect(skip).toHaveClass('sr-only', 'focus:not-sr-only');
  await user.keyboard('{Enter}');
  expect(window.location.hash).toBe('#main');
});

test('the navigation collapses behind a disclosure button below 768 px, and lies in a row from there', () => {
  renderWithProviders(<TestAppRoutes route="/" pages={pages} />);
  expect(menuButton()).toHaveClass('md:hidden');
  expect(links()).toHaveClass('hidden', 'md:flex', 'md:flex-row');
});

test('the disclosure button says whether it is open and which list it controls, and Enter and Space work it', async () => {
  const { user } = renderWithProviders(<TestAppRoutes route="/" pages={pages} />);
  await screen.findByRole('link', { name: messages['nav.home'], hidden: true });
  expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
  expect(menuButton().getAttribute('aria-controls')).toBe(links()?.id);
  expect(links()).toHaveClass('hidden');
  await user.tab();
  await user.tab();
  expect(menuButton()).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(menuButton()).toHaveAttribute('aria-expanded', 'true');
  expect(links()).toHaveClass('flex');
  expect(links()).not.toHaveClass('hidden');
  await user.keyboard(' ');
  expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
  expect(links()).toHaveClass('hidden');
});

test('Escape closes the open list from the button or from a link in it, and focus is back on the button', async () => {
  const { user } = renderWithProviders(<TestAppRoutes route="/" pages={pages} />);
  await screen.findByRole('link', { name: messages['nav.home'], hidden: true });
  await user.click(menuButton());
  await user.keyboard('{Escape}');
  expect([menuButton().getAttribute('aria-expanded'), document.activeElement]).toEqual(['false', menuButton()]);
  await user.click(menuButton());
  await user.tab();
  expect(screen.getByRole('link', { name: messages['nav.home'] })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect([menuButton().getAttribute('aria-expanded'), document.activeElement]).toEqual(['false', menuButton()]);
});

test('Escape does nothing while the list is closed, and choosing a link closes the list', async () => {
  const { user } = renderWithProviders(<TestAppRoutes route="/login/failed" pages={pages} />);
  const home = await screen.findByRole('link', { name: messages['nav.home'], hidden: true });
  menuButton().focus();
  await user.keyboard('{Escape}');
  expect(menuButton()).toHaveFocus();
  await user.click(menuButton());
  await user.click(home);
  expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
  expect(links()).toHaveClass('hidden');
});

test('the link of the page that shows has aria-current="page", and the others have none', async () => {
  renderWithProviders(<TestAppRoutes route="/" pages={pages} />);
  const home = await screen.findByRole('link', { name: messages['nav.home'], hidden: true });
  expect(home).toHaveAttribute('aria-current', 'page');
  renderWithProviders(<TestAppRoutes route="/login/failed" pages={pages} />);
  const links = await screen.findAllByRole('link', { name: messages['nav.home'], hidden: true });
  expect(links.map((link) => link.getAttribute('aria-current'))).toEqual(['page', null]);
});

test('a route can supply a header slot, which shows in the header while that page does and not after', async () => {
  const { user } = renderWithProviders(<TestAppRoutes route="/login/failed" pages={pages} />);
  const header = await screen.findByRole('banner');
  expect(within(header).getByRole('button', { name: 'Switch tenant' })).toBeInTheDocument();
  await user.click(within(header).getByRole('link', { name: messages['nav.home'], hidden: true }));
  expect(await screen.findByRole('link', { name: 'Next' })).toBeInTheDocument();
  expect(within(header).queryByRole('button', { name: 'Switch tenant' })).toBeNull();
});

test('a logged-in person sees their avatar, their login as text and never their numeric id, the theme choice, and "Log out"', async () => {
  const { container } = renderWithProviders(<AppRouter />, { session: ALICE });
  const header = screen.getByRole('banner');
  await within(header).findByRole('button', { name: messages['auth.logout'] });
  expect(within(header).getByText(ALICE.user.login).tagName).toBe('BDI');
  expect(header.querySelector('img')).toHaveAttribute('src', ALICE.user.avatarUrl);
  expect(within(header).getByRole('radiogroup', { name: messages['theme.label'] })).toBeInTheDocument();
  expect(container.textContent).not.toContain(String(ALICE.user.githubId));
  expect(within(header).queryByRole('link', { name: messages['auth.login'] })).toBeNull();
});

test('a visitor sees "Log in with GitHub" and the theme choice, and no account', async () => {
  renderWithProviders(<AppRouter />);
  const header = screen.getByRole('banner');
  await within(header).findByRole('link', { name: messages['auth.login'] });
  expect(within(header).getByRole('radiogroup', { name: messages['theme.label'] })).toBeInTheDocument();
  expect(within(header).queryByRole('button', { name: messages['auth.logout'] })).toBeNull();
  expect(header.querySelector('img, bdi')).toBeNull();
});

test('the shell passes axe for a visitor, for a logged-in person, and with the navigation open', async () => {
  const visitor = renderWithProviders(<AppRouter />);
  await visitor.findAllByRole('link', { name: messages['auth.login'] });
  await expectNoA11yViolations(visitor.container);
  visitor.unmount();
  const member = renderWithProviders(<AppRouter />, { session: ALICE });
  await member.findByRole('button', { name: messages['auth.logout'] });
  await expectNoA11yViolations(member.container);
  await member.user.click(menuButton());
  await expectNoA11yViolations(member.container);
});
