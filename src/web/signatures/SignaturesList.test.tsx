// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  EMAIL,
  erasedOf,
  graceOf,
  heading,
  notFound,
  openSignatures,
  pageOf,
  paramsOf,
  pathOf,
  renderSignatures,
  revokedOf,
  rowsOf,
  SIGNATURES_ROUTE,
  serveSignatures,
  signatureOf,
  signaturesTable,
} from './test-support.ts';

// E18-S07: the list of the signatures of a tenant: the columns, the signer cell, the erased signer, the states of the page and the
// request that is sent for it.

test('the page has one h1, the account in the title of the tab, and the link of the tenant navigation that opens it', async () => {
  await openSignatures();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(document.title).toBe(`${messages['signatures.title']}: acme · CLA`);
  const nav = screen.getByRole('navigation', { name: messages['tenant.nav.label'] });
  expect(within(nav).getByRole('link', { name: messages['tenant.nav.signatures'] })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('the request is the search of the installation in the address with a page of 50 and no filter', async () => {
  const { served } = await openSignatures();
  expect(served.search).toHaveLength(1);
  expect(pathOf(served.search[0])).toBe('/api/installations/5/signatures');
  expect(served.search[0]?.method).toBe('GET');
  expect(paramsOf(served.search[0])).toEqual({ limit: '50' });
});

test('the columns are the signer, the GitHub id, the document, the version, the time in UTC, the source and the status, then the actions', async () => {
  await openSignatures();
  const headings = within(signaturesTable()).getAllByRole('columnheader');
  expect(headings.map((cell) => cell.textContent)).toEqual([
    messages['signatures.col.signer'],
    messages['signatures.col.githubId'],
    messages['signatures.col.document'],
    messages['signatures.col.version'],
    messages['signatures.col.signed'],
    messages['signatures.col.source'],
    messages['signatures.col.status'],
    messages['signatures.col.actions'],
  ]);
});

test('a row shows the typed name and the login, the id in code, the document, the version, the UTC time, the repository with the pull request and the status', async () => {
  await openSignatures();
  const [ada, grace] = rowsOf(signaturesTable());
  expect(ada).toEqual([
    'Ada Lovelaceoctocat',
    '4711',
    'Individual CLA',
    '2.1',
    '2026-11-02 09:30 UTC',
    `acme/widgetsPR #45`,
    messages['status.active'],
    `${messages['signatures.details']}${messages['signatures.revoke']}`,
  ]);
  expect(grace?.slice(0, 7)).toEqual([
    'Grace Hopperdefunkt',
    '583231',
    'Widgets CLA',
    '2.1',
    '2026-11-01 08:00 UTC',
    'acme/gadgets',
    messages['status.active'],
  ]);
  const idCell = within(signaturesTable()).getByText('4711');
  expect(idCell.tagName).toBe('CODE');
});

test('the status badge says Active, Outdated or Revoked from the state', async () => {
  await openSignatures(SIGNATURES_ROUTE, {
    search: [pageOf([signatureOf(), graceOf({ state: 'outdated' }), revokedOf({ id: 905 })])],
  });
  expect(rowsOf(signaturesTable()).map((cells) => cells[6])).toEqual([
    messages['status.active'],
    messages['status.outdated'],
    messages['status.revoked'],
  ]);
});

test('a signature with no recorded source says so, and one signed from the dashboard has no pull request', async () => {
  await openSignatures(SIGNATURES_ROUTE, {
    search: [
      pageOf([
        signatureOf({ source: null }),
        graceOf({ source: { repositoryFullName: 'acme/gadgets', prNumber: null } }),
      ]),
    ],
  });
  const cells = rowsOf(signaturesTable()).map((row) => row[5]);
  expect(cells).toEqual([messages['signatures.source.none'], 'acme/gadgets']);
});

test('the verified email is not in the table, and not anywhere on the page until the details of a row are opened', async () => {
  const { user } = await openSignatures();
  const table = signaturesTable();
  expect(screen.getByRole('main').textContent).not.toContain(EMAIL);
  await user.click(screen.getByRole('button', { name: 'Details of the signature of Ada Lovelace' }));
  const detail = await screen.findByRole('dialog', { name: `${messages['signatures.details.title']} Ada Lovelace` });
  expect(within(detail).getByText(EMAIL)).toBeInTheDocument();
  expect(within(table).queryByText(EMAIL)).toBeNull();
});

test('once the personal data is erased the signer cell says Erased and the id stays in its own column; the details name the user by the id', async () => {
  const { user } = await openSignatures(SIGNATURES_ROUTE, { search: [pageOf([erasedOf()])] });
  const [row] = rowsOf(signaturesTable());
  expect(row?.slice(0, 2)).toEqual([messages['signatures.signer.erased'], '9001']);
  await user.click(screen.getByRole('button', { name: 'Details of the signature of GitHub user 9001' }));
  const detail = await screen.findByRole('dialog', {
    name: `${messages['signatures.details.title']} GitHub user 9001`,
  });
  expect(within(detail).getAllByText(messages['signatures.signer.erased'])).toHaveLength(3);
  expect(within(detail).getByText('9001').tagName).toBe('CODE');
});

test('the details of a revoked signature say when it was revoked, by whom (the numeric id) and why, in the words of the catalog', async () => {
  const { user } = await openSignatures(SIGNATURES_ROUTE, { search: [pageOf([revokedOf()])] });
  await user.click(screen.getByRole('button', { name: 'Details of the signature of Ada Lovelace' }));
  const detail = await screen.findByRole('dialog');
  expect(within(detail).getByText('2026-11-03 08:15 UTC')).toBeInTheDocument();
  expect(within(detail).getByText('4712').tagName).toBe('CODE');
  expect(within(detail).getByText(messages['signatures.revoke.reason.legal_request'])).toBeInTheDocument();
});

test('the details of an active signature have no revocation facts, and Escape closes them and returns focus to the button', async () => {
  const { user } = await openSignatures();
  const button = screen.getByRole('button', { name: 'Details of the signature of Ada Lovelace' });
  await user.click(button);
  const detail = await screen.findByRole('dialog');
  expect(within(detail).queryByText(messages['signatures.details.revokedBy'])).toBeNull();
  expect(within(detail).getByText('Individual CLA')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(button).toHaveFocus();
});

test('the number of signatures on the page is said in a polite live region', async () => {
  await openSignatures();
  const region = screen.getByText('2 signatures on this page');
  expect(region.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
});

test('a page with one signature says one signature, and with no total anywhere', async () => {
  await openSignatures(SIGNATURES_ROUTE, { search: [pageOf([signatureOf()], 'c2')] });
  expect(screen.getByText('1 signature on this page')).toBeInTheDocument();
  expect(screen.queryByText(/of \d+/)).toBeNull();
  expect(screen.queryByText(/total/i)).toBeNull();
});

test('a tenant with no signatures shows the empty state that says nobody has signed, and no pager', async () => {
  serveSignatures({ search: [pageOf([])] });
  renderSignatures(SIGNATURES_ROUTE);
  expect(
    await screen.findByRole('heading', { level: 3, name: messages['signatures.empty.title'] }),
  ).toBeInTheDocument();
  expect(screen.getByText(messages['signatures.empty.none'])).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('navigation', { name: messages['pager.label'] })).toBeNull();
  expect(screen.getByText('0 signatures on this page')).toBeInTheDocument();
});

test('a repo admin whose search was cut short is told so, and told what to do', async () => {
  await openSignatures(SIGNATURES_ROUTE, { search: [pageOf([signatureOf()], null, true)] });
  expect(screen.getByText(messages['signatures.truncated'])).toBeInTheDocument();
});

test('a search that was not cut short says nothing of it', async () => {
  await openSignatures();
  expect(screen.queryByText(messages['signatures.truncated'])).toBeNull();
});

test.each([
  ['403', 403, 'forbidden', messages['errors.forbidden']],
  ['502', 502, 'github_unavailable', messages['errors.github_unavailable']],
  ['429', 429, 'too_many_requests', messages['errors.too_many_requests']],
])('%s on the first load is the error state with no row', async (_what, status, code, text) => {
  serveSignatures({ search: [envelope(status, code, { 'retry-after': '30' })] });
  renderSignatures(SIGNATURES_ROUTE);
  expect(await screen.findByRole('alert')).toHaveTextContent(text);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
});

test('404 for an installation the person cannot open is the not-found state and no row', async () => {
  serveSignatures({ search: [notFound()] });
  renderSignatures(SIGNATURES_ROUTE);
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.not_found']);
  expect(screen.queryByRole('table')).toBeNull();
  await heading(messages['signatures.title']);
});

test('the list is asked for again on a visit and its answer is the rows on screen: a signature revoked meanwhile is Revoked', async () => {
  const { served } = await openSignatures(SIGNATURES_ROUTE, {
    search: [pageOf([signatureOf()]), pageOf([revokedOf({ id: 900 })])],
  });
  expect(served.search).toHaveLength(1);
  expect(rowsOf(signaturesTable())[0]?.[6]).toBe(messages['status.active']);
});

test('axe passes on the table with its filters, the search box and the live regions', async () => {
  await openSignatures();
  await expectNoA11yViolations(document.body);
});
