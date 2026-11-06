// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { fireEvent, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  globex,
  heading,
  noInstallations,
  renderInstallations,
  serveTenants,
  summary,
  tenantOf,
} from './test-support.ts';

// E18-S04: the tenant switcher in the header of the shell, on the screens below an installation.

const ACME = summary();
const GLOBEX = globex();

const serveTwo = () => serveTenants([tenantOf(ACME, 'acme/widgets'), tenantOf(GLOBEX, 'globex/api')]);
const switcherButton = () => screen.findByRole('button', { name: /^Installation/ });
const switcher = () => screen.getByRole('navigation', { name: messages['tenant.switcher.label'] });

async function openSwitcher() {
  const rendered = renderInstallations('/installations/5');
  await heading('acme');
  const button = await switcherButton();
  await rendered.user.click(button);
  return { ...rendered, button };
}

test('the switcher is in the header, as a named nav with a button that names the installation on screen', async () => {
  serveTwo();
  renderInstallations('/installations/5');
  await heading('acme');
  const button = await switcherButton();
  expect(
    within(screen.getByRole('banner')).getByRole('navigation', { name: messages['tenant.switcher.label'] }),
  ).toContainElement(button);
  expect(button).toHaveTextContent('Installation: acme');
  expect([button.getAttribute('aria-expanded'), button.getAttribute('aria-controls')]).toEqual(['false', null]);
  expect(within(switcher()).queryByRole('list')).toBeNull();
  expect(within(switcher()).queryAllByRole('link')).toEqual([]);
});

test('opened, it lists the same installations as links, and marks the active one with aria-current', async () => {
  serveTwo();
  const { button } = await openSwitcher();
  expect(button).toHaveAttribute('aria-expanded', 'true');
  const links = within(switcher()).getAllByRole('link');
  expect(links.map((link) => [link.textContent, link.getAttribute('href'), link.getAttribute('aria-current')])).toEqual(
    [
      ['acme', '/installations/5', 'page'],
      ['globex', '/installations/6', null],
    ],
  );
  expect(button.getAttribute('aria-controls')).toBe(within(switcher()).getByRole('list').id);
});

test('choosing another installation goes to it and closes the list; the focus is on the page, not on a link that is gone', async () => {
  serveTwo();
  const { user, button } = await openSwitcher();
  await user.click(within(switcher()).getByRole('link', { name: 'globex' }));
  expect(await heading('globex')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/installations/6');
  expect(await screen.findByText('globex/api')).toBeInTheDocument();
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(within(switcher()).queryAllByRole('link')).toEqual([]);
  expect(screen.getByRole('main')).toHaveFocus();
  expect(await switcherButton()).toHaveTextContent('Installation: globex');
});

test('the active one, once chosen, is the other one', async () => {
  serveTwo();
  const { user } = await openSwitcher();
  await user.click(within(switcher()).getByRole('link', { name: 'globex' }));
  await heading('globex');
  await user.click(await switcherButton());
  const links = within(switcher()).getAllByRole('link');
  expect(links.map((link) => [link.textContent, link.getAttribute('aria-current')])).toEqual([
    ['acme', null],
    ['globex', 'page'],
  ]);
});

test('Escape closes the list and gives the focus back to the button', async () => {
  serveTwo();
  const { user, button } = await openSwitcher();
  await user.tab();
  expect(within(switcher()).getAllByRole('link')[0]).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button).toHaveFocus();
});

test('Escape does nothing while the list is closed', async () => {
  serveTwo();
  const { user } = renderInstallations('/installations/5');
  await heading('acme');
  const button = await switcherButton();
  button.focus();
  await user.keyboard('{Escape}');
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button).toHaveFocus();
});

test('a click outside closes it, and so does the focus leaving it by Tab', async () => {
  serveTwo();
  const { user, button } = await openSwitcher();
  await user.click(screen.getByRole('main'));
  expect(button).toHaveAttribute('aria-expanded', 'false');
  await user.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  await user.tab({ shift: true });
  expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('a pointer going down on something that takes no focus closes it too', async () => {
  serveTwo();
  const { button } = await openSwitcher();
  expect(button).toHaveAttribute('aria-expanded', 'true');
  fireEvent.pointerDown(screen.getByRole('banner'));
  expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('a click on the button toggles the list, and focus inside it keeps it open', async () => {
  serveTwo();
  const { user, button } = await openSwitcher();
  await user.tab();
  expect(button).toHaveAttribute('aria-expanded', 'true');
  await user.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('the keyboard operates it: Enter on the button opens it, Tab reaches the links, Enter on one goes there', async () => {
  serveTwo();
  const { user } = renderInstallations('/installations/5');
  await heading('acme');
  const button = await switcherButton();
  button.focus();
  await user.keyboard('{Enter}');
  await user.tab();
  await user.tab();
  expect(within(switcher()).getByRole('link', { name: 'globex' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(await heading('globex')).toBeInTheDocument();
});

test('with one installation the switcher lists just that one, active', async () => {
  serveTenants([tenantOf(ACME, 'acme/widgets')]);
  const { user } = renderInstallations('/installations/5');
  await heading('acme');
  await user.click(await switcherButton());
  expect(
    within(switcher())
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-current')),
  ).toEqual(['page']);
});

test('on an installation that the list does not hold the button is named without an account', async () => {
  serveTenants([tenantOf(GLOBEX, 'globex/api')]);
  renderInstallations('/installations/5');
  const button = await switcherButton();
  expect(button).toHaveTextContent(/^Installation$/);
});

test.each(['/installations', '/me/signatures', '/'])('%s has no tenant switcher', async (route) => {
  serveTwo();
  renderInstallations(route);
  await screen.findByRole('banner');
  await screen.findByRole('button', { name: messages['auth.logout'] });
  expect(screen.queryByRole('navigation', { name: messages['tenant.switcher.label'] })).toBeNull();
});

test('a person who administers nothing, and a list that fails, get no switcher on a tenant page', async () => {
  serveTenants([], noInstallations);
  const none = renderInstallations('/installations/5');
  await screen.findByRole('alert');
  expect(screen.queryByRole('navigation', { name: messages['tenant.switcher.label'] })).toBeNull();
  none.unmount();
  serveTenants([tenantOf(ACME, 'acme/widgets')], () => new Response(null, { status: 500 }));
  renderInstallations('/installations/5');
  await heading(messages['installation.title']);
  expect(screen.queryByRole('navigation', { name: messages['tenant.switcher.label'] })).toBeNull();
});

test('the switcher passes axe closed and open', async () => {
  serveTwo();
  const { container, user } = renderInstallations('/installations/5');
  await heading('acme');
  const button = await switcherButton();
  await expectNoA11yViolations(container);
  await user.click(button);
  expect(within(switcher()).getAllByRole('link')).toHaveLength(2);
  await expectNoA11yViolations(container);
});
