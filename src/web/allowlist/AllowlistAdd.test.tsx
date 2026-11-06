// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { watchDefault } from '../test-support/default-prevented.ts';
import {
  ALLOWLIST_ROUTE,
  addButton,
  addDialog,
  bodyOf,
  entriesTable,
  entryOf,
  installationPage,
  kindRadio,
  loginField,
  openAllowlist,
  pathOf,
  REPOSITORY_ROUTE,
  rowsOf,
  storedAs,
  submitButton,
} from './test-support.ts';

// E18-S06: the add dialog: one request per scope, and the login checked before it. The rules of the server and the members of the
// organisation are in AllowlistAddRules.test.tsx.

/** Opens the add dialog of the screen at `route`. */
async function openDialog(route = ALLOWLIST_ROUTE, serve: Parameters<typeof openAllowlist>[1] = {}) {
  const opened = await openAllowlist(route, serve);
  await opened.user.click(addButton());
  await screen.findByRole('dialog', { name: messages['allowlist.add.title'] });
  return opened;
}

test('the dialog has the kind, with the user chosen, and one required login field: no look-up step and no email field', async () => {
  await openDialog();
  expect(kindRadio(messages['allowlist.kind.user'])).toBeChecked();
  expect(kindRadio(messages['allowlist.kind.bot'])).not.toBeChecked();
  expect(kindRadio(messages['allowlist.kind.org_members'])).toBeEnabled();
  expect(loginField()).toHaveValue('');
  expect(loginField()).toHaveAccessibleDescription(messages['allowlist.add.loginHelp']);
  expect(within(addDialog()).getAllByRole('textbox')).toHaveLength(1);
  expect(within(addDialog()).queryByRole('button', { name: /look/i })).toBeNull();
  expect(addDialog()).toHaveAccessibleDescription(messages['allowlist.add.description']);
});

test('adding a user to the installation sends one request to that installation, closes the dialog, and the new row shows the stored login and numeric id', async () => {
  const watch = watchDefault('submit');
  const { served, user } = await openDialog(ALLOWLIST_ROUTE, {
    installationList: [
      installationPage([entryOf()]),
      installationPage([entryOf(), entryOf({ id: 90, loginSnapshot: 'New-User', githubId: 9001 })]),
    ],
    add: [storedAs({ loginSnapshot: 'New-User', githubId: 9001 })],
  });
  await user.type(loginField(), 'new-user');
  await user.click(submitButton());
  await screen.findByText('New-User');
  expect(served.addInstallation.map((seen) => [seen.method, pathOf(seen)])).toEqual([
    ['POST', '/api/installations/5/allowlist-entries'],
  ]);
  expect(served.addInstallation.map(bodyOf)).toEqual([{ kind: 'user', login: 'new-user' }]);
  expect(served.addRepository).toEqual([]);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(rowsOf(entriesTable()).map((row) => row[1])).toEqual(['defunkt 583231', 'New-User 9001']);
  expect(screen.getByText(messages['allowlist.notice.added'])).toBeInTheDocument();
  expect(addButton()).toHaveFocus();
  expect(watch.prevented).toEqual([true]);
});

test('adding to a repository sends one request to that repository, and the list of the repository is asked for again', async () => {
  const { served, user } = await openDialog(REPOSITORY_ROUTE);
  await user.type(loginField(), 'hubot');
  await user.click(submitButton());
  await waitFor(() => {
    expect(served.repositoryList).toHaveLength(2);
  });
  expect(served.addRepository.map((seen) => [seen.method, pathOf(seen)])).toEqual([
    ['POST', '/api/repositories/1/allowlist-entries'],
  ]);
  expect(served.addRepository.map(bodyOf)).toEqual([{ kind: 'user', login: 'hubot' }]);
  expect(served.addInstallation).toEqual([]);
});

test('a bot is added with the kind bot and its login, and the login is trimmed', async () => {
  const { served, user } = await openDialog();
  await user.click(kindRadio(messages['allowlist.kind.bot']));
  await user.click(loginField());
  await user.paste('  dependabot[bot] ');
  await user.click(submitButton());
  await waitFor(() => {
    expect(served.addInstallation).toHaveLength(1);
  });
  expect(served.addInstallation.map(bodyOf)).toEqual([{ kind: 'bot', login: 'dependabot[bot]' }]);
});

test.each([
  ['nothing', ''],
  ['spaces only', '   '],
  ['a space inside', 'two words'],
  ['a leading hyphen', '-octo'],
  ['an at sign', '@octocat'],
  ['a slash', 'acme/widgets'],
  ['markup', '<script>alert(1)</script>'],
  ['40 characters', 'a'.repeat(40)],
  ['[bot] in the middle', 'dep[bot]abot'],
])('%s is not a login: it is refused under the field and nothing is sent', async (_what, text) => {
  const { served, user } = await openDialog();
  await user.click(loginField());
  await user.paste(text);
  await user.click(submitButton());
  expect(await within(addDialog()).findByText(messages['allowlist.rule.invalid_login'])).toHaveAttribute(
    'role',
    'alert',
  );
  expect(loginField()).toHaveAttribute('aria-invalid', 'true');
  expect(served.addInstallation).toEqual([]);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('typing again clears the refusal of the login', async () => {
  const { user } = await openDialog();
  await user.click(submitButton());
  await within(addDialog()).findByText(messages['allowlist.rule.invalid_login']);
  await user.type(loginField(), 'a');
  expect(within(addDialog()).queryByText(messages['allowlist.rule.invalid_login'])).toBeNull();
});
