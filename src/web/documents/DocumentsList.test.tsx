// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { globex, summary, tenantOf } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { DOCUMENTS_PAGE } from './document-queries.ts';
import {
  heading,
  LIST_ROUTE,
  listedOf,
  listOf,
  renderDocuments,
  serveDocuments,
  unpublished,
  versionOf,
} from './test-support.ts';

// E18-S05: the documents of an installation at /installations/$installationId/documents: name, scope, kind, the active version
// with its time, and a "Draft saved" badge.

const REPOSITORY_DOC = listedOf({
  id: 12,
  name: 'Repository CLA',
  scope: 'repository',
  repositoryId: 7,
  repositoryFullName: 'acme/widgets',
  activeVersion: versionOf({ id: 305, major: 2, minor: 3, publishedAt: '2026-10-05T14:45:00.000Z' }),
  hasDraft: true,
});
const DRAFT_ONLY = unpublished({ id: 13, name: 'Brand new CLA', hasDraft: true });
const table = () => screen.getByRole('table', { name: messages['documents.caption'] });
const rowOf = (name: string) => within(table()).getByRole('row', { name: (label) => label.startsWith(name) });

test('it asks for the documents of the tenant in the address, one page of the most an installation holds, and for nothing else', async () => {
  const served = serveDocuments();
  renderDocuments(LIST_ROUTE);
  await screen.findByRole('table');
  expect(served.list.map((seen) => [seen.method, new URL(seen.url).pathname, new URL(seen.url).search])).toEqual([
    ['GET', '/api/installations/5/documents', `?limit=${String(DOCUMENTS_PAGE)}`],
  ]);
  expect(DOCUMENTS_PAGE).toBe(100);
});

test('the h1 is "CLA documents", the title of the tab names the account, and the navigation of the tenant marks the screen', async () => {
  serveDocuments();
  renderDocuments(LIST_ROUTE);
  expect(await heading(messages['documents.title'])).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(document.title).toContain(messages['documents.title']);
  const nav = screen.getByRole('navigation', { name: messages['tenant.nav.label'] });
  expect(within(nav).getByRole('link', { name: messages['tenant.nav.documents'] })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(within(nav).getByRole('link', { name: messages['tenant.nav.overview'] })).not.toHaveAttribute('aria-current');
});

test('a document of the whole installation shows its name as a link to the editor, its scope, its kind, its version and its time, and no badge', async () => {
  serveDocuments();
  renderDocuments(LIST_ROUTE);
  await screen.findByRole('table');
  const row = rowOf('Individual CLA');
  expect(within(row).getByRole('link', { name: 'Individual CLA' })).toHaveAttribute(
    'href',
    '/installations/5/documents/11',
  );
  expect(within(row).getByText(messages['documents.scope.installation'])).toBeInTheDocument();
  expect(within(row).getByText(messages['documents.kind.individual'])).toBeInTheDocument();
  expect(within(row).getByText('1.0')).toBeInTheDocument();
  expect(within(row).getByText('2026-10-01 09:30 UTC')).toBeInTheDocument();
  expect(within(row).queryByText(messages['documents.draftSaved'])).toBeNull();
});

test('a document of a repository shows the full name of the repository, its version number, and the "Draft saved" badge when a draft is saved', async () => {
  serveDocuments({ list: [listOf(listedOf(), REPOSITORY_DOC)] });
  renderDocuments(LIST_ROUTE);
  await screen.findByRole('table');
  const row = rowOf('Repository CLA');
  expect(within(row).getByText('acme/widgets')).toBeInTheDocument();
  expect(within(row).queryByText(messages['documents.scope.installation'])).toBeNull();
  expect(within(row).getByText('2.3')).toBeInTheDocument();
  expect(within(row).getByText(messages['documents.draftSaved'])).toBeInTheDocument();
  expect(within(rowOf('Individual CLA')).queryByText(messages['documents.draftSaved'])).toBeNull();
});

test('a document with no version says "Not published" and still shows its draft', async () => {
  serveDocuments({ list: [listOf(DRAFT_ONLY)] });
  renderDocuments(LIST_ROUTE);
  await screen.findByRole('table');
  const row = rowOf('Brand new CLA');
  expect(within(row).getByText(messages['documents.version.none'])).toBeInTheDocument();
  expect(within(row).getByText(messages['documents.draftSaved'])).toBeInTheDocument();
});

test('the table has a caption and one column header for each of the five facts', async () => {
  serveDocuments();
  renderDocuments(LIST_ROUTE);
  await screen.findByRole('table');
  expect(
    within(table())
      .getAllByRole('columnheader')
      .map((header) => header.textContent),
  ).toEqual([
    messages['documents.col.name'],
    messages['documents.col.scope'],
    messages['documents.col.kind'],
    messages['documents.col.version'],
    messages['documents.col.draft'],
  ]);
});

test('an installation with no document shows the empty state, which says that no legal text is provided, and no table', async () => {
  serveDocuments({ list: [listOf()] });
  renderDocuments(LIST_ROUTE);
  expect(await screen.findByRole('heading', { level: 2, name: messages['documents.empty.title'] })).toBeInTheDocument();
  expect(screen.getByText(messages['documents.empty.description'])).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByRole('button', { name: messages['documents.new'] })).toBeEnabled();
});

test('a suspended installation can be read and not changed: "New document" is off', async () => {
  serveDocuments({ tenants: [tenantOf(summary({ suspended: true }), 'acme/widgets')] });
  renderDocuments(LIST_ROUTE);
  await screen.findByRole('table');
  expect(screen.getByRole('button', { name: messages['documents.new'] })).toBeDisabled();
});

test('the server\'s 403 (a repo admin cannot list the documents of the installation) is the forbidden state, with no document and no "New document"', async () => {
  serveDocuments({ tenants: [tenantOf(globex(), 'globex/api')], list: [envelope(403, 'forbidden')] });
  renderDocuments('/installations/6/documents');
  expect(await heading(messages['states.forbidden.title'])).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(messages['errors.forbidden']);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('button', { name: messages['documents.new'] })).toBeNull();
});

test('the uniform 404 is the error state and not an empty list', async () => {
  serveDocuments({ list: [envelope(404, 'not_found')] });
  renderDocuments(LIST_ROUTE);
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.not_found']);
  expect(screen.queryByRole('heading', { name: messages['documents.empty.title'] })).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
});

test('a server that cannot be reached is the error state and not an empty list', async () => {
  serveDocuments({ list: [] });
  renderDocuments(LIST_ROUTE);
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.network']);
  expect(screen.queryByRole('heading', { name: messages['documents.empty.title'] })).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
});

test('"Try again" after a failure asks again and the list replaces the error', async () => {
  serveDocuments({ list: [envelope(502, 'github_unavailable'), listOf(listedOf())] });
  const { user } = renderDocuments(LIST_ROUTE);
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: messages['states.retry'] }));
  expect(await screen.findByRole('table')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('the list, with a draft badge and an unpublished document, passes axe', async () => {
  serveDocuments({ list: [listOf(listedOf(), REPOSITORY_DOC, DRAFT_ONLY)] });
  const { container } = renderDocuments(LIST_ROUTE);
  await screen.findByRole('table');
  await expectNoA11yViolations(container);
});

test('the navigation of the tenant has the documents for an org admin, and a repo admin has the overview and the allowlist only', async () => {
  serveDocuments({ tenants: [tenantOf(globex(), 'globex/api')] });
  renderDocuments('/installations/6');
  await screen.findByRole('heading', { level: 1, name: 'globex' });
  const nav = screen.getByRole('navigation', { name: messages['tenant.nav.label'] });
  expect(
    within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual([messages['tenant.nav.overview'], messages['tenant.nav.allowlist']]);
});

test('the navigation takes an org admin from the overview to the documents', async () => {
  serveDocuments();
  const { user } = renderDocuments('/installations/5');
  await screen.findByRole('heading', { level: 1, name: 'acme' });
  const nav = screen.getByRole('navigation', { name: messages['tenant.nav.label'] });
  await user.click(await within(nav).findByRole('link', { name: messages['tenant.nav.documents'] }));
  expect(await screen.findByRole('table')).toBeInTheDocument();
  expect(await heading(messages['documents.title'])).toBeInTheDocument();
});
