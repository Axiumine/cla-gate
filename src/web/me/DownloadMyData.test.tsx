// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { dataExportSchema } from '../../shared/data-export.ts';
import { envelope, json } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectRateLimitedDownload, spyOnConsole, stubDownloads } from '../setup/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  EXPORTED_EMAIL,
  exportDocument,
  item,
  openList,
  serveExport,
  serveHeldExport,
  serveOnePage,
} from './test-support.ts';

// E18-S03: "Download my data" asks GET /api/me/export from the same origin and hands the document to the browser as a file.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const download = () => screen.getByRole('button', { name: messages['me.download.button'] });

/** The page, with the export served and the browser's download stubbed. */
async function openWithExport(...responses: Response[]) {
  const downloads = stubDownloads();
  serveOnePage(item());
  const exported = serveExport(...(responses.length === 0 ? [json(exportDocument())] : responses));
  const opened = await openList();
  return { ...opened, downloads, exported };
}

test('it asks for GET /api/me/export with no query, no body and no id, and nothing before the button is pressed', async () => {
  const { user, exported } = await openWithExport();
  expect(exported).toHaveLength(0);
  await user.click(download());
  await waitFor(() => {
    expect(exported).toHaveLength(1);
  });
  const url = new URL(exported[0]?.url ?? '');
  expect(url.pathname).toBe('/api/me/export');
  expect(url.search).toBe('');
  expect(exported[0]?.method).toBe('GET');
  expect(exported[0]?.text).toBe('');
});

test('the document is saved as a JSON file named after the numeric GitHub id, and it is the document the server sent', async () => {
  const { user, downloads } = await openWithExport();
  await user.click(download());
  expect(await screen.findByText('Your data was saved as cla-data-4711.json.')).toBeInTheDocument();
  expect(downloads.saved()).toEqual([{ name: 'cla-data-4711.json', address: 'blob:made-up-address' }]);
  const blob = downloads.create.mock.calls[0]?.[0];
  expect(blob?.type).toBe('application/json');
  expect(dataExportSchema.parse(JSON.parse((await blob?.text()) ?? ''))).toEqual(exportDocument());
});

test('the result is announced in a polite live region that is in the page before the text', async () => {
  const { user } = await openWithExport();
  const region = within(download().parentElement ?? document.body).getByRole('status');
  expect(region).toHaveTextContent('');
  expect(region).toHaveAttribute('aria-live', 'polite');
  await user.click(download());
  await screen.findByText('Your data was saved as cla-data-4711.json.');
  expect(region).toHaveTextContent('Your data was saved as cla-data-4711.json.');
});

test('a double click and the Enter key repeating send one request, and the button is busy meanwhile', async () => {
  const { user } = await openWithExport();
  const held = serveHeldExport();
  await user.dblClick(download());
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(download()).toHaveAttribute('aria-busy', 'true');
  });
  held.release(json(exportDocument()));
  await screen.findByText('Your data was saved as cla-data-4711.json.');
  expect(held.received).toHaveLength(1);
  expect(download()).not.toHaveAttribute('aria-busy');
});

test('the keyboard works the button: Enter and Space each ask once', async () => {
  const { user, exported } = await openWithExport();
  download().focus();
  await user.keyboard('{Enter}');
  await screen.findByText('Your data was saved as cla-data-4711.json.');
  await user.keyboard(' ');
  await waitFor(() => {
    expect(exported).toHaveLength(2);
  });
});

test('the personal data of the document is not kept: not in the page, the query cache, the mutation cache or the console', async () => {
  const logged = spyOnConsole();
  const { user, queryClient, container } = await openWithExport();
  await user.click(download());
  await screen.findByText('Your data was saved as cla-data-4711.json.');
  const kept = JSON.stringify([
    queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data),
    queryClient
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.state.data),
    logged(),
  ]);
  expect(EXPORTED_EMAIL).toContain('zzzz');
  expect(kept).not.toContain('zzzz');
  expect(container.textContent).not.toContain('zzzz');
});

test('a 429 shows the error state with the countdown, and "Try again" works again when it reaches zero', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  const { user, exported, downloads } = await openWithExport(
    envelope(429, 'too_many_requests', { 'retry-after': '3' }),
    json(exportDocument()),
  );
  await user.click(download());
  await expectRateLimitedDownload(downloads);
  const retry = screen.getByRole('button', { name: messages['states.retry'] });
  expect(retry).toBeDisabled();
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  expect(retry).toBeEnabled();
  await user.click(retry);
  expect(await screen.findByText('Your data was saved as cla-data-4711.json.')).toBeInTheDocument();
  expect(exported).toHaveLength(2);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(downloads.saved()).toHaveLength(1);
});

test('any other failure shows the error state with the request ID and nothing is saved', async () => {
  const { user, downloads, container } = await openWithExport(envelope(500, 'internal_server_error'));
  await user.click(download());
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.internal_server_error']);
  expect(alert).toHaveTextContent('req-00000001');
  expect(screen.getByRole('button', { name: messages['states.retry'] })).toBeEnabled();
  expect(downloads.saved()).toEqual([]);
  await expectNoA11yViolations(container);
});

test('a document the contract does not know is an error, and nothing is saved', async () => {
  const { user, downloads } = await openWithExport(json({ schemaVersion: 2 }));
  await user.click(download());
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.contract']);
  expect(downloads.saved()).toEqual([]);
});
