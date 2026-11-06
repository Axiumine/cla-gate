// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope, json } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { summary } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  gadgets,
  openRepositories,
  pageOf,
  REPOSITORIES_ROUTE,
  renderRepositories,
  repositoriesTable,
  rowOf,
  searchBox,
  serveRepositories,
  widgets,
} from './test-support.ts';

// E18-S10: what the role and the state of the installation decide. A suspended installation only reads: its banner is shown and the
// actions are off; a repo admin has the actions on the repositories they administer.

const SUSPENDED = [{ summary: summary({ suspended: true }), answer: () => pageOf([]) }];
const REPO_ADMIN = [{ summary: summary({ role: 'repo_admin' }), answer: () => pageOf([]) }];
const buttonsOf = (name: string) =>
  within(rowOf(name))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));

test('a suspended installation shows the banner of E18-S04 and still lists the repositories, and every action is off', async () => {
  const { served, user } = await openRepositories(undefined, { tenants: SUSPENDED });
  expect(screen.getByText(messages['installation.suspended'])).toBeInTheDocument();
  expect(repositoriesTable()).toBeInTheDocument();
  const buttons = within(repositoriesTable()).getAllByRole('button');
  expect(buttons).toHaveLength(4);
  for (const button of buttons) {
    expect(button).toBeDisabled();
    await user.click(button);
  }
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect([...served.attach, ...served.enable, ...served.disable, ...served.documents]).toEqual([]);
});

test('a suspended installation still searches: reading is not changing', async () => {
  const { served, user } = await openRepositories(undefined, { tenants: SUSPENDED });
  await user.type(searchBox(), 'widgets{Enter}');
  await screen.findByText('2 repositories on this page');
  expect(served.list).toHaveLength(2);
});

test('an active installation shows no banner and the actions are on', async () => {
  await openRepositories();
  expect(screen.queryByText(messages['installation.suspended'])).toBeNull();
  for (const button of within(repositoriesTable()).getAllByRole('button')) {
    expect(button).toBeEnabled();
  }
});

test('a repo admin has the actions on the repositories they administer and none on the others', async () => {
  await openRepositories(undefined, {
    tenants: REPO_ADMIN,
    list: [pageOf([widgets({ canAdminister: false }), gadgets()])],
  });
  expect(within(rowOf('acme/widgets')).queryByRole('button')).toBeNull();
  expect(buttonsOf('acme/gadgets')).toEqual([
    messages['repositories.attach.label'].replace('{repository}', 'acme/gadgets'),
    messages['repositories.enable.label'].replace('{repository}', 'acme/gadgets'),
  ]);
});

test('an org admin has the actions on every repository of the page', async () => {
  await openRepositories();
  expect(buttonsOf('acme/widgets')).toHaveLength(2);
  expect(buttonsOf('acme/gadgets')).toHaveLength(2);
});

test('the page waits for the list of installations, which holds the suspended flag, and draws no row and no button before it', async () => {
  const gate = Promise.withResolvers<true>();
  serveRepositories({
    listing: async () => {
      await gate.promise;
      return json([summary({ suspended: true })]);
    },
  });
  renderRepositories(REPOSITORIES_ROUTE);
  expect(await screen.findByText(messages['states.loading'])).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('button', { name: /^(Enable|Disable)/ })).toBeNull();
  gate.resolve(true);
  await screen.findByRole('table', { name: messages['repositories.caption'] });
  expect(screen.getByText(messages['installation.suspended'])).toBeInTheDocument();
});

test('when the list of installations fails the screen still lists the repositories, and the server decides about every change', async () => {
  serveRepositories({ listing: () => envelope(502, 'github_unavailable') });
  renderRepositories(REPOSITORIES_ROUTE);
  await screen.findByRole('table', { name: messages['repositories.caption'] });
  expect(screen.queryByText(messages['installation.suspended'])).toBeNull();
});

test('the suspended page passes axe', async () => {
  const { container } = await openRepositories(undefined, { tenants: SUSPENDED });
  await expectNoA11yViolations(container);
});
