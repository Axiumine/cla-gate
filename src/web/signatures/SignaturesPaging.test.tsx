// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { threePages } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { nextButton, previousButton } from '../test-support/pager-buttons.ts';
import {
  cursorOf,
  graceOf,
  openSignatures,
  pageOf,
  paramsOf,
  rowsOf,
  SIGNATURES_ROUTE,
  signatureOf,
  signaturesTable,
} from './test-support.ts';

// E18-S07: a page holds 50 signatures, the page is the `cursor` of the address next to the filters, and nothing says how many there
// are in all.

const FIRST = signatureOf({ id: 3, signer: { login: 'one', name: 'Page one', email: 'zzzz-1@example.org' } });
const SECOND = graceOf({ id: 2, signer: { login: 'two', name: 'Page two', email: 'zzzz-2@example.org' } });
const THIRD = signatureOf({ id: 1, signer: { login: 'three', name: 'Page three', email: 'zzzz-3@example.org' } });

/** Three pages: the first leads to `c2`, which leads to `c3`, the last. */
const THREE_PAGES = threePages(pageOf, [FIRST, SECOND, THIRD]);

const names = () => rowsOf(signaturesTable()).map((cells) => cells[0]);

test('the first page has no cursor, Next puts the cursor of the server in the address next to the filters and asks for that page', async () => {
  const { served, user } = await openSignatures(`${SIGNATURES_ROUTE}?state=active`, { pages: THREE_PAGES });
  expect(served.search.map(cursorOf)[0]).toBeNull();
  expect(previousButton()).toBeDisabled();
  await user.click(nextButton());
  await waitFor(() => {
    expect(names()).toEqual(['Page twotwo']);
  });
  expect(window.location.search).toBe('?state=active&cursor=c2');
  expect(paramsOf(served.search.at(-1))).toEqual({ limit: '50', state: 'active', cursor: 'c2' });
  expect(screen.getByText('Page 2')).toBeInTheDocument();
});

test('the last page has no Next, and Previous and the Back button of the browser go back through the pages', async () => {
  const { user } = await openSignatures(SIGNATURES_ROUTE, { pages: THREE_PAGES });
  await user.click(nextButton());
  await waitFor(() => {
    expect(names()).toEqual(['Page twotwo']);
  });
  await user.click(nextButton());
  await waitFor(() => {
    expect(names()).toEqual(['Page threethree']);
  });
  await waitFor(() => {
    expect(nextButton()).toBeDisabled();
  });
  act(() => {
    window.history.back();
  });
  await waitFor(() => {
    expect(names()).toEqual(['Page twotwo']);
  });
  expect(window.location.search).toBe('?cursor=c2');
  await waitFor(() => {
    expect(previousButton()).toBeEnabled();
  });
  await user.click(previousButton());
  await waitFor(() => {
    expect(names()).toEqual(['Page oneone']);
  });
  expect(window.location.search).toBe('');
});

test('a reload on a later page asks for that page and for no other, and the pager does not know the number of the page', async () => {
  const { served } = await openSignatures(`${SIGNATURES_ROUTE}?cursor=c2`, { pages: THREE_PAGES });
  expect(served.search).toHaveLength(1);
  expect(cursorOf(served.search[0])).toBe('c2');
  expect(names()).toEqual(['Page twotwo']);
  expect(screen.getByText(messages['pager.later'])).toBeInTheDocument();
});

test.each([
  ['an empty value', ''],
  ['a list', '%5B%22a%22%5D'],
  ['a text of 1025 characters', 'a'.repeat(1025)],
])('a cursor in the address that is %s is dropped, and the first page is asked for', async (_what, value) => {
  const { served } = await openSignatures(`${SIGNATURES_ROUTE}?cursor=${value}`, { pages: THREE_PAGES });
  expect(served.search).toHaveLength(1);
  expect(cursorOf(served.search[0])).toBeNull();
  expect(names()).toEqual(['Page oneone']);
});

test('a cursor the server refuses is answered with the first page, and the address no longer holds it', async () => {
  const { served } = await openSignatures(`${SIGNATURES_ROUTE}?state=active&cursor=forged`, { pages: THREE_PAGES });
  expect(served.search.map(cursorOf)).toEqual(['forged', null]);
  expect(window.location.search).toBe('?state=active');
  expect(names()).toEqual(['Page oneone']);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a page that cannot be loaded leaves the page on screen and the pager says so, and Next asks for it again', async () => {
  let failing = true;
  const pages = new Map<string | null, () => Response>([
    [null, () => pageOf([FIRST], 'c2')],
    ['c2', () => (failing ? envelope(502, 'github_unavailable') : pageOf([SECOND]))],
  ]);
  const { user } = await openSignatures(SIGNATURES_ROUTE, { pages });
  await user.click(nextButton());
  expect(await screen.findByText(messages['pager.failed'])).toBeInTheDocument();
  expect(names()).toEqual(['Page oneone']);
  failing = false;
  await user.click(nextButton());
  await waitFor(() => {
    expect(names()).toEqual(['Page twotwo']);
  });
  expect(screen.queryByText(messages['pager.failed'])).toBeNull();
});

test('a page with no next page and no earlier one has a pager with both buttons off, and says no total', async () => {
  await openSignatures(SIGNATURES_ROUTE, { pages: new Map([[null, () => pageOf([FIRST, SECOND])]]) });
  expect(nextButton()).toBeDisabled();
  expect(previousButton()).toBeDisabled();
  expect(screen.getByText('Page 1')).toBeInTheDocument();
  expect(screen.queryByText(/of \d+/)).toBeNull();
});
