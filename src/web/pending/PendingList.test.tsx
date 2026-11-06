// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  firstOf,
  gadgetsOf,
  HEAD_SHA,
  heading,
  noActiveCla,
  openPending,
  PENDING_ROUTE,
  pageOf,
  paramsOf,
  pathOf,
  pendingOf,
  pendingTable,
  renderPending,
  rowsOf,
  servePending,
  UNLINKED_SHA,
  unlinked,
  unsigned,
} from './test-support.ts';

// E18-S08: the pending list: what a row shows, how each reason is told, the empty state and the help.

test('the list is asked for through the installation in the path, 50 at a time, with no filter', async () => {
  const { served } = await openPending();
  expect(served.pending.map(pathOf)).toEqual(['/api/installations/5/pending-prs']);
  expect(paramsOf(served.pending[0])).toEqual({ limit: '50' });
});

test('a row shows the repository, the pull request, the short head commit in code, the time of the last check and the reasons', async () => {
  await openPending();
  const rows = rowsOf(pendingTable());
  expect(rows).toHaveLength(2);
  expect(rows[0]?.slice(0, 4)).toEqual([
    'acme/widgets',
    messages['pending.pr'].replace('{number}', '45'),
    HEAD_SHA.slice(0, 7),
    '2026-11-04 10:15 UTC',
  ]);
  const first = firstOf(within(pendingTable()).getAllByRole('row').slice(1));
  expect(within(first).getByText(HEAD_SHA.slice(0, 7)).tagName).toBe('CODE');
  expect(within(first).queryByText(HEAD_SHA)).toBeNull();
  expect(rows[1]?.[0]).toBe('acme/gadgets');
});

test('the time of the last check is a time element with the instant in its attribute', async () => {
  await openPending();
  const time = within(pendingTable()).getAllByRole('time')[0];
  expect(time?.getAttribute('datetime')).toBe('2026-11-04T10:15:00.000Z');
});

test('the pull request links to GitHub when the repository name has the shape of one, and the link leaves with noopener and no referrer', async () => {
  await openPending();
  const link = screen.getByRole('link', {
    name: messages['pending.pr.link'].replace('{number}', '45').replace('{repository}', 'acme/widgets'),
  });
  expect(link).toHaveAttribute('href', 'https://github.com/acme/widgets/pull/45');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(link).toHaveTextContent('PR #45');
});

test.each([
  ['a name with a dot segment', 'acme/..'],
  ['a name with a space', 'acme/wid gets'],
  ['no owner', '/widgets'],
  ['a path of three parts', 'acme/widgets/extra'],
  ['a name with a query', 'acme/widgets?x=1'],
  ['an owner with a dot', 'ac.me/widgets'],
])('a pull request of %s is text and no link', async (_what, fullName) => {
  await openPending(PENDING_ROUTE, {
    pending: [pageOf([pendingOf({ repository: { id: 1, fullName }, prNumber: 45 })])],
  });
  const cells = rowsOf(pendingTable())[0];
  expect(cells?.[1]).toBe('PR #45');
  expect(within(pendingTable()).queryByRole('link')).toBeNull();
});

test('an unsigned contributor is told with the login, and one whose account was never seen with the numeric id', async () => {
  await openPending(PENDING_ROUTE, {
    pending: [
      pageOf([pendingOf({ reasons: [unsigned(4711, 'octocat')] }), gadgetsOf({ reasons: [unsigned(583231, null)] })]),
    ],
  });
  const rows = rowsOf(pendingTable());
  expect(rows[0]?.[4]).toBe(`${messages['pending.reason.unsigned_contributor']} octocat`);
  expect(rows[1]?.[4]).toBe(
    `${messages['pending.reason.unsigned_contributor']} ${messages['pending.account.unseen'].replace('{id}', '583231')}`,
  );
});

test('every reason code has its words: the bot, the unlinked identity with the commit, no active CLA, too many commits and any other', async () => {
  const reasons = [
    { code: 'bot_not_allowlisted', githubId: 8, login: 'dependabot[bot]' },
    unlinked(),
    noActiveCla,
    { code: 'commit_limit_exceeded' },
    { code: 'other' },
  ] as const;
  await openPending(PENDING_ROUTE, { pending: [pageOf([pendingOf({ reasons: [...reasons] })])] });
  const items = within(pendingTable()).getAllByRole('listitem');
  expect(items.map((item) => item.textContent.replace(messages['pending.override'], '').trim())).toEqual([
    `${messages['pending.reason.bot_not_allowlisted']} dependabot[bot]`,
    `${messages['pending.reason.unlinked_identity']} ${UNLINKED_SHA}`,
    messages['pending.reason.no_active_cla'],
    messages['pending.reason.commit_limit_exceeded'],
    messages['pending.reason.other'],
  ]);
  expect(within(firstOf(items.slice(1))).getByText(UNLINKED_SHA).tagName).toBe('CODE');
});

test('a reason that names an account the list gives no id for shows its words and nothing after them', async () => {
  await openPending(PENDING_ROUTE, { pending: [pageOf([pendingOf({ reasons: [{ code: 'unsigned_contributor' }] })])] });
  expect(within(pendingTable()).getByRole('listitem')).toHaveTextContent(
    messages['pending.reason.unsigned_contributor'],
  );
  expect(within(pendingTable()).queryByRole('button')).toBeNull();
});

test('only a reason of an unlinked identity has "Record override", and one without a commit has none', async () => {
  await openPending(PENDING_ROUTE, {
    pending: [
      pageOf([
        pendingOf({ reasons: [unsigned(4711, 'octocat'), unlinked(), unlinked('b'.repeat(40))] }),
        gadgetsOf({ reasons: [{ code: 'unlinked_identity' }, noActiveCla] }),
      ]),
    ],
  });
  const buttons = within(pendingTable()).getAllByRole('button');
  expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
    messages['pending.override.label']
      .replace('{commit}', UNLINKED_SHA.slice(0, 7))
      .replace('{repository}', 'acme/widgets'),
    messages['pending.override.label'].replace('{commit}', 'bbbbbbb').replace('{repository}', 'acme/widgets'),
  ]);
});

test('the help says that there is no button to check again, that signatures, overrides and allowlist changes do it, and that /recheck can be commented', async () => {
  await openPending();
  expect(screen.getByText(messages['pending.help'])).toBeInTheDocument();
  expect(messages['pending.help']).toContain('/recheck');
  expect(messages['pending.help']).toContain('signature');
  expect(messages['pending.help']).toContain('override');
  expect(messages['pending.help']).toContain('allowlist');
  expect(screen.queryByRole('button', { name: /re-?evaluate|check again|recheck/i })).toBeNull();
});

test('the page has one h1, the tabs, and the pending tab is the one that is open', async () => {
  await openPending();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  const tabs = within(screen.getByRole('tablist', { name: messages['pending.tabs.label'] })).getAllByRole('tab');
  expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([
    [messages['pending.tab.pending'], 'true'],
    [messages['pending.tab.overrides'], 'false'],
  ]);
  expect(document.title).toBe(`${messages['pending.title']}: acme · CLA`);
});

test('the count of pull requests on the page is in a polite live region', async () => {
  await openPending();
  expect(await screen.findByText(messages['pending.count.other'].replace('{count}', '2'))).toHaveAttribute(
    'aria-live',
    'polite',
  );
});

test('one pull request is counted in the singular', async () => {
  await openPending(PENDING_ROUTE, { pending: [pageOf([pendingOf()])] });
  expect(await screen.findByText(messages['pending.count.one'].replace('{count}', '1'))).toBeInTheDocument();
});

test('no pending pull request is the empty state of the catalog', async () => {
  servePending({ pending: [pageOf([])] });
  renderPending(PENDING_ROUTE);
  await heading(messages['pending.title']);
  expect(await screen.findByRole('heading', { level: 3, name: messages['pending.empty.title'] })).toBeInTheDocument();
  expect(screen.getByText('Every open pull request is covered or exempt.')).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('navigation', { name: messages['pager.label'] })).toBeNull();
});

test('a response that says truncated is told in a notice, and one that does not has none', async () => {
  await openPending(PENDING_ROUTE, { pending: [pageOf([pendingOf()], null, true)] });
  expect(await screen.findByText(messages['pending.truncated'])).toBeInTheDocument();
});

test('a complete response has no truncation notice', async () => {
  await openPending();
  expect(screen.queryByText(messages['pending.truncated'])).toBeNull();
});

test('the list passes axe, with its table, its filters and the tabs', async () => {
  await openPending();
  await expectNoA11yViolations(document.body);
});
