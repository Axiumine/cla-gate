// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  claOf,
  gadgets,
  heading,
  openRepositories,
  pageOf,
  paramsOf,
  pathOf,
  REPOSITORIES_ROUTE,
  repositoriesTable,
  rowOf,
  rowsOf,
  widgets,
} from './test-support.ts';

// E18-S10: the list of repositories of a tenant: the name, whether the check is on, the CLA each one enforces, and the actions only on the
// rows the viewer administers.

const next = () => screen.getByRole('button', { name: messages['pager.next'] });
const names = () => rowsOf(repositoriesTable()).map((cells) => cells[0]);

test('the page is the h1 Repositories, with one request for the installation in the address, and a caption on the table', async () => {
  const { served } = await openRepositories();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(await heading(messages['repositories.title'])).toBeInTheDocument();
  expect(served.list).toHaveLength(1);
  expect(pathOf(served.list[0])).toBe('/api/installations/5/repositories');
  expect(paramsOf(served.list[0])).toEqual({ limit: '50' });
  expect(repositoriesTable()).toHaveAccessibleName(messages['repositories.caption']);
});

test('each row has the full name, an Enabled or Disabled badge in words, and the document with its active version or that none is attached', async () => {
  await openRepositories();
  expect(rowsOf(repositoriesTable()).map((cells) => cells.slice(0, 3))).toEqual([
    ['acme/widgets', 'Enabled', 'Individual CLA1.0'],
    ['acme/gadgets', 'Disabled', messages['repositories.cla.none']],
  ]);
  expect(within(rowOf('acme/widgets')).getByText('Enabled')).toHaveAttribute('data-status', 'enabled');
  expect(within(rowOf('acme/gadgets')).getByText('Disabled')).toHaveAttribute('data-status', 'disabled');
});

test('a document with no published version is told as not published, and the minor version is shown as it is', async () => {
  await openRepositories(REPOSITORIES_ROUTE, {
    list: [
      pageOf([
        widgets({ document: claOf({ activeVersion: { major: 2, minor: 10 } }) }),
        gadgets({ document: claOf({ id: 12, name: 'Draft CLA', activeVersion: null }) }),
      ]),
    ],
  });
  expect(rowsOf(repositoriesTable()).map((cells) => cells[2])).toEqual([
    'Individual CLA2.10',
    `Draft CLA${messages['repositories.cla.unpublished']}`,
  ]);
});

test('the rows keep the order of the server, and the count of the page is announced in a polite region', async () => {
  await openRepositories(REPOSITORIES_ROUTE, {
    list: [pageOf([gadgets(), widgets(), widgets({ id: 3, fullName: 'acme/api' })])],
  });
  expect(names()).toEqual(['acme/gadgets', 'acme/widgets', 'acme/api']);
  expect(screen.getByText('3 repositories on this page')).toBeInTheDocument();
});

test('one repository is counted in the singular', async () => {
  await openRepositories(REPOSITORIES_ROUTE, { list: [pageOf([widgets()])] });
  expect(screen.getByText('1 repository on this page')).toBeInTheDocument();
});

test('the row actions are on the rows the viewer administers and on no other', async () => {
  await openRepositories(REPOSITORIES_ROUTE, {
    list: [pageOf([widgets(), gadgets({ canAdminister: false })])],
  });
  expect(within(rowOf('acme/widgets')).getAllByRole('button')).toHaveLength(2);
  expect(within(rowOf('acme/gadgets')).queryByRole('button')).toBeNull();
  expect(screen.getByRole('columnheader', { name: messages['repositories.col.actions'] })).toBeInTheDocument();
});

test('a page with no row the viewer administers has no actions column at all', async () => {
  await openRepositories(REPOSITORIES_ROUTE, {
    list: [pageOf([widgets({ canAdminister: false }), gadgets({ canAdminister: false })])],
  });
  expect(screen.queryByRole('columnheader', { name: messages['repositories.col.actions'] })).toBeNull();
  expect(screen.queryByRole('button', { name: /^(Enable|Disable|Attach|Change)/ })).toBeNull();
  expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
    messages['repositories.col.name'],
    messages['repositories.col.status'],
    messages['repositories.col.cla'],
  ]);
});

test('an enabled repository offers Disable and not Enable, and a disabled one the reverse; both offer the CLA dialog', async () => {
  await openRepositories();
  const names = (row: HTMLElement) =>
    within(row)
      .getAllByRole('button')
      .map((button) => button.textContent);
  expect(names(rowOf('acme/widgets'))).toEqual([
    messages['repositories.attach.change'],
    messages['repositories.disable'],
  ]);
  expect(names(rowOf('acme/gadgets'))).toEqual([messages['repositories.attach'], messages['repositories.enable']]);
});

test('a tenant with no repository shows the empty state and no table', async () => {
  await openRepositories(REPOSITORIES_ROUTE, { list: [pageOf([])] });
  expect(screen.getByRole('heading', { level: 3, name: messages['repositories.empty.title'] })).toBeInTheDocument();
  expect(screen.getByText(messages['repositories.empty.none'])).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});

test('the title of the tab names the screen and the account of the installation, and the navigation marks the screen as the current one', async () => {
  await openRepositories();
  await waitFor(() => {
    expect(document.title).toBe('Repositories: acme · CLA');
  });
  const nav = screen.getByRole('navigation', { name: messages['tenant.nav.label'] });
  expect(within(nav).getByRole('link', { name: messages['tenant.nav.repositories'] })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(within(nav).getByRole('link', { name: messages['tenant.nav.overview'] })).not.toHaveAttribute('aria-current');
});

test('the first page has no cursor; Next puts the cursor of the server in the address and asks for that page', async () => {
  const pages = [pageOf([widgets()], 'c2'), pageOf([gadgets()])];
  const { served, user } = await openRepositories(REPOSITORIES_ROUTE, { list: pages });
  expect(names()).toEqual(['acme/widgets']);
  await user.click(next());
  await waitFor(() => {
    expect(names()).toEqual(['acme/gadgets']);
  });
  expect(window.location.search).toBe('?cursor=c2');
  expect(paramsOf(served.list.at(-1))).toEqual({ limit: '50', cursor: 'c2' });
});

test('a reload on a later page asks for that page and for no other', async () => {
  const { served } = await openRepositories(`${REPOSITORIES_ROUTE}?cursor=c2`, { list: [pageOf([gadgets()])] });
  expect(served.list).toHaveLength(1);
  expect(paramsOf(served.list[0])).toEqual({ limit: '50', cursor: 'c2' });
  expect(names()).toEqual(['acme/gadgets']);
});

test('a cursor the server refuses is answered with the first page, and the address no longer holds it', async () => {
  const { served } = await openRepositories(`${REPOSITORIES_ROUTE}?enabled=true&cursor=forged`, {
    list: [envelope(400, 'bad_request'), pageOf([widgets()])],
  });
  expect(served.list.map((seen) => paramsOf(seen)['cursor'])).toEqual(['forged', undefined]);
  expect(window.location.search).toBe('?enabled=true');
  expect(names()).toEqual(['acme/widgets']);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a failed first load is the error state with no row, and Try again asks again', async () => {
  const { served, user } = await openRepositories(REPOSITORIES_ROUTE, {
    list: [envelope(502, 'github_unavailable'), pageOf([widgets()])],
  });
  expect(screen.getByRole('alert')).toHaveTextContent(messages['errors.github_unavailable']);
  expect(screen.queryByRole('table')).toBeNull();
  await user.click(screen.getByRole('button', { name: messages['states.retry'] }));
  await waitFor(() => {
    expect(names()).toEqual(['acme/widgets']);
  });
  expect(served.list).toHaveLength(2);
});

test('a 403 is the forbidden state with no row and no retry, and a 404 is the error state with no row', async () => {
  await openRepositories(REPOSITORIES_ROUTE, { list: [envelope(403, 'forbidden')] });
  expect(screen.getByRole('heading', { name: messages['states.forbidden.title'] })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: messages['states.retry'] })).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
});

test('the list passes axe', async () => {
  const { container } = await openRepositories();
  await expectNoA11yViolations(container);
});
