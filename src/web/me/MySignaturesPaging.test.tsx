// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { nextButton, previousButton } from '../test-support/pager-buttons.ts';
import {
  cursorOf,
  type Item,
  item,
  openList,
  pageOf,
  parametersOf,
  refusedCursor,
  serveSignatures,
  signaturesTable,
} from './test-support.ts';

// E18-S03: newest first, 25 to a page, the page of the list is the `cursor` of the address, so reload and Back work; a cursor
// that is no cursor is answered with the first page.

const named = (id: number, name: string): Item => item({ id, document: { id, name } });
const FIRST = named(3, 'Page one CLA');
const SECOND = named(2, 'Page two CLA');
const THIRD = named(1, 'Page three CLA');

/** Three pages: the first leads to `c2`, which leads to `c3`, the last. */
function serveThreePages() {
  return serveSignatures([
    [null, () => pageOf([FIRST], 'c2')],
    ['c2', () => pageOf([SECOND], 'c3')],
    ['c3', () => pageOf([THIRD])],
  ]);
}

const shows = (name: string) => within(signaturesTable()).getByText(name);

test('the first page has no cursor, Next puts the cursor of the server in the address and asks for that page', async () => {
  const seen = serveThreePages();
  const { user } = await openList();
  expect(seen.map(cursorOf)[0]).toBeNull();
  expect(previousButton()).toBeDisabled();
  await user.click(nextButton());
  expect(await screen.findByText('Page two CLA')).toBeInTheDocument();
  expect(window.location.search).toBe('?cursor=c2');
  expect(seen.map(cursorOf).at(-1)).toBe('c2');
  expect(seen.map(parametersOf).at(-1)).toEqual(['limit', 'cursor']);
  expect(screen.getByText('Page 2')).toBeInTheDocument();
});

test('the pager announces the page that arrived, and the last page has no Next', async () => {
  serveThreePages();
  const { user } = await openList();
  await user.click(nextButton());
  await screen.findByText('Page two CLA');
  await user.click(nextButton());
  await screen.findByText('Page three CLA');
  expect(screen.getByText('Page 3')).toBeInTheDocument();
  await waitFor(() => {
    expect(nextButton()).toBeDisabled();
  });
  expect(previousButton()).toBeEnabled();
});

test('Previous goes back through the pages, and so does the Back button of the browser', async () => {
  serveThreePages();
  const { user } = await openList();
  await user.click(nextButton());
  await screen.findByText('Page two CLA');
  await user.click(nextButton());
  await screen.findByText('Page three CLA');
  act(() => {
    window.history.back();
  });
  expect(await screen.findByText('Page two CLA')).toBeInTheDocument();
  expect(window.location.search).toBe('?cursor=c2');
  await waitFor(() => {
    expect(previousButton()).toBeEnabled();
  });
  await user.click(previousButton());
  expect(await screen.findByText('Page one CLA')).toBeInTheDocument();
  expect(window.location.search).toBe('');
});

test('a reload on a later page asks for that page and for no other', async () => {
  const seen = serveThreePages();
  await openList('/me/signatures?cursor=c2');
  expect(seen).toHaveLength(1);
  expect(seen.map(cursorOf)[0]).toBe('c2');
  expect(shows('Page two CLA')).toBeInTheDocument();
  expect(screen.getByText(messages['pager.later'])).toBeInTheDocument();
});

test.each([
  ['an empty value', ''],
  ['a number', '123'],
  ['a list', '%5B%22a%22%5D'],
  ['a text of 1025 characters', 'a'.repeat(1025)],
])('a cursor in the address that is %s is dropped, and the first page is asked for', async (_what, value) => {
  const seen = serveThreePages();
  await openList(`/me/signatures?cursor=${value}`);
  expect(seen).toHaveLength(1);
  expect(seen.map(cursorOf)[0]).toBeNull();
  expect(shows('Page one CLA')).toBeInTheDocument();
});

/** A server whose first page leads to `c2` and which refuses the cursor `forged`. */
const serveForgedCursor = () =>
  serveSignatures([
    [null, () => pageOf([FIRST], 'c2')],
    ['forged', refusedCursor],
  ]);

test('a cursor the server refuses is answered with the first page, and the address no longer holds it', async () => {
  const seen = serveForgedCursor();
  await openList('/me/signatures?cursor=forged');
  expect(seen.map(cursorOf)).toEqual(['forged', null]);
  expect(window.location.search).toBe('');
  expect(shows('Page one CLA')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('the refused cursor is replaced in the history, so Back does not return to it', async () => {
  serveForgedCursor();
  const before = window.history.length;
  await openList('/me/signatures?cursor=forged');
  expect(window.history).toHaveLength(before);
  expect(window.location.search).toBe('');
});

test('a page that cannot be loaded leaves the page on screen with a message, and Next works again once the server does', async () => {
  let failing = true;
  serveSignatures([
    [null, () => pageOf([FIRST], 'c2')],
    ['c2', () => (failing ? envelope(500, 'internal_server_error') : pageOf([SECOND]))],
  ]);
  const { user } = await openList();
  await user.click(nextButton());
  expect(await screen.findByText(messages['pager.failed'])).toBeInTheDocument();
  expect(shows('Page one CLA')).toBeInTheDocument();
  expect(screen.queryByText('Page two CLA')).toBeNull();
  failing = false;
  await waitFor(() => {
    expect(nextButton()).toBeEnabled();
  });
  await user.click(nextButton());
  expect(await screen.findByText('Page two CLA')).toBeInTheDocument();
  expect(screen.queryByText(messages['pager.failed'])).toBeNull();
});

test('a cursor the server refuses on a click leaves the page on screen and says so: it is not the first page again', async () => {
  const seen = serveSignatures([[null, () => pageOf([FIRST], 'stale')]]);
  const { user } = await openList();
  await user.click(nextButton());
  expect(await screen.findByText(messages['pager.failed'])).toBeInTheDocument();
  expect(shows('Page one CLA')).toBeInTheDocument();
  expect(seen.map(cursorOf)).toEqual([null, 'stale']);
});

test('while a page loads the page on screen stays, both buttons are off, and one request is in flight', async () => {
  const gate = Promise.withResolvers<Response>();
  const seen = serveSignatures([
    [null, () => pageOf([FIRST], 'c2')],
    ['c2', () => gate.promise],
  ]);
  const { user } = await openList();
  await user.click(nextButton());
  await waitFor(() => {
    expect(nextButton()).toBeDisabled();
  });
  expect(previousButton()).toBeDisabled();
  expect(shows('Page one CLA')).toBeInTheDocument();
  expect(screen.getByText('Page 1')).toBeInTheDocument();
  gate.resolve(pageOf([SECOND]));
  expect(await screen.findByText('Page two CLA')).toBeInTheDocument();
  expect(seen.map(cursorOf)).toEqual([null, 'c2']);
});

test('the keyboard pages through the list: Tab to Next and Enter', async () => {
  serveThreePages();
  const { user } = await openList();
  nextButton().focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByText('Page two CLA')).toBeInTheDocument();
});
