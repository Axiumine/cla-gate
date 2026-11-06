// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { githubDown, repositoriesOf, repository, summary, tenantOf } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  ALLOWLIST_ROUTE,
  addButton,
  entriesTable,
  entryOf,
  heading,
  inheritedOf,
  inheritedTable,
  installationPage,
  openAllowlist,
  pathOf,
  REPOSITORY_ROUTE,
  removeButton,
  renderAllowlist,
  repositoryEntryOf,
  repositoryPage,
  rowsOf,
  scopeSelect,
  serveAllowlist,
} from './test-support.ts';

// E18-S06: the allowlist of a scope: what a row says, what an empty scope explains, what a repository inherits, and what an error does.

test('the installation scope lists the entries of the installation with the kind, the login snapshot, the numeric id in code, the scope, who added it and when', async () => {
  const { served } = await openAllowlist(ALLOWLIST_ROUTE, {
    installationList: [
      installationPage([
        entryOf(),
        entryOf({ id: 2, kind: 'bot', githubId: 49699333, loginSnapshot: 'dependabot[bot]' }),
        entryOf({
          id: 3,
          kind: 'org_members',
          githubId: 1234,
          loginSnapshot: 'acme',
          createdAt: '2026-10-02T18:05:00.000Z',
        }),
      ]),
    ],
  });
  expect(served.installationList.map((seen) => [seen.method, pathOf(seen), new URL(seen.url).search])).toEqual([
    ['GET', '/api/installations/5/allowlist-entries', '?limit=200'],
  ]);
  expect(served.repositoryList).toEqual([]);
  expect(rowsOf(entriesTable())).toEqual([
    ['User', 'defunkt 583231', 'Installation', 'alice', '2026-10-01 09:30 UTC', 'Remove'],
    ['Bot', 'dependabot[bot] 49699333', 'Installation', 'alice', '2026-10-01 09:30 UTC', 'Remove'],
    ['Members of the organisation', 'acme 1234', 'Installation', 'alice', '2026-10-02 18:05 UTC', 'Remove'],
  ]);
  expect(within(entriesTable()).getByText('583231').tagName).toBe('CODE');
});

test('an entry with no login snapshot (after an erasure) says so and keeps the numeric id', async () => {
  await openAllowlist(ALLOWLIST_ROUTE, { installationList: [installationPage([entryOf({ loginSnapshot: null })])] });
  expect(rowsOf(entriesTable())[0]?.[1]).toBe(`${messages['allowlist.subject.unknownLogin']} 583231`);
});

test('the page has one h1 and says what the allowlist is; it is the screen of the allowlist link of the tenant navigation', async () => {
  await openAllowlist(ALLOWLIST_ROUTE);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByText(messages['allowlist.intro'])).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: messages['tenant.nav.label'] });
  expect(within(nav).getByRole('link', { name: messages['tenant.nav.allowlist'] })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(document.title).toBe('Allowlist: acme · CLA');
});

test('a scope with no entry says that allowlisted accounts are exempt, that bots are matched by type and numeric id, and that logins are snapshots', async () => {
  await openAllowlist(ALLOWLIST_ROUTE, { installationList: [installationPage([])] });
  const empty = screen.getByRole('heading', { level: 3, name: messages['allowlist.empty.title'] }).parentElement;
  expect(empty).toHaveTextContent('exempt from signing the CLA');
  expect(empty).toHaveTextContent('A bot is matched by its account type and its numeric GitHub id');
  expect(empty).toHaveTextContent('display snapshots only');
  expect(screen.queryByRole('table')).toBeNull();
  expect(addButton()).toBeEnabled();
  await expectNoA11yViolations(document.body);
});

test('a repository lists its own entries, and the entries it inherits in a read-only section of their own', async () => {
  const { served } = await openAllowlist(REPOSITORY_ROUTE, {
    repositoryList: [
      repositoryPage(
        [repositoryEntryOf({ id: 2, loginSnapshot: 'hubot', githubId: 77 })],
        [inheritedOf({ id: 3, loginSnapshot: 'monalisa', githubId: 88 })],
      ),
    ],
  });
  expect(served.repositoryList.map((seen) => [pathOf(seen), new URL(seen.url).search])).toEqual([
    ['/api/repositories/1/allowlist-entries', '?limit=200'],
  ]);
  expect(served.installationList).toEqual([]);
  expect(rowsOf(entriesTable())).toEqual([
    ['User', 'hubot 77', 'Repository', 'alice', '2026-10-01 09:30 UTC', 'Remove'],
  ]);
  expect(screen.getByRole('heading', { level: 2, name: messages['allowlist.inherited.title'] })).toBeInTheDocument();
  expect(rowsOf(inheritedTable())).toEqual([['User', 'monalisa 88', 'Installation', 'alice', '2026-10-01 09:30 UTC']]);
  expect(within(inheritedTable()).queryByRole('button')).toBeNull();
  expect(within(inheritedTable()).queryByRole('columnheader', { name: messages['allowlist.col.actions'] })).toBeNull();
  await expectNoA11yViolations(document.body);
});

test('a repository that inherits nothing has no inherited section, and one with no entry of its own still shows what it inherits', async () => {
  await openAllowlist(REPOSITORY_ROUTE, { repositoryList: [repositoryPage([repositoryEntryOf()], [])] });
  expect(screen.queryByRole('heading', { name: messages['allowlist.inherited.title'] })).toBeNull();
  expect(screen.queryByRole('table', { name: messages['allowlist.inherited.caption'] })).toBeNull();
});

test('a repository with no entry of its own shows the empty state and the entries it inherits', async () => {
  await openAllowlist(REPOSITORY_ROUTE, { repositoryList: [repositoryPage([], [inheritedOf()])] });
  expect(screen.getByRole('heading', { level: 3, name: messages['allowlist.empty.title'] })).toBeInTheDocument();
  expect(rowsOf(inheritedTable())).toHaveLength(1);
});

test('the scope select starts on the whole installation and lists the repositories of the tenant by name', async () => {
  await openAllowlist(ALLOWLIST_ROUTE);
  expect(scopeSelect()).toHaveValue('');
  expect(
    within(scopeSelect())
      .getAllByRole('option')
      .map((option) => [option.textContent, option.getAttribute('value')]),
  ).toEqual([
    [messages['allowlist.scope.installation'], ''],
    ['acme/widgets', '1'],
    ['acme/gadgets', '2'],
  ]);
});

test('choosing a repository puts it in the address and shows its entries, and choosing the whole installation takes it out again', async () => {
  const { served, user } = await openAllowlist(ALLOWLIST_ROUTE);
  await user.selectOptions(scopeSelect(), 'acme/gadgets');
  await screen.findByRole('heading', { level: 2, name: messages['allowlist.inherited.title'] });
  expect(window.location.search).toBe('?repository=2');
  expect(scopeSelect()).toHaveValue('2');
  expect(served.repositoryList.map(pathOf)).toEqual(['/api/repositories/2/allowlist-entries']);
  expect(screen.queryByText('defunkt')).toBeNull();
  await user.selectOptions(scopeSelect(), messages['allowlist.scope.installation']);
  await screen.findByText('defunkt');
  expect(window.location.search).toBe('');
  expect(screen.queryByRole('table', { name: messages['allowlist.inherited.caption'] })).toBeNull();
});

test('a repository in the address that is not among the first listed is a choice named by its id, and the server decides about it', async () => {
  const { served } = await openAllowlist('/installations/5/allowlist?repository=99');
  expect(scopeSelect()).toHaveValue('99');
  expect(within(scopeSelect()).getByRole('option', { name: 'Repository 99' })).toBeInTheDocument();
  expect(served.repositoryList.map(pathOf)).toEqual(['/api/repositories/99/allowlist-entries']);
});

test.each([
  ['a word', 'abc'],
  ['zero', '0'],
  ['a negative number', '-3'],
  ['a decimal', '1.5'],
  ['a list', '1&repository=2'],
])('%s as ?repository= is dropped and the screen shows the whole installation', async (_what, value) => {
  const { served } = await openAllowlist(`/installations/5/allowlist?repository=${value}`);
  expect(scopeSelect()).toHaveValue('');
  expect(served.repositoryList).toEqual([]);
  expect(served.installationList).toHaveLength(1);
});

test('a note says when the tenant has more repositories than the select lists', async () => {
  await openAllowlist(ALLOWLIST_ROUTE, {
    tenants: [{ summary: summary(), answer: () => repositoriesOf([repository(1, 'acme/widgets')], 'more') }],
  });
  expect(screen.getByText('Only the first 100 repositories are listed.')).toBeInTheDocument();
});

test('a repositories list that cannot be read is an error with "Try again", and the whole installation stays a choice', async () => {
  const { user } = await openAllowlist(ALLOWLIST_ROUTE, {
    tenants: [{ summary: summary(), answer: () => githubDown() }],
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.github_unavailable']);
  expect(within(scopeSelect()).getAllByRole('option')).toHaveLength(1);
  expect(screen.getByRole('button', { name: messages['states.retry'] })).toBeEnabled();
  expect(screen.getByText('defunkt')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: messages['states.retry'] }));
});

test('"Show more entries" asks for the next page with its cursor and adds its entries below the others', async () => {
  const { served, user } = await openAllowlist(ALLOWLIST_ROUTE, {
    installationList: [
      installationPage([entryOf()], 'cursor-2'),
      installationPage([entryOf({ id: 2, loginSnapshot: 'hubot', githubId: 77 })]),
    ],
  });
  expect(screen.queryByText('hubot')).toBeNull();
  await user.click(screen.getByRole('button', { name: messages['allowlist.more'] }));
  await screen.findByText('hubot');
  expect(rowsOf(entriesTable()).map((row) => row[1])).toEqual(['defunkt 583231', 'hubot 77']);
  expect(served.installationList.map((seen) => new URL(seen.url).search)).toEqual([
    '?limit=200',
    '?limit=200&cursor=cursor-2',
  ]);
  expect(screen.queryByRole('button', { name: messages['allowlist.more'] })).toBeNull();
});

test('a repository that has more pages keeps own and inherited entries apart across the pages', async () => {
  const { user } = await openAllowlist(REPOSITORY_ROUTE, {
    repositoryList: [
      repositoryPage([repositoryEntryOf({ id: 2, loginSnapshot: 'hubot', githubId: 77 })], [], 'cursor-2'),
      repositoryPage([], [inheritedOf({ id: 3, loginSnapshot: 'monalisa', githubId: 88 })]),
    ],
  });
  await user.click(screen.getByRole('button', { name: messages['allowlist.more'] }));
  await screen.findByText('monalisa');
  expect(rowsOf(entriesTable()).map((row) => row[1])).toEqual(['hubot 77']);
  expect(rowsOf(inheritedTable()).map((row) => row[1])).toEqual(['monalisa 88']);
});

test('a page that cannot be loaded keeps the entries on screen and says so above them, with "Try again"', async () => {
  const { user } = await openAllowlist(ALLOWLIST_ROUTE, {
    installationList: [installationPage([entryOf()], 'cursor-2'), envelope(502, 'github_unavailable')],
  });
  await user.click(screen.getByRole('button', { name: messages['allowlist.more'] }));
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.github_unavailable']);
  expect(screen.getByText('defunkt')).toBeInTheDocument();
});

test('the entries wait for the answer of the server: the screen is loading until then, with no row', async () => {
  serveAllowlist({ installationList: [() => new Promise<Response>(() => undefined)] });
  renderAllowlist(ALLOWLIST_ROUTE);
  await heading(messages['allowlist.title']);
  expect(await screen.findByText(messages['states.loading'])).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('button', { name: messages['allowlist.add'] })).toBeNull();
});

test.each([
  [403, 'forbidden', messages['errors.forbidden'], messages['states.forbidden.title']],
  [404, 'not_found', messages['errors.not_found'], messages['states.error.title']],
  [502, 'github_unavailable', messages['errors.github_unavailable'], messages['states.error.title']],
])(
  'a %i for the entries is the error state of the server, with no entry and no add button',
  async (status, code, text, title) => {
    serveAllowlist({ installationList: [envelope(status, code)] });
    renderAllowlist(ALLOWLIST_ROUTE);
    const state = await screen.findByRole('alert');
    expect(state).toHaveTextContent(text);
    expect(within(state).getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: messages['allowlist.add'] })).toBeNull();
    expect(screen.queryByText('defunkt')).toBeNull();
  },
);

test('503 github_rate_limited counts down before "Try again" works, and no entry is shown', async () => {
  serveAllowlist({ installationList: [envelope(503, 'github_rate_limited', { 'retry-after': '42' })] });
  renderAllowlist(ALLOWLIST_ROUTE);
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.github_rate_limited']);
  expect(screen.getByRole('button', { name: messages['states.retry'] })).toBeDisabled();
  expect(screen.getByText('You can try again in 42 seconds.')).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});

test('while the installation is suspended the add and remove buttons are off, and the banner says why', async () => {
  await openAllowlist(ALLOWLIST_ROUTE, { tenants: [tenantOf(summary({ suspended: true }), 'acme/widgets')] });
  expect(screen.getByText(messages['installation.suspended'])).toBeInTheDocument();
  expect(addButton()).toBeDisabled();
  expect(removeButton('defunkt')).toBeDisabled();
});
