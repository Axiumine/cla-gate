// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { githubDown, repositoriesOf, repository, summary } from '../installations/test-support.ts';
import {
  OVERRIDES_ROUTE,
  openPending,
  PENDING_ROUTE,
  pendingTable,
  reasonFilter,
  renderPending,
  repositoryFilter,
  servePending,
} from './test-support.ts';

// E18-S08: the screen for an org admin, a repo admin and a person whose role the list of installations does not tell. The server decides
// on every request; the screen only offers what the role can reach.

/** A repo admin of installation 5 who administers `acme/gadgets` and not `acme/widgets`. */
const REPO_ADMIN = {
  summary: summary({ role: 'repo_admin' }),
  answer: () =>
    repositoriesOf([
      repository(1, 'acme/widgets', { canAdminister: false }),
      repository(2, 'acme/gadgets', { canAdminister: true }),
    ]),
};

const optionsOf = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map((option) => option.textContent);

test('the navigation of the tenant has the pending screen for an org admin and for a repo admin', async () => {
  await openPending();
  const nav = screen.getByRole('navigation', { name: messages['tenant.nav.label'] });
  expect(within(nav).getByRole('link', { name: messages['tenant.nav.pending'] })).toHaveAttribute(
    'href',
    '/installations/5/pending',
  );
  expect(within(nav).getByRole('link', { name: messages['tenant.nav.pending'] })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('a repo admin has the pending link too, and the repository filter lists the repositories they administer only', async () => {
  await openPending(PENDING_ROUTE, { tenants: [REPO_ADMIN] });
  const nav = screen.getByRole('navigation', { name: messages['tenant.nav.label'] });
  expect(within(nav).getByRole('link', { name: messages['tenant.nav.pending'] })).toBeInTheDocument();
  expect(optionsOf(repositoryFilter())).toEqual([messages['pending.filter.repository.all'], 'acme/gadgets']);
});

test('a repo admin chooses the repository of the overrides among those they administer only', async () => {
  servePending({ tenants: [REPO_ADMIN] });
  renderPending(OVERRIDES_ROUTE);
  await screen.findByRole('option', { name: 'acme/gadgets' });
  expect(optionsOf(screen.getByRole('combobox', { name: /^Repository/ }))).toEqual([
    messages['pending.overrides.repository.choose'],
    'acme/gadgets',
  ]);
});

test('a repo admin whose list of repositories holds the one in the address of the overrides sees its overrides, and not one they do not administer', async () => {
  const served = servePending({ tenants: [REPO_ADMIN] });
  renderPending(`${OVERRIDES_ROUTE}&repository=1`);
  expect(
    await screen.findByRole('heading', { level: 2, name: messages['pending.overrides.choose.title'] }),
  ).toBeInTheDocument();
  expect(served.overrides).toEqual([]);
});

test('an org admin has every repository in the filter, and the screen shows the whole list the server sends', async () => {
  await openPending();
  expect(optionsOf(repositoryFilter())).toEqual([
    messages['pending.filter.repository.all'],
    'acme/widgets',
    'acme/gadgets',
  ]);
  expect(within(pendingTable()).getAllByRole('row')).toHaveLength(3);
});

test('a person whose role the list of installations does not tell still gets the screen, with every repository the server lists, and the server decides', async () => {
  await openPending(PENDING_ROUTE, { tenants: [] });
  expect(optionsOf(repositoryFilter())).toEqual([messages['pending.filter.repository.all']]);
  expect(within(pendingTable()).getAllByRole('row')).toHaveLength(3);
});

test('a list of installations that cannot be read does not hide the pending list: the server decides what the person may see', async () => {
  await openPending(PENDING_ROUTE, { listing: githubDown });
  expect(within(pendingTable()).getAllByRole('row')).toHaveLength(3);
  expect(reasonFilter()).toBeInTheDocument();
});

test('while the list of installations is on its way the screen is loading, with no table and no request for pull requests', async () => {
  const served = servePending({ listing: () => new Promise<Response>(() => undefined) });
  renderPending(PENDING_ROUTE);
  expect(await screen.findByText(messages['states.loading'])).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(served.pending).toEqual([]);
});

test('a suspended installation says so in the banner and turns the write controls off, while the lists stay readable', async () => {
  await openPending(PENDING_ROUTE, {
    tenants: [{ summary: summary({ suspended: true }), answer: () => repositoriesOf([repository(1, 'acme/widgets')]) }],
  });
  expect(screen.getByText(messages['installation.suspended'])).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Record override/ })).toBeDisabled();
  expect(within(pendingTable()).getAllByRole('row').length).toBeGreaterThan(1);
});
