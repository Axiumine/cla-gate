// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { focusManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { repositoriesOf, repository, summary } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  heading,
  OVERRIDES_ROUTE,
  openOverrides,
  openPending,
  overrideOf,
  overridesPage,
  overridesTable,
  paramsOf,
  pathOf,
  renderPending,
  rowsOf,
  servePending,
  UNLINKED_SHA,
} from './test-support.ts';

// E18-S08: the "Overrides" tab: the repository that has to be chosen first, the list of that repository with its pager, and the fact that
// nothing here edits an override.

afterEach(() => {
  focusManager.setFocused();
});

const chooser = () =>
  screen.getByRole('combobox', { name: (name) => name.startsWith(messages['pending.overrides.repository']) });

test('the tab is open when the address says so, the repository is a required choice, and nothing is asked for until one is chosen', async () => {
  const served = servePending();
  renderPending(OVERRIDES_ROUTE);
  await heading(messages['pending.title']);
  expect(screen.getByRole('tab', { name: messages['pending.tab.overrides'] })).toHaveAttribute('aria-selected', 'true');
  expect(
    await screen.findByRole('heading', { level: 2, name: messages['pending.overrides.choose.title'] }),
  ).toBeInTheDocument();
  expect(chooser()).toBeRequired();
  expect(
    within(chooser())
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual([messages['pending.overrides.repository.choose'], 'acme/widgets', 'acme/gadgets']);
  expect(served.overrides).toEqual([]);
  expect(screen.queryByRole('table')).toBeNull();
});

test('choosing the Overrides tab puts it in the address with no filter of the other tab, and choosing Pending takes it out again', async () => {
  const { user } = await openPending('/installations/5/pending?repository=2&reason=other');
  await user.click(screen.getByRole('tab', { name: messages['pending.tab.overrides'] }));
  expect(
    await screen.findByRole('heading', { level: 2, name: messages['pending.overrides.choose.title'] }),
  ).toBeInTheDocument();
  expect(window.location.search).toBe('?tab=overrides');
  await user.click(screen.getByRole('tab', { name: messages['pending.tab.pending'] }));
  await screen.findByRole('table', { name: messages['pending.caption'] });
  expect(window.location.search).toBe('');
});

test('the tabs are one tab stop and arrow keys move between them', async () => {
  const { user } = await openPending();
  screen.getByRole('tab', { name: messages['pending.tab.pending'] }).focus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: messages['pending.tab.overrides'] })).toHaveFocus();
  await waitFor(() => {
    expect(window.location.search).toBe('?tab=overrides');
  });
});

test('choosing a repository puts it in the address and asks for the overrides of that repository, 50 at a time', async () => {
  const served = servePending();
  const { user } = renderPending(OVERRIDES_ROUTE);
  await screen.findByRole('option', { name: 'acme/widgets' });
  await user.selectOptions(chooser(), 'acme/widgets');
  await screen.findByRole('table', { name: messages['pending.overrides.caption'] });
  expect(window.location.search).toBe('?tab=overrides&repository=1');
  expect(served.overrides.map(pathOf)).toEqual(['/api/repositories/1/commit-overrides']);
  expect(paramsOf(served.overrides[0])).toEqual({ limit: '50' });
});

test('a row shows the full commit id in code, who recorded it with the numeric id, the time and the reason, and counts the page', async () => {
  await openOverrides();
  const [cells] = rowsOf(overridesTable());
  expect(cells?.slice(0, 4)).toEqual([
    UNLINKED_SHA,
    'octocat4711',
    '2026-11-02 09:30 UTC',
    'Maintainer commit with a work email',
  ]);
  expect(within(overridesTable()).getByText(UNLINKED_SHA).tagName).toBe('CODE');
  expect(within(overridesTable()).getByText('4711').tagName).toBe('CODE');
  expect(within(overridesTable()).getByRole('time')).toHaveAttribute('datetime', '2026-11-02T09:30:00.000Z');
  expect(screen.getByText(messages['pending.overrides.count.one'].replace('{count}', '1'))).toHaveAttribute(
    'aria-live',
    'polite',
  );
});

test('the list never offers editing: the only controls of a row are Remove, and the page says how to change an override', async () => {
  await openOverrides();
  const rows = within(overridesTable()).getAllByRole('row').slice(1);
  expect(
    rows.flatMap((row) =>
      within(row)
        .queryAllByRole('button')
        .map((button) => button.textContent),
    ),
  ).toEqual([messages['pending.overrides.remove']]);
  expect(within(overridesTable()).queryAllByRole('textbox')).toEqual([]);
  expect(within(overridesTable()).queryAllByRole('link')).toEqual([]);
  expect(screen.getByText(messages['pending.overrides.intro'])).toBeInTheDocument();
});

test('a repository with no override shows the empty state', async () => {
  servePending({ overrides: [overridesPage([])] });
  renderPending(`${OVERRIDES_ROUTE}&repository=1`);
  expect(
    await screen.findByRole('heading', { level: 3, name: messages['pending.overrides.empty.title'] }),
  ).toBeInTheDocument();
  expect(screen.getByText(messages['pending.overrides.empty.description'])).toBeInTheDocument();
});

test('the list is paged by cursor next to the repository in the address, and Next and Previous move through it', async () => {
  const { served, user } = await openOverrides(`${OVERRIDES_ROUTE}&repository=1`, {
    overrides: [
      overridesPage([overrideOf({ id: 1, reason: 'First page' })], 'c2'),
      overridesPage([overrideOf({ id: 2, reason: 'Second page' })]),
      overridesPage([overrideOf({ id: 1, reason: 'First page' })], 'c2'),
    ],
  });
  expect(screen.getByRole('button', { name: messages['pager.previous'] })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: messages['pager.next'] }));
  await waitFor(() => {
    expect(rowsOf(overridesTable())[0]?.[3]).toBe('Second page');
  });
  expect(window.location.search).toBe('?tab=overrides&repository=1&cursor=c2');
  expect(paramsOf(served.overrides[1])).toEqual({ limit: '50', cursor: 'c2' });
  await waitFor(() => {
    expect(screen.getByRole('button', { name: messages['pager.previous'] })).toBeEnabled();
  });
  await user.click(screen.getByRole('button', { name: messages['pager.previous'] }));
  await waitFor(() => {
    expect(rowsOf(overridesTable())[0]?.[3]).toBe('First page');
  });
});

test('a cursor the server refuses is answered with the first page, and the address no longer holds it', async () => {
  const { served } = await openOverrides(`${OVERRIDES_ROUTE}&repository=1&cursor=forged`, {
    overrides: [envelope(400, 'bad_request'), overridesPage([overrideOf()])],
  });
  expect(served.overrides.map((seen) => paramsOf(seen)['cursor'])).toEqual(['forged', undefined]);
  expect(window.location.search).toBe('?tab=overrides&repository=1');
});

test('coming back to the window asks for the list again, so an override removed elsewhere leaves it', async () => {
  const { served } = await openOverrides(`${OVERRIDES_ROUTE}&repository=1`, {
    overrides: [
      overridesPage([overrideOf({ id: 1 }), overrideOf({ id: 2, reason: 'Second' })]),
      overridesPage([overrideOf({ id: 2, reason: 'Second' })]),
    ],
  });
  expect(rowsOf(overridesTable())).toHaveLength(2);
  act(() => {
    focusManager.setFocused(true);
  });
  await waitFor(() => {
    expect(rowsOf(overridesTable())).toHaveLength(1);
  });
  expect(served.overrides).toHaveLength(2);
});

test('a repo admin whose repository enforces the document of the installation gets 403: the forbidden state and no row', async () => {
  servePending({ overrides: [envelope(403, 'forbidden')] });
  renderPending(`${OVERRIDES_ROUTE}&repository=1`);
  expect(
    await screen.findByRole('heading', { level: 3, name: messages['states.forbidden.title'] }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});

test('a list that cannot be loaded is the error state with Try again', async () => {
  const served = servePending({ overrides: [envelope(502, 'github_unavailable'), overridesPage([overrideOf()])] });
  const { user } = renderPending(`${OVERRIDES_ROUTE}&repository=1`);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.github_unavailable']);
  await user.click(within(alert).getByRole('button', { name: messages['states.retry'] }));
  await screen.findByRole('table', { name: messages['pending.overrides.caption'] });
  expect(served.overrides).toHaveLength(2);
});

test('the repository of the address that the list of the installation does not hold is not shown and not asked for: the choice stays open', async () => {
  const served = servePending();
  renderPending(`${OVERRIDES_ROUTE}&repository=999`);
  expect(
    await screen.findByRole('heading', { level: 2, name: messages['pending.overrides.choose.title'] }),
  ).toBeInTheDocument();
  expect(served.overrides).toEqual([]);
  expect(chooser()).toHaveValue('');
});

test('while the repositories are on their way, a repository in the address is loading and not the invitation to choose', async () => {
  servePending({ tenants: [{ summary: summary(), answer: () => new Promise<Response>(() => undefined) }] });
  renderPending(`${OVERRIDES_ROUTE}&repository=1`);
  expect(await screen.findByText(messages['states.loading'])).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: messages['pending.overrides.choose.title'] })).toBeNull();
});

test('when the list of the installation is cut short, a repository of the address that it does not hold is still named by its id and the server decides', async () => {
  const served = servePending({
    tenants: [{ summary: summary(), answer: () => repositoriesOf([repository(1, 'acme/widgets')], 'more') }],
  });
  renderPending(`${OVERRIDES_ROUTE}&repository=999`);
  await screen.findByRole('table', { name: messages['pending.overrides.caption'] });
  expect(served.overrides.map(pathOf)).toEqual(['/api/repositories/999/commit-overrides']);
  expect(chooser()).toHaveValue('999');
  expect(
    within(chooser()).getByRole('option', { name: messages['pending.repository.byId'].replace('{id}', '999') }),
  ).toBeInTheDocument();
  expect(screen.getByText(messages['pending.repository.more'].replace('{count}', '100'))).toBeInTheDocument();
});

test('the tab passes axe, with the choice, with the table', async () => {
  const served = servePending();
  const { user } = renderPending(OVERRIDES_ROUTE);
  await screen.findByRole('option', { name: 'acme/widgets' });
  await expectNoA11yViolations(document.body);
  await user.selectOptions(chooser(), 'acme/widgets');
  await screen.findByRole('table', { name: messages['pending.overrides.caption'] });
  await expectNoA11yViolations(document.body);
  expect(served.overrides).toHaveLength(1);
});
