// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { focusManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { threePages } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { githubDown, summary } from '../installations/test-support.ts';
import { nextButton, previousButton } from '../test-support/pager-buttons.ts';
import {
  gadgetsOf,
  noActiveCla,
  openPending,
  PENDING_ROUTE,
  pageOf,
  paramsOf,
  pendingOf,
  pendingTable,
  reasonFilter,
  renderPending,
  repositoryFilter,
  rowsOf,
  servePending,
} from './test-support.ts';

// E18-S08: the filters (repository and reason), the cursor and the refresh on window focus. They are validated search parameters, so a
// filtered view survives reload and back, and a value that is not one is dropped.

afterEach(() => {
  focusManager.setFocused();
});

const optionsOf = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map((option) => option.textContent);
const repositories = () => rowsOf(pendingTable()).map((cells) => cells[0]);

test('the repository filter lists all repositories and those of the tenant by name, and the reason filter all reasons and the six of the list', async () => {
  await openPending();
  expect(optionsOf(repositoryFilter())).toEqual([
    messages['pending.filter.repository.all'],
    'acme/widgets',
    'acme/gadgets',
  ]);
  expect(optionsOf(reasonFilter())).toEqual([
    messages['pending.filter.reason.all'],
    messages['pending.reasonName.no_active_cla'],
    messages['pending.reasonName.unsigned_contributor'],
    messages['pending.reasonName.bot_not_allowlisted'],
    messages['pending.reasonName.unlinked_identity'],
    messages['pending.reasonName.commit_limit_exceeded'],
    messages['pending.reasonName.other'],
  ]);
});

test('choosing a repository puts it in the address, asks for that repository only and shows the page the server sends', async () => {
  const { served, user } = await openPending(PENDING_ROUTE, {
    pending: [pageOf([pendingOf(), gadgetsOf()]), pageOf([gadgetsOf()])],
  });
  await user.selectOptions(repositoryFilter(), 'acme/gadgets');
  await waitFor(() => {
    expect(repositories()).toEqual(['acme/gadgets']);
  });
  expect(window.location.search).toBe('?repository=2');
  expect(paramsOf(served.pending.at(-1))).toEqual({ limit: '50', repositoryId: '2' });
  expect(repositoryFilter()).toHaveValue('2');
});

test('choosing all repositories takes the repository out of the address and asks for every repository again', async () => {
  const { served, user } = await openPending(`${PENDING_ROUTE}?repository=2`, {
    pending: [pageOf([gadgetsOf()]), pageOf([pendingOf(), gadgetsOf()])],
  });
  await user.selectOptions(repositoryFilter(), messages['pending.filter.repository.all']);
  await waitFor(() => {
    expect(repositories()).toEqual(['acme/widgets', 'acme/gadgets']);
  });
  expect(window.location.search).toBe('');
  expect(paramsOf(served.pending.at(-1))).toEqual({ limit: '50' });
  expect(repositoryFilter()).toHaveValue('');
});

test('choosing a reason puts it in the address and asks for it, and choosing all reasons takes it out again', async () => {
  const { served, user } = await openPending(PENDING_ROUTE, {
    pending: [pageOf([pendingOf(), gadgetsOf()]), pageOf([gadgetsOf()]), pageOf([pendingOf(), gadgetsOf()])],
  });
  await user.selectOptions(reasonFilter(), messages['pending.reasonName.no_active_cla']);
  await waitFor(() => {
    expect(repositories()).toEqual(['acme/gadgets']);
  });
  expect(window.location.search).toBe('?reason=no_active_cla');
  expect(paramsOf(served.pending.at(-1))).toEqual({ limit: '50', reason: 'no_active_cla' });
  await user.selectOptions(reasonFilter(), messages['pending.filter.reason.all']);
  await waitFor(() => {
    expect(repositories()).toEqual(['acme/widgets', 'acme/gadgets']);
  });
  expect(window.location.search).toBe('');
  expect(paramsOf(served.pending.at(-1))).toEqual({ limit: '50' });
});

test('the repository and the reason together are two parameters of one request, and the selects show them after a reload', async () => {
  const { served } = await openPending(`${PENDING_ROUTE}?repository=2&reason=no_active_cla`, {
    pending: [pageOf([gadgetsOf({ reasons: [noActiveCla] })])],
  });
  expect(paramsOf(served.pending[0])).toEqual({ limit: '50', repositoryId: '2', reason: 'no_active_cla' });
  expect(repositoryFilter()).toHaveValue('2');
  expect(reasonFilter()).toHaveValue('no_active_cla');
});

test.each([
  ['a reason the list does not know', '?reason=expired'],
  ['a repository that is not a number', '?repository=acme'],
  ['a repository of zero', '?repository=0'],
  ['a repository that is negative', '?repository=-3'],
  ['a repository with a decimal', '?repository=1.5'],
  ['a tab the screen does not have', '?tab=audit'],
])('an address with %s drops it, and the list is asked for with no filter', async (_what, search) => {
  const { served } = await openPending(`${PENDING_ROUTE}${search}`);
  expect(paramsOf(served.pending[0])).toEqual({ limit: '50' });
  expect(repositoryFilter()).toHaveValue('');
  expect(reasonFilter()).toHaveValue('');
});

test('a repository the list of the tenant does not hold is still a choice named by its id, and the server decides', async () => {
  const { served } = await openPending(`${PENDING_ROUTE}?repository=77`, { pending: [pageOf([gadgetsOf()])] });
  expect(paramsOf(served.pending[0])).toEqual({ limit: '50', repositoryId: '77' });
  expect(optionsOf(repositoryFilter())).toContain(messages['pending.repository.byId'].replace('{id}', '77'));
  expect(repositoryFilter()).toHaveValue('77');
});

test('a repository of another tenant is the uniform 404: the not-found state and no row', async () => {
  servePending({ pending: [envelope(404, 'not_found')] });
  renderPending(`${PENDING_ROUTE}?repository=999`);
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.not_found']);
  expect(screen.queryByRole('table')).toBeNull();
});

test('a filter with no match says so in the words of the filtered empty state', async () => {
  const { user } = await openPending(PENDING_ROUTE, { pending: [pageOf([pendingOf()]), pageOf([])] });
  await user.selectOptions(reasonFilter(), messages['pending.reasonName.other']);
  expect(await screen.findByText(messages['pending.empty.filtered'])).toBeInTheDocument();
  expect(screen.queryByText(messages['pending.empty.none'])).toBeNull();
});

test('a list of the repositories that cannot be read is an error with Try again, and the pull requests are still listed', async () => {
  await openPending(PENDING_ROUTE, { tenants: [{ summary: summary(), answer: githubDown }] });
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.github_unavailable']);
  expect(within(alert).getByRole('button', { name: messages['states.retry'] })).toBeInTheDocument();
  expect(pendingTable()).toBeInTheDocument();
});

const THREE_PAGES = threePages(pageOf, [
  pendingOf({ evaluationId: 1, repository: { id: 1, fullName: 'acme/one' } }),
  pendingOf({ evaluationId: 2, repository: { id: 1, fullName: 'acme/two' } }),
  pendingOf({ evaluationId: 3, repository: { id: 1, fullName: 'acme/three' } }),
]);

test('Next puts the cursor of the server in the address next to the filters and asks for that page, Previous goes back', async () => {
  const { served, user } = await openPending(`${PENDING_ROUTE}?reason=unsigned_contributor`, { pages: THREE_PAGES });
  expect(previousButton()).toBeDisabled();
  await user.click(nextButton());
  await waitFor(() => {
    expect(repositories()).toEqual(['acme/two']);
  });
  expect(window.location.search).toBe('?reason=unsigned_contributor&cursor=c2');
  expect(paramsOf(served.pending.at(-1))).toEqual({ limit: '50', reason: 'unsigned_contributor', cursor: 'c2' });
  expect(screen.getByText('Page 2')).toBeInTheDocument();
  await waitFor(() => {
    expect(previousButton()).toBeEnabled();
  });
  await user.click(previousButton());
  await waitFor(() => {
    expect(repositories()).toEqual(['acme/one']);
  });
  expect(window.location.search).toBe('?reason=unsigned_contributor');
});

test('the last page has no Next, and the Back button of the browser goes back through the pages', async () => {
  const { user } = await openPending(PENDING_ROUTE, { pages: THREE_PAGES });
  await user.click(nextButton());
  await waitFor(() => {
    expect(repositories()).toEqual(['acme/two']);
  });
  await user.click(nextButton());
  await waitFor(() => {
    expect(repositories()).toEqual(['acme/three']);
  });
  await waitFor(() => {
    expect(nextButton()).toBeDisabled();
  });
  act(() => {
    window.history.back();
  });
  await waitFor(() => {
    expect(repositories()).toEqual(['acme/two']);
  });
});

test('a cursor the server refuses is answered with the first page, and the address no longer holds it', async () => {
  const { served } = await openPending(`${PENDING_ROUTE}?reason=other&cursor=forged`, { pages: THREE_PAGES });
  expect(served.pending.map((seen) => paramsOf(seen)['cursor'])).toEqual(['forged', undefined]);
  expect(window.location.search).toBe('?reason=other');
  expect(repositories()).toEqual(['acme/one']);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a page that cannot be loaded leaves the page on screen and the pager says so', async () => {
  const pages = new Map<string | null, () => Response>([
    [null, () => pageOf([pendingOf()], 'c2')],
    ['c2', () => envelope(502, 'github_unavailable')],
  ]);
  const { user } = await openPending(PENDING_ROUTE, { pages });
  await user.click(nextButton());
  expect(await screen.findByText(messages['pager.failed'])).toBeInTheDocument();
  expect(repositories()).toEqual(['acme/widgets']);
});

test('coming back to the window asks for the list again, so a signature recorded elsewhere makes its pull request leave', async () => {
  const { served } = await openPending(PENDING_ROUTE, {
    pending: [pageOf([pendingOf(), gadgetsOf()]), pageOf([gadgetsOf()])],
  });
  expect(repositories()).toEqual(['acme/widgets', 'acme/gadgets']);
  act(() => {
    focusManager.setFocused(true);
  });
  await waitFor(() => {
    expect(repositories()).toEqual(['acme/gadgets']);
  });
  expect(served.pending).toHaveLength(2);
});
