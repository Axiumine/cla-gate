// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  graceOf,
  openSignatures,
  pageOf,
  paramsOf,
  renderSignatures,
  rowsOf,
  SIGNATURES_ROUTE,
  searchBox,
  serveSignatures,
  signatureOf,
  signaturesTable,
} from './test-support.ts';

// E18-S07: the search is one input that becomes one of the two exact filters of the endpoint, and it is in the address.

afterEach(() => {
  vi.useRealTimers();
});

/** Lets the debounce of the search box run out, while the page and its requests go on in real time. */
async function pause() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

test('letters are a login: after the pause one request names the login, in the words the person typed, and no id', async () => {
  const { served, user } = await openSignatures(SIGNATURES_ROUTE, {
    search: [pageOf([signatureOf(), graceOf()]), pageOf([signatureOf()])],
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await user.type(searchBox(), 'OctoCat');
  expect(served.search).toHaveLength(1);
  await pause();
  await waitFor(() => {
    expect(served.search).toHaveLength(2);
  });
  expect(paramsOf(served.search[1])).toEqual({ limit: '50', login: 'OctoCat' });
  expect(window.location.search).toBe('?q=OctoCat');
  await screen.findByText('1 signature on this page');
  expect(rowsOf(signaturesTable())).toHaveLength(1);
});

test('digits are the numeric GitHub id of the signer, and the request names it and no login', async () => {
  const { served, user } = await openSignatures(SIGNATURES_ROUTE, {
    search: [pageOf([signatureOf(), graceOf()]), pageOf([signatureOf()])],
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await user.type(searchBox(), '4711');
  await pause();
  await waitFor(() => {
    expect(served.search).toHaveLength(2);
  });
  expect(paramsOf(served.search[1])).toEqual({ limit: '50', githubUserId: '4711' });
  expect(window.location.search).toBe('?q=%224711%22');
});

test.each([
  ['a leading zero', '0123'],
  ['zero', '0'],
  ['more digits than a number holds exactly', '12345678901234567890'],
])('digits that cannot be an id (%s) are a login, because an account can be named with digits', async (_what, text) => {
  const { served, user } = await openSignatures(SIGNATURES_ROUTE, {
    search: [pageOf([signatureOf()]), pageOf([])],
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await user.type(searchBox(), text);
  await pause();
  await waitFor(() => {
    expect(served.search).toHaveLength(2);
  });
  expect(paramsOf(served.search[1])).toEqual({ limit: '50', login: text });
});

test('Enter asks at once, and the debounce asks nothing more afterwards', async () => {
  const { served, user } = await openSignatures(SIGNATURES_ROUTE, {
    search: [pageOf([signatureOf()]), pageOf([])],
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await user.type(searchBox(), 'octocat{Enter}');
  await waitFor(() => {
    expect(served.search).toHaveLength(2);
  });
  await pause();
  expect(served.search).toHaveLength(2);
});

test('a text that is not a search (blanks) asks for nothing, and clearing the box asks for the unfiltered list again', async () => {
  const { served, user } = await openSignatures(`${SIGNATURES_ROUTE}?q=octocat`, {
    search: [pageOf([signatureOf()]), pageOf([signatureOf(), graceOf()])],
  });
  expect(searchBox()).toHaveValue('octocat');
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await user.clear(searchBox());
  await pause();
  await waitFor(() => {
    expect(served.search).toHaveLength(2);
  });
  expect(paramsOf(served.search[1])).toEqual({ limit: '50' });
  expect(window.location.search).toBe('');
});

test('a search in the address is the search of the page: the box shows it and one request names it', async () => {
  const { served } = await openSignatures(`${SIGNATURES_ROUTE}?q=hubot`);
  expect(searchBox()).toHaveValue('hubot');
  expect(served.search).toHaveLength(1);
  expect(paramsOf(served.search[0])).toEqual({ limit: '50', login: 'hubot' });
});

test('digits written in the address as a number are the same search as the digits typed', async () => {
  const { served } = await openSignatures(`${SIGNATURES_ROUTE}?q=4711`);
  expect(searchBox()).toHaveValue('4711');
  expect(paramsOf(served.search[0])).toEqual({ limit: '50', githubUserId: '4711' });
});

test.each([
  ['an empty value', 'q='],
  ['blanks', 'q=%20%20'],
  ['a list', 'q=%5B%22a%22%5D'],
  ['a negative number', 'q=-5'],
  ['a text longer than a login', `q=${'a'.repeat(101)}`],
])('a search in the address that is %s is dropped, and the unfiltered list is asked for', async (_what, query) => {
  const { served } = await openSignatures(`${SIGNATURES_ROUTE}?${query}`);
  expect(searchBox()).toHaveValue('');
  expect(paramsOf(served.search[0])).toEqual({ limit: '50' });
});

test('Back returns to the search before: the address and the box follow it', async () => {
  const { served, user } = await openSignatures(`${SIGNATURES_ROUTE}?q=octocat`, {
    search: [pageOf([signatureOf()]), pageOf([signatureOf(), graceOf()]), pageOf([signatureOf()])],
  });
  await user.selectOptions(screen.getByRole('combobox', { name: messages['signatures.filter.state'] }), 'revoked');
  await waitFor(() => {
    expect(window.location.search).toContain('state=revoked');
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await user.clear(searchBox());
  await pause();
  await waitFor(() => {
    expect(window.location.search).toBe('?state=revoked');
  });
  act(() => {
    window.history.back();
  });
  await waitFor(() => {
    expect(searchBox()).toHaveValue('octocat');
  });
  expect(served.search.length).toBeGreaterThanOrEqual(3);
});

test('the help says that the search is exact, by login in any case or by GitHub id, and that digits are read as the id', async () => {
  await openSignatures();
  expect(searchBox()).toHaveAccessibleDescription(
    expect.stringMatching(
      /exact GitHub login.*any case.*numeric GitHub id.*digits only.*id.*part of a login finds nothing/i,
    ),
  );
});

test('a search that finds nobody says so, and says how the search matches', async () => {
  serveSignatures({ search: [pageOf([])] });
  renderSignatures(`${SIGNATURES_ROUTE}?q=nobody`);
  expect(await screen.findByText(messages['signatures.empty.filtered'])).toBeInTheDocument();
});

test('axe passes with a search in the address and a filter chosen', async () => {
  await openSignatures(`${SIGNATURES_ROUTE}?q=octocat&state=active`);
  await expectNoA11yViolations(document.body);
});
