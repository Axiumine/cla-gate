// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  enabledFilter,
  gadgets,
  openRepositories,
  pageOf,
  paramsOf,
  REPOSITORIES_ROUTE,
  repositoriesTable,
  rowsOf,
  searchBox,
  widgets,
} from './test-support.ts';

// E18-S10: the search is the `q` of the endpoint and the filter its `enabled`; both, with the cursor, are in the address.

afterEach(() => {
  vi.useRealTimers();
});

/** Lets the debounce of the search box run out, while the page and its requests go on in real time. */
async function pause() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

const names = () => rowsOf(repositoriesTable()).map((cells) => cells[0]);
const TWO_PAGES = [pageOf([widgets(), gadgets()]), pageOf([widgets()])];

test('a search is asked for by the server 300 ms after the last key: one request names it, and the address holds it', async () => {
  const { served, user } = await openRepositories(REPOSITORIES_ROUTE, { list: TWO_PAGES });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await user.type(searchBox(), 'Wid');
  expect(served.list).toHaveLength(1);
  await pause();
  await waitFor(() => {
    expect(served.list).toHaveLength(2);
  });
  expect(paramsOf(served.list[1])).toEqual({ limit: '50', q: 'Wid' });
  expect(window.location.search).toBe('?q=Wid');
  await waitFor(() => {
    expect(names()).toEqual(['acme/widgets']);
  });
  expect(screen.getByText('1 repository on this page')).toBeInTheDocument();
});

test('Enter asks at once, and the debounce asks nothing more afterwards', async () => {
  const { served, user } = await openRepositories(REPOSITORIES_ROUTE, { list: TWO_PAGES });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await user.type(searchBox(), 'widgets{Enter}');
  await waitFor(() => {
    expect(served.list).toHaveLength(2);
  });
  await pause();
  expect(served.list).toHaveLength(2);
  expect(paramsOf(served.list[1])).toEqual({ limit: '50', q: 'widgets' });
});

test('a text of digits is a search for a name, as the router writes it in the address', async () => {
  const { served, user } = await openRepositories(REPOSITORIES_ROUTE, { list: TWO_PAGES });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await user.type(searchBox(), '4711');
  await pause();
  await waitFor(() => {
    expect(served.list).toHaveLength(2);
  });
  expect(paramsOf(served.list[1])).toEqual({ limit: '50', q: '4711' });
  expect(window.location.search).toBe('?q=%224711%22');
});

test('a text that is not a search (blanks) asks for nothing, and clearing the box asks for the unfiltered list again', async () => {
  const { served, user } = await openRepositories(`${REPOSITORIES_ROUTE}?q=widgets`, { list: TWO_PAGES });
  expect(searchBox()).toHaveValue('widgets');
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await user.clear(searchBox());
  await user.type(searchBox(), '   ');
  await pause();
  await waitFor(() => {
    expect(served.list).toHaveLength(2);
  });
  expect(paramsOf(served.list[1])).toEqual({ limit: '50' });
  expect(window.location.search).toBe('');
  await pause();
  expect(served.list).toHaveLength(2);
});

test('a search in the address is the search of the page: the box shows it and one request names it', async () => {
  const { served } = await openRepositories(`${REPOSITORIES_ROUTE}?q=widgets`, { list: [pageOf([widgets()])] });
  expect(searchBox()).toHaveValue('widgets');
  expect(served.list).toHaveLength(1);
  expect(paramsOf(served.list[0])).toEqual({ limit: '50', q: 'widgets' });
});

test('the filter asks the server for the enabled repositories or the disabled ones, and All drops it; the address holds the choice', async () => {
  const { served, user } = await openRepositories(REPOSITORIES_ROUTE, { list: TWO_PAGES });
  await user.selectOptions(enabledFilter(), messages['status.enabled']);
  await waitFor(() => {
    expect(served.list).toHaveLength(2);
  });
  expect(paramsOf(served.list[1])).toEqual({ limit: '50', enabled: 'true' });
  expect(window.location.search).toBe('?enabled=true');
  await user.selectOptions(enabledFilter(), messages['status.disabled']);
  await waitFor(() => {
    expect(served.list).toHaveLength(3);
  });
  expect(paramsOf(served.list[2])).toEqual({ limit: '50', enabled: 'false' });
  expect(window.location.search).toBe('?enabled=false');
  expect(enabledFilter()).toHaveValue('false');
  await user.selectOptions(enabledFilter(), messages['repositories.filter.enabled.all']);
  await waitFor(() => {
    expect(served.list).toHaveLength(4);
  });
  expect(paramsOf(served.list[3])).toEqual({ limit: '50' });
  expect(window.location.search).toBe('');
});

test('the filter in the address is the filter of the page: the select shows it and one request names it', async () => {
  const { served } = await openRepositories(`${REPOSITORIES_ROUTE}?enabled=false`, { list: [pageOf([gadgets()])] });
  expect(enabledFilter()).toHaveValue('false');
  expect(paramsOf(served.list[0])).toEqual({ limit: '50', enabled: 'false' });
});

test('a search and a filter go together, and changing either starts again from the first page', async () => {
  const { served, user } = await openRepositories(`${REPOSITORIES_ROUTE}?q=a&enabled=true&cursor=c2`, {
    list: [pageOf([widgets()]), pageOf([widgets()])],
  });
  expect(paramsOf(served.list[0])).toEqual({ limit: '50', q: 'a', enabled: 'true', cursor: 'c2' });
  await user.selectOptions(enabledFilter(), messages['status.disabled']);
  await waitFor(() => {
    expect(served.list).toHaveLength(2);
  });
  expect(paramsOf(served.list[1])).toEqual({ limit: '50', q: 'a', enabled: 'false' });
  expect(window.location.search).toBe('?q=a&enabled=false');
});

test.each([
  ['a filter nobody has', '?enabled=maybe'],
  ['a search of blanks', '?q=%20%20'],
  ['a cursor of no characters', '?cursor='],
  ['a key nobody defined', '?installationId=6'],
])('an address with %s shows the whole list, and the request names nothing', async (_what, search) => {
  const { served } = await openRepositories(`${REPOSITORIES_ROUTE}${search}`, { list: [pageOf([widgets()])] });
  expect(paramsOf(served.list[0])).toEqual({ limit: '50' });
});

test('the Back button of the browser returns to the earlier search and the box follows it', async () => {
  const { served, user } = await openRepositories(REPOSITORIES_ROUTE, { list: TWO_PAGES });
  await user.selectOptions(enabledFilter(), messages['status.enabled']);
  await waitFor(() => {
    expect(served.list).toHaveLength(2);
  });
  act(() => {
    window.history.back();
  });
  await waitFor(() => {
    expect(enabledFilter()).toHaveValue('');
  });
  expect(window.location.search).toBe('');
});

test('a search that matches nothing says so and offers to change or clear it, where an empty tenant says it has none', async () => {
  await openRepositories(`${REPOSITORIES_ROUTE}?q=zzzz`, { list: [pageOf([])] });
  expect(screen.getByText(messages['repositories.empty.filtered'])).toBeInTheDocument();
  expect(screen.queryByText(messages['repositories.empty.none'])).toBeNull();
});

test('the search is a labelled landmark with one field that says what it matches, and the page passes axe with a filter in the address', async () => {
  const { container } = await openRepositories(`${REPOSITORIES_ROUTE}?q=widgets&enabled=true`, {
    list: [pageOf([widgets()])],
  });
  expect(container.querySelector('search')).toHaveAttribute('aria-label', messages['repositories.search.label']);
  expect(searchBox()).toHaveAccessibleDescription(messages['repositories.search.help']);
  await expectNoA11yViolations(container);
});
