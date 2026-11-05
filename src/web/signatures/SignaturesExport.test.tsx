// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { spyOnConsole, stubDownloads } from '../setup/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  csvFile,
  documentSelect,
  exportLink,
  openSignatures,
  paramsOf,
  pathOf,
  SIGNATURES_ROUTE,
  stateSelect,
} from './test-support.ts';

// E18-S07: "Export CSV" is per document, a real link to the file of E16-S03 that carries the status and nothing else; a click is the
// same-origin GET whose answer goes to the browser as it is, and a refusal is shown on the page.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const CSV = '/api/installations/5/documents/11/signatures.csv';

test('the link points at the export of the document with the active status, and carries exactly those two things', async () => {
  await openSignatures(`${SIGNATURES_ROUTE}?document=11&state=revoked&q=octocat`);
  expect(exportLink().getAttribute('href')).toBe(`${CSV}?state=revoked`);
});

test('with no status chosen the link asks for all, the one default of the export', async () => {
  await openSignatures(`${SIGNATURES_ROUTE}?document=11`);
  expect(exportLink().getAttribute('href')).toBe(`${CSV}?state=all`);
});

test('the link is made for the installation in the address and the document in the filter, not for another one', async () => {
  await openSignatures(`${SIGNATURES_ROUTE}?document=12&state=active`);
  expect(exportLink().getAttribute('href')).toBe('/api/installations/5/documents/12/signatures.csv?state=active');
});

test('with no document chosen the button is off, there is no link, and it says what is needed', async () => {
  await openSignatures();
  const button = screen.getByRole('button', { name: messages['signatures.export'] });
  expect(button).toBeDisabled();
  expect(button).toHaveAccessibleDescription(messages['signatures.export.choose']);
  expect(screen.queryByRole('link', { name: messages['signatures.export'] })).toBeNull();
});

test('choosing a document turns the button into the link, and the status chosen after it changes the link', async () => {
  const { user } = await openSignatures();
  await user.selectOptions(documentSelect(), 'Individual CLA');
  await waitFor(() => {
    expect(exportLink().getAttribute('href')).toBe(`${CSV}?state=all`);
  });
  await user.selectOptions(stateSelect(), 'outdated');
  await waitFor(() => {
    expect(exportLink().getAttribute('href')).toBe(`${CSV}?state=outdated`);
  });
  await user.selectOptions(documentSelect(), '');
  await waitFor(() => {
    expect(screen.getByRole('button', { name: messages['signatures.export'] })).toBeDisabled();
  });
});

test('a notice says that the file holds personal data, and the help says that the search is not part of it', async () => {
  await openSignatures(`${SIGNATURES_ROUTE}?document=11`);
  expect(screen.getByText(messages['signatures.export.notice'])).toBeInTheDocument();
  expect(screen.getByText(messages['signatures.export.help'])).toBeInTheDocument();
  expect(messages['signatures.export.notice']).toMatch(/personal data/i);
});

test('a click is one same-origin GET of that address with the cookie, and the page never builds the file', async () => {
  const downloads = stubDownloads();
  const { served, user } = await openSignatures(`${SIGNATURES_ROUTE}?document=11&state=revoked`);
  await user.click(exportLink());
  expect(await screen.findByText('Saved as signatures-11-2026-11-04.csv.')).toBeInTheDocument();
  expect(served.csv).toHaveLength(1);
  expect(served.csv[0]?.method).toBe('GET');
  expect(pathOf(served.csv[0])).toBe(CSV);
  expect(paramsOf(served.csv[0])).toEqual({ state: 'revoked' });
  expect(served.csv[0]?.text).toBe('');
  expect(downloads.saved()).toEqual([{ name: 'signatures-11-2026-11-04.csv', address: 'blob:made-up-address' }]);
  const blob = downloads.create.mock.calls[0]?.[0];
  expect(blob?.type).toMatch(/^text\/csv/);
  expect(await blob?.text()).toBe('signature_id,github_user_id\r\n900,4711\r\n');
});

test('a click does not follow the link: the page stays where it was', async () => {
  stubDownloads();
  const { user } = await openSignatures(`${SIGNATURES_ROUTE}?document=11`);
  await user.click(exportLink());
  await screen.findByText('Saved as signatures-11-2026-11-04.csv.');
  expect(window.location.pathname).toBe(SIGNATURES_ROUTE);
  expect(window.location.search).toBe('?document=11');
});

test.each([
  ['the header the server does not write', 'attachment; filename="../../etc/passwd"'],
  ['another document than the numbers give', 'attachment; filename="signatures-x-2026-11-04.csv"'],
  ['a name that is not a CSV file', 'attachment; filename="signatures-11-2026-11-04.exe"'],
  ['an inline file', 'inline; filename="signatures-11-2026-11-04.csv"'],
])('%s is not a name to save under: the file is named after the document', async (_what, disposition) => {
  const downloads = stubDownloads();
  const { user } = await openSignatures(`${SIGNATURES_ROUTE}?document=11`, {
    csv: [new Response('a\r\n', { headers: { 'content-type': 'text/csv', 'content-disposition': disposition } })],
  });
  await user.click(exportLink());
  expect(await screen.findByText('Saved as signatures-11.csv.')).toBeInTheDocument();
  expect(downloads.saved()).toEqual([{ name: 'signatures-11.csv', address: 'blob:made-up-address' }]);
});

test('an answer with no name at all is saved under the name made from the document', async () => {
  const downloads = stubDownloads();
  const { user } = await openSignatures(`${SIGNATURES_ROUTE}?document=12`, {
    csv: [new Response('a\r\n', { headers: { 'content-type': 'text/csv' } })],
  });
  await user.click(exportLink());
  expect(await screen.findByText('Saved as signatures-12.csv.')).toBeInTheDocument();
  expect(downloads.saved()).toEqual([{ name: 'signatures-12.csv', address: 'blob:made-up-address' }]);
});

test('a 429 shows the error state with the countdown, nothing is saved, and "Try again" works when it reaches zero', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  const downloads = stubDownloads();
  const { served, user } = await openSignatures(`${SIGNATURES_ROUTE}?document=11`, {
    csv: [envelope(429, 'too_many_requests', { 'retry-after': '3' }), csvFile()],
  });
  await user.click(exportLink());
  expect(await screen.findByText('You can try again in 3 seconds.')).toBeInTheDocument();
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.too_many_requests']);
  expect(alert).toHaveTextContent('req-00000001');
  expect(downloads.saved()).toEqual([]);
  const retry = within(alert).getByRole('button', { name: messages['states.retry'] });
  expect(retry).toBeDisabled();
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  expect(retry).toBeEnabled();
  await user.click(retry);
  expect(await screen.findByText('Saved as signatures-11-2026-11-04.csv.')).toBeInTheDocument();
  expect(served.csv).toHaveLength(2);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(downloads.saved()).toHaveLength(1);
});

test('a 403 is the forbidden state next to the link, nothing is saved, and the list stays', async () => {
  const downloads = stubDownloads();
  const { user } = await openSignatures(`${SIGNATURES_ROUTE}?document=11`, {
    csv: [envelope(403, 'forbidden')],
  });
  await user.click(exportLink());
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.forbidden']);
  expect(downloads.saved()).toEqual([]);
  expect(screen.getByRole('table', { name: messages['signatures.caption'] })).toBeInTheDocument();
});

test('a 500 with no body is an error state too, and nothing is saved', async () => {
  spyOnConsole();
  const downloads = stubDownloads();
  const { user } = await openSignatures(`${SIGNATURES_ROUTE}?document=11`, {
    csv: [new Response(null, { status: 500 })],
  });
  await user.click(exportLink());
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(downloads.saved()).toEqual([]);
});

test('a new choice of status takes away what the last attempt left, and its link is the new one', async () => {
  stubDownloads();
  const { user } = await openSignatures(`${SIGNATURES_ROUTE}?document=11`, {
    csv: [envelope(403, 'forbidden')],
  });
  await user.click(exportLink());
  await screen.findByRole('alert');
  await user.selectOptions(stateSelect(), 'active');
  await waitFor(() => {
    expect(exportLink().getAttribute('href')).toBe(`${CSV}?state=active`);
  });
  expect(screen.queryByRole('alert')).toBeNull();
});

test('axe passes on the export with a document chosen, with a refusal shown, and with none chosen', async () => {
  stubDownloads();
  const { user, container } = await openSignatures(SIGNATURES_ROUTE, {
    csv: [envelope(403, 'forbidden')],
  });
  await expectNoA11yViolations(container);
  await user.selectOptions(documentSelect(), 'Individual CLA');
  await user.click(await screen.findByRole('link', { name: messages['signatures.export'] }));
  await screen.findByRole('alert');
  await expectNoA11yViolations(container);
});
