// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { held } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  ALLOWLIST_ROUTE,
  entriesTable,
  entryOf,
  installationPage,
  openAllowlist,
  pathOf,
  REPOSITORY_ROUTE,
  removeButton,
  removeDialog,
  repositoryEntryOf,
  repositoryPage,
  rowsOf,
} from './test-support.ts';

// E18-S06: removing an entry: a question that names it, one request to the installation of the address, and every outcome.

const FIRST = entryOf();
const TWO = [FIRST, entryOf({ id: 2, loginSnapshot: 'hubot', githubId: 77 })];
const NO_CONTENT = new Response(null, { status: 204 });
const confirm = () => within(removeDialog()).getByRole('button', { name: messages['allowlist.remove.confirm'] });
const cancel = () => within(removeDialog()).getByRole('button', { name: messages['common.cancel'] });

test('each row has a button that names its account, and the question names the entry, what stops, who added it and when', async () => {
  const { user } = await openAllowlist(ALLOWLIST_ROUTE, { installationList: [installationPage(TWO)] });
  expect(removeButton('defunkt')).toBeInTheDocument();
  expect(removeButton('hubot')).toBeInTheDocument();
  await user.click(removeButton('hubot'));
  const question = await screen.findByRole('alertdialog', { name: `${messages['allowlist.remove.title']} hubot` });
  expect(question).toHaveAccessibleDescription(messages['allowlist.remove.description.account']);
  expect(question).toHaveTextContent('Added by alice, 2026-10-01 09:30 UTC');
  expect(cancel()).toHaveFocus();
});

test('the question for the members of an organisation says that the members stop being exempt', async () => {
  const { user } = await openAllowlist(ALLOWLIST_ROUTE, {
    installationList: [installationPage([entryOf({ kind: 'org_members', loginSnapshot: 'acme', githubId: 1234 })])],
  });
  await user.click(removeButton('acme'));
  expect(await screen.findByRole('alertdialog')).toHaveAccessibleDescription(
    messages['allowlist.remove.description.orgMembers'],
  );
});

test('the question of an entry with no login snapshot names it as not recorded', async () => {
  const { user } = await openAllowlist(ALLOWLIST_ROUTE, {
    installationList: [installationPage([entryOf({ loginSnapshot: null })])],
  });
  await user.click(removeButton(messages['allowlist.subject.unknownLogin']));
  expect(await screen.findByRole('alertdialog')).toHaveAccessibleName(
    `${messages['allowlist.remove.title']} ${messages['allowlist.subject.unknownLogin']}`,
  );
});

test('Escape and a click outside do nothing, Cancel closes the question with no request, and focus returns to the row button', async () => {
  const { served, user } = await openAllowlist(ALLOWLIST_ROUTE, { installationList: [installationPage(TWO)] });
  await user.click(removeButton('hubot'));
  await screen.findByRole('alertdialog');
  await user.keyboard('{Escape}');
  expect(removeDialog()).toBeInTheDocument();
  await user.click(cancel());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(served.remove).toEqual([]);
  expect(removeButton('hubot')).toHaveFocus();
});

test('confirming sends one DELETE for that entry to the installation of the address; the row goes when the list is asked for again, and the heading takes focus', async () => {
  const { served, user } = await openAllowlist(ALLOWLIST_ROUTE, {
    installationList: [installationPage(TWO), installationPage([FIRST])],
    remove: [NO_CONTENT],
  });
  await user.click(removeButton('hubot'));
  await user.click(await screen.findByRole('button', { name: messages['allowlist.remove.confirm'] }));
  await waitFor(() => {
    expect(rowsOf(entriesTable())).toHaveLength(1);
  });
  expect(served.remove.map((seen) => [seen.method, pathOf(seen)])).toEqual([
    ['DELETE', '/api/installations/5/allowlist-entries/2'],
  ]);
  expect(served.installationList).toHaveLength(2);
  expect(screen.getByText(messages['allowlist.notice.removed'])).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: messages['allowlist.entries.title'] })).toHaveFocus();
});

test('removing the last entry leaves the empty state', async () => {
  const { user } = await openAllowlist(ALLOWLIST_ROUTE, {
    installationList: [installationPage([entryOf()]), installationPage([])],
  });
  await user.click(removeButton('defunkt'));
  await user.click(await screen.findByRole('button', { name: messages['allowlist.remove.confirm'] }));
  expect(await screen.findByRole('heading', { level: 3, name: messages['allowlist.empty.title'] })).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});

test('an entry of a repository is removed through the installation of the address, with its own id', async () => {
  const { served, user } = await openAllowlist(REPOSITORY_ROUTE, {
    repositoryList: [repositoryPage([repositoryEntryOf({ id: 2, loginSnapshot: 'hubot', githubId: 77 })], [])],
  });
  await user.click(removeButton('hubot'));
  await user.click(await screen.findByRole('button', { name: messages['allowlist.remove.confirm'] }));
  await waitFor(() => {
    expect(served.remove).toHaveLength(1);
  });
  expect(served.remove.map(pathOf)).toEqual(['/api/installations/5/allowlist-entries/2']);
});

test('the button is busy while the request is out, and a second confirmation of the same question sends no second request', async () => {
  const gate = held(NO_CONTENT);
  const { served, user } = await openAllowlist(ALLOWLIST_ROUTE, {
    installationList: [installationPage(TWO)],
    remove: [gate.answer],
  });
  await user.click(removeButton('hubot'));
  await user.click(await screen.findByRole('button', { name: messages['allowlist.remove.confirm'] }));
  await waitFor(() => {
    expect(removeButton('hubot')).toHaveAttribute('aria-busy', 'true');
  });
  await user.click(removeButton('hubot'));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(served.remove).toHaveLength(1);
  gate.release();
  await waitFor(() => {
    expect(removeButton('hubot')).not.toHaveAttribute('aria-busy');
  });
});

test('404: an entry that is gone shows an info message in the live region, asks for the list again, and is no error', async () => {
  const { served, user } = await openAllowlist(ALLOWLIST_ROUTE, {
    installationList: [installationPage(TWO), installationPage([FIRST])],
    remove: [envelope(404, 'not_found')],
  });
  await user.click(removeButton('hubot'));
  await user.click(await screen.findByRole('button', { name: messages['allowlist.remove.confirm'] }));
  const notice = await screen.findByText(messages['allowlist.notice.gone']);
  expect(notice.closest('[role="status"]')).not.toBeNull();
  await waitFor(() => {
    expect(rowsOf(entriesTable())).toHaveLength(1);
  });
  expect(served.installationList).toHaveLength(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

test.each([
  ['403', 403, 'forbidden', messages['errors.forbidden']],
  ['502', 502, 'github_unavailable', messages['errors.github_unavailable']],
  ['500', 500, 'internal_server_error', messages['errors.internal_server_error']],
])(
  '%s on a removal is the error state above the list, which keeps its rows and is not asked for again',
  async (_what, status, code, text) => {
    const { served, user } = await openAllowlist(ALLOWLIST_ROUTE, {
      installationList: [installationPage(TWO)],
      remove: [envelope(status, code)],
    });
    await user.click(removeButton('hubot'));
    await user.click(await screen.findByRole('button', { name: messages['allowlist.remove.confirm'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(rowsOf(entriesTable())).toHaveLength(2);
    expect(served.installationList).toHaveLength(1);
    expect(screen.queryByText(messages['allowlist.notice.removed'])).toBeNull();
  },
);

test('a new attempt takes the error away', async () => {
  const { user } = await openAllowlist(ALLOWLIST_ROUTE, {
    installationList: [installationPage(TWO), installationPage([FIRST])],
    remove: [envelope(502, 'github_unavailable'), NO_CONTENT],
  });
  await user.click(removeButton('hubot'));
  await user.click(await screen.findByRole('button', { name: messages['allowlist.remove.confirm'] }));
  await screen.findByRole('alert');
  await user.click(removeButton('hubot'));
  await user.click(await screen.findByRole('button', { name: messages['allowlist.remove.confirm'] }));
  await waitFor(() => {
    expect(screen.queryByRole('alert')).toBeNull();
  });
  await screen.findByText(messages['allowlist.notice.removed']);
});

test('axe passes on the question of a removal', async () => {
  const { user } = await openAllowlist(ALLOWLIST_ROUTE, { installationList: [installationPage(TWO)] });
  await user.click(removeButton('hubot'));
  await screen.findByRole('alertdialog');
  await expectNoA11yViolations(document.body);
});

test('the question is keyboard-complete: Enter opens it, Tab moves between its two buttons, and Enter on Remove entry confirms', async () => {
  const { served, user } = await openAllowlist(ALLOWLIST_ROUTE, { installationList: [installationPage(TWO)] });
  removeButton('hubot').focus();
  await user.keyboard('{Enter}');
  await screen.findByRole('alertdialog');
  expect(cancel()).toHaveFocus();
  await user.tab();
  expect(confirm()).toHaveFocus();
  await user.tab();
  expect(cancel()).toHaveFocus();
  await user.tab();
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(served.remove).toHaveLength(1);
  });
});
