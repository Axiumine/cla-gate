// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  globex,
  heading,
  installationsTable,
  META_WITH_APP,
  renderInstallations,
  rowStartingWith,
  serveTenants,
  summary,
  tenantOf,
} from './test-support.ts';

// E18-S04: the list of installations the person administers, from GET /api/installations.

const ACME = summary();
const SUSPENDED = globex({ accountType: 'User', suspended: true, truncated: false });
const OTHER = summary({ id: 7, accountLogin: 'initech', accountType: 'Other', repositoryCount: 0, enabledCount: 0 });

const serveThree = () => serveTenants([tenantOf(ACME), tenantOf(SUSPENDED), tenantOf(OTHER)]);

test('it asks for the list once, with no query at all, and shows the one h1 of the page', async () => {
  const served = serveThree();
  renderInstallations('/installations');
  expect(await heading(messages['installations.title'])).toBeInTheDocument();
  await screen.findByRole('table');
  expect(served.list.map((seen) => [seen.method, new URL(seen.url).pathname, new URL(seen.url).search])).toEqual([
    ['GET', '/api/installations', ''],
  ]);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
});

test('the table has a caption and the five columns, and a row for each installation in the order the server gave', async () => {
  serveThree();
  renderInstallations('/installations');
  await screen.findByRole('table');
  const table = installationsTable();
  expect(table.querySelector('caption')).toHaveTextContent(messages['installations.caption']);
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual([
    messages['installations.col.account'],
    messages['installations.col.type'],
    messages['installations.col.repositories'],
    messages['installations.col.enabled'],
    messages['installations.col.role'],
  ]);
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual(['acme', 'globex', 'initech']);
});

test('a row shows the account as a link into the installation, its type, its counts and the role as a badge', async () => {
  serveThree();
  renderInstallations('/installations');
  await screen.findByRole('table');
  const [acme, globexRow, initech] = [rowStartingWith('acme'), rowStartingWith('globex'), rowStartingWith('initech')];
  expect(within(acme).getByRole('link', { name: 'acme' })).toHaveAttribute('href', '/installations/5');
  expect(within(globexRow).getByRole('link', { name: 'globex' })).toHaveAttribute('href', '/installations/6');
  expect(acme).toHaveTextContent(messages['installations.type.organization']);
  expect(globexRow).toHaveTextContent(messages['installations.type.user']);
  expect(initech).toHaveTextContent(messages['installations.type.other']);
  const cells = within(acme).getAllByRole('cell');
  expect([cells[2]?.textContent, cells[3]?.textContent]).toEqual(['12', '3']);
  expect(within(acme).getByText(messages['status.org_admin'])).toBeInTheDocument();
  expect(within(globexRow).getByText(messages['status.repo_admin'])).toBeInTheDocument();
});

test('a suspended installation carries a Suspended badge and the others carry none', async () => {
  serveThree();
  renderInstallations('/installations');
  await screen.findByRole('table');
  expect(within(rowStartingWith('globex')).getByText(messages['status.suspended'])).toBeInTheDocument();
  expect(within(rowStartingWith('acme')).queryByText(messages['status.suspended'])).toBeNull();
});

test('when the server says the roles may be incomplete, a notice says so; otherwise there is none', async () => {
  serveTenants([tenantOf(ACME), tenantOf(globex({ truncated: true }))]);
  const truncated = renderInstallations('/installations');
  expect(await screen.findByText(messages['installation.truncated'])).toBeInTheDocument();
  truncated.unmount();
  serveThree();
  renderInstallations('/installations');
  await screen.findByRole('table');
  expect(screen.queryByText(messages['installation.truncated'])).toBeNull();
});

test('the list offers "Install on another organisation" when the instance names its App, and the link is GitHub\'s page', async () => {
  serveThree();
  renderInstallations('/installations', META_WITH_APP);
  const link = await screen.findByRole('link', { name: messages['installations.install'] });
  expect(link).toHaveAttribute('href', META_WITH_APP.installUrl);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('with no App to install there is no such link on the list', async () => {
  serveThree();
  renderInstallations('/installations');
  await screen.findByRole('table');
  expect(screen.queryByRole('link', { name: messages['installations.install'] })).toBeNull();
});

test('with exactly one installation the page goes straight into it, replacing its own entry in the history', async () => {
  serveTenants([tenantOf(ACME, 'acme/widgets')]);
  renderInstallations('/installations');
  const before = window.history.length;
  expect(await heading('acme')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/installations/5');
  expect(window.history).toHaveLength(before);
});

test('the list passes axe', async () => {
  serveThree();
  const { container } = renderInstallations('/installations', META_WITH_APP);
  await screen.findByRole('table');
  await expectNoA11yViolations(container);
});
