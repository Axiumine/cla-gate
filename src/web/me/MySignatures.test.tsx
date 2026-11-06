// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { serveSign } from '../sign/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  bodyRows,
  cellOf,
  item,
  openList,
  outdated,
  parametersOf,
  revoked,
  serveOnePage,
  signaturesTable,
} from './test-support.ts';

// E18-S03: the signed-in person's own signatures, from GET /api/me/signatures, as a semantic table.

test('it asks for the first page of 25 and for nothing else: the request names no person at all', async () => {
  const seen = serveOnePage(item());
  await openList();
  expect(seen).toHaveLength(1);
  const url = new URL(seen[0]?.url ?? '');
  expect(url.pathname).toBe('/api/me/signatures');
  expect(seen[0]?.method).toBe('GET');
  expect(seen.map(parametersOf)).toEqual([['limit']]);
  expect(url.searchParams.get('limit')).toBe('25');
  expect(seen[0]?.text).toBe('');
});

test.each([
  ['userId', '2'],
  ['githubId', '4712'],
  ['login', 'hubot'],
  ['email', 'hubot@example.org'],
])("a %s in the address of the page is not sent: one person cannot ask for another one's list", async (key, value) => {
  const seen = serveOnePage(item());
  await openList(`/me/signatures?${key}=${value}`);
  expect(seen.map(parametersOf)).toEqual([['limit']]);
  expect(seen[0]?.url).not.toContain(`${key}=`);
});

test('the page is the one h1 of the screen, and the table has a caption and a heading for each of its six columns', async () => {
  serveOnePage(item());
  await openList();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  const table = signaturesTable();
  expect(table.querySelector('caption')).toHaveTextContent(messages['me.signatures.caption']);
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((heading) => heading.textContent),
  ).toEqual([
    messages['me.signatures.col.document'],
    messages['me.signatures.col.organisation'],
    messages['me.signatures.col.version'],
    messages['me.signatures.col.signed'],
    messages['me.signatures.col.source'],
    messages['me.signatures.col.status'],
  ]);
});

test('an active signature shows the document, the account login, the version, the time in UTC, the source and the Active badge', async () => {
  serveOnePage(item());
  await openList();
  const cell = (column: Parameters<typeof cellOf>[1]) => cellOf('Individual CLA', column);
  const [document, organisation, version, signed, source, status] = [
    cell('document'),
    cell('organisation'),
    cell('version'),
    cell('signed'),
    cell('source'),
    cell('status'),
  ];
  expect(document).toHaveTextContent('Individual CLA');
  expect(organisation).toHaveTextContent('acme');
  expect(version).toHaveTextContent('2.1');
  const time = within(signed).getByText('2026-11-02 09:30 UTC');
  expect(time.tagName).toBe('TIME');
  expect(time).toHaveAttribute('datetime', '2026-11-02T09:30:00.000Z');
  expect(source).toHaveTextContent('acme/widgets');
  expect(source).toHaveTextContent('Pull request #45');
  expect(within(status).getByText(messages['status.active'])).toBeInTheDocument();
  expect(within(status).queryByRole('link')).toBeNull();
});

test('a suspended installation is marked with a Suspended badge on its own rows and on no other', async () => {
  serveOnePage(
    item({
      id: 1,
      document: { id: 7, name: 'Suspended CLA' },
      installation: { accountLogin: 'frozen', accountType: 'Organization', suspended: true },
    }),
    item({ id: 2, document: { id: 8, name: 'Working CLA' } }),
  );
  await openList();
  expect(within(cellOf('Suspended CLA', 'organisation')).getByText(messages['status.suspended'])).toBeInTheDocument();
  expect(within(cellOf('Working CLA', 'organisation')).queryByText(messages['status.suspended'])).toBeNull();
});

test('a signature made from the dashboard names the repository only, and one with no source says it is not recorded', async () => {
  serveOnePage(
    item({
      id: 1,
      document: { id: 7, name: 'Dashboard CLA' },
      source: { repositoryFullName: 'acme/gadgets', prNumber: null },
    }),
    item({ id: 2, document: { id: 8, name: 'Old CLA' }, source: null }),
  );
  await openList();
  const dashboard = cellOf('Dashboard CLA', 'source');
  expect(dashboard).toHaveTextContent('acme/gadgets');
  expect(dashboard).not.toHaveTextContent('Pull request');
  expect(cellOf('Old CLA', 'source')).toHaveTextContent(messages['me.signatures.source.none']);
});

test('a revoked signature shows the Revoked badge and the date of the revocation, and no reason for it', async () => {
  serveOnePage(revoked());
  await openList();
  const status = cellOf('Individual CLA', 'status');
  expect(within(status).getByText(messages['status.revoked'])).toBeInTheDocument();
  expect(status).toHaveTextContent(`${messages['me.signatures.revokedOn']} 2026-11-03 08:15 UTC`);
  expect(within(status).getByText('2026-11-03 08:15 UTC')).toHaveAttribute('datetime', '2026-11-03T08:15:00.000Z');
  expect(screen.queryByText(/reason/iu)).toBeNull();
});

test('an outdated signature shows the Outdated badge and says that a newer major version is required', async () => {
  serveOnePage(outdated());
  await openList();
  const status = cellOf('Individual CLA', 'status');
  expect(within(status).getByText(messages['status.outdated'])).toBeInTheDocument();
  expect(status).toHaveTextContent(messages['me.signatures.outdated']);
  expect(status).not.toHaveTextContent(messages['me.signatures.revokedOn']);
});

test('outdated and revoked rows link to the sign page of the item, and an active one has no link', async () => {
  serveOnePage(
    item({ id: 1, document: { id: 7, name: 'Active CLA' } }),
    outdated({ document: { id: 8, name: 'Outdated CLA' }, resignPath: '/sign/222' }),
    revoked({ document: { id: 9, name: 'Revoked CLA' }, resignPath: '/sign/333' }),
  );
  await openList();
  const link = (name: string) =>
    within(cellOf(name, 'status')).queryByRole('link', { name: messages['me.signatures.signAgain'] });
  expect(link('Active CLA')).toBeNull();
  expect(link('Outdated CLA')).toHaveAttribute('href', '/sign/222');
  expect(link('Revoked CLA')).toHaveAttribute('href', '/sign/333');
});

test.each([
  ['the server found no repository to sign from', null],
  ['the id is longer than the sign page takes', '/sign/99999999999999999999'],
])('an outdated row has no link when %s', async (_why, resignPath) => {
  serveOnePage(outdated({ resignPath }));
  await openList();
  expect(within(signaturesTable()).queryByRole('link')).toBeNull();
  expect(cellOf('Individual CLA', 'status')).toHaveTextContent(messages['status.outdated']);
});

test('"Sign again" opens the sign page of the repository without leaving the app', async () => {
  serveOnePage(outdated({ resignPath: '/sign/123' }));
  const calls = serveSign();
  const { user } = await openList();
  await user.click(screen.getByRole('link', { name: messages['me.signatures.signAgain'] }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Individual CLA' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/sign/123');
  expect(calls.context).toHaveLength(1);
});

test('rows come in the order the server sent them, newest first, one row for each signature', async () => {
  serveOnePage(
    item({ id: 3, document: { id: 3, name: 'Third' }, signedAt: '2026-11-03T09:00:00.000Z' }),
    item({ id: 2, document: { id: 2, name: 'Second' }, signedAt: '2026-11-02T09:00:00.000Z' }),
    item({ id: 1, document: { id: 1, name: 'First' }, signedAt: '2026-11-01T09:00:00.000Z' }),
  );
  await openList();
  expect(bodyRows().map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
    'Third',
    'Second',
    'First',
  ]);
});

test('the screen with an active, an outdated, a revoked and a suspended signature passes axe', async () => {
  serveOnePage(
    item(),
    outdated(),
    revoked(),
    item({ id: 4, installation: { accountLogin: 'frozen', accountType: 'User', suspended: true } }),
  );
  const { container } = await openList();
  await expectNoA11yViolations(container);
});

test('the keyboard reaches the link of a row and Enter follows it', async () => {
  serveOnePage(outdated({ resignPath: '/sign/123' }));
  serveSign();
  const { user } = await openList();
  const link = screen.getByRole('link', { name: messages['me.signatures.signAgain'] });
  link.focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('heading', { level: 1, name: 'Individual CLA' })).toBeInTheDocument();
});
