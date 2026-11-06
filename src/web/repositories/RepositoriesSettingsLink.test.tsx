// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { repository } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { gadgets, openRepositories, pageOf, REPOSITORIES_ROUTE, rowOf, widgets } from './test-support.ts';

// E18-S10 with E22-S03: the row of a repository the viewer administers leads to the settings screen of that repository (the public
// badge), in the installation of the address, and a row the viewer does not administer leads nowhere.

test('a row the viewer administers has a link to the settings of that repository, named after it', async () => {
  await openRepositories(REPOSITORIES_ROUTE, { list: [pageOf([widgets(), gadgets({ canAdminister: false })])] });
  const link = within(rowOf('acme/widgets')).getByRole('link', { name: 'Settings of acme/widgets' });
  expect(link).toHaveTextContent(messages['repositories.settings']);
  expect(link).toHaveAttribute('href', '/installations/5/repositories/1/settings');
  expect(within(rowOf('acme/gadgets')).queryByRole('link')).toBeNull();
});

test('the link carries the id of its own row, so each row opens its own repository', async () => {
  await openRepositories(REPOSITORIES_ROUTE, {
    list: [pageOf([widgets(), gadgets(), repository(31, 'acme/api', { enabled: true, document: null })])],
  });
  const hrefs = ['acme/widgets', 'acme/gadgets', 'acme/api'].map((name) =>
    within(rowOf(name))
      .getByRole('link', { name: `Settings of ${name}` })
      .getAttribute('href'),
  );
  expect(hrefs).toEqual([
    '/installations/5/repositories/1/settings',
    '/installations/5/repositories/2/settings',
    '/installations/5/repositories/31/settings',
  ]);
});

test('following the link opens the settings screen of the repository', async () => {
  const { user } = await openRepositories(REPOSITORIES_ROUTE, { list: [pageOf([widgets()])] });
  await user.click(screen.getByRole('link', { name: 'Settings of acme/widgets' }));
  await waitFor(() => {
    expect(window.location.pathname).toBe('/installations/5/repositories/1/settings');
  });
  expect(
    await screen.findByRole('heading', { level: 1, name: messages['repository.settings.title'] }),
  ).toBeInTheDocument();
});

test('a row with the link passes axe', async () => {
  await openRepositories(REPOSITORIES_ROUTE, { list: [pageOf([widgets(), gadgets()])] });
  await expectNoA11yViolations(document.body);
});
