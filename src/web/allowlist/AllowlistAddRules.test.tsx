// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { held } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { summary, tenantOf } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  ALLOWLIST_ROUTE,
  addButton,
  addDialog,
  bodyOf,
  entryOf,
  installationPage,
  kindRadio,
  loginField,
  openAllowlist,
  REPOSITORY_ROUTE,
  refused,
  repositoryEntryOf,
  repositoryPage,
  storedAs,
  submitButton,
} from './test-support.ts';

// E18-S06: the rules of the server in the add dialog, each where the person was typing or in the dialog, and the question that comes
// before the members of an organisation.

/** Opens the add dialog of the screen at `route` and types the login `typed`. */
async function typeLogin(typed: string, serve: Parameters<typeof openAllowlist>[1], route = ALLOWLIST_ROUTE) {
  const opened = await openAllowlist(route, serve);
  await opened.user.click(addButton());
  await screen.findByRole('dialog', { name: messages['allowlist.add.title'] });
  await opened.user.type(loginField(), typed);
  return opened;
}

test.each([
  ['github_account_not_found', 422],
  ['kind_mismatch', 422],
] as const)(
  '422 %s is shown under the login field, which keeps what was typed, with the dialog still open',
  async (code, status) => {
    const { user } = await typeLogin('someone', { add: [refused(code, status)] });
    await user.click(submitButton());
    const words = messages[`allowlist.rule.${code}`];
    const error = await within(addDialog()).findByText(words);
    expect(error).toHaveAttribute('role', 'alert');
    expect(loginField()).toHaveAttribute('aria-invalid', 'true');
    expect(loginField()).toHaveAccessibleDescription(`${messages['allowlist.add.loginHelp']} ${words}`);
    expect(loginField()).toHaveValue('someone');
  },
);

test('kind_mismatch points an organisation to the members of the organisation', async () => {
  const { user } = await typeLogin('acme', { add: [refused('kind_mismatch')] });
  await user.click(submitButton());
  expect(await within(addDialog()).findByText(messages['allowlist.rule.kind_mismatch'])).toHaveTextContent(
    `"${messages['allowlist.kind.org_members']}"`,
  );
});

test('editing the login or the kind clears what the server said', async () => {
  const { user } = await typeLogin('someone', { add: [refused('github_account_not_found'), storedAs()] });
  await user.click(submitButton());
  await within(addDialog()).findByText(messages['allowlist.rule.github_account_not_found']);
  await user.type(loginField(), 'x');
  expect(within(addDialog()).queryByText(messages['allowlist.rule.github_account_not_found'])).toBeNull();
  await user.click(submitButton());
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

test('409 allowlist_entry_exists is an inline error in the dialog, and no row is added', async () => {
  const { served, user } = await typeLogin('defunkt', { add: [refused('allowlist_entry_exists', 409)] });
  await user.click(submitButton());
  const error = await within(addDialog()).findByText(messages['allowlist.rule.allowlist_entry_exists']);
  expect(error.closest('[role="alert"]')).not.toBeNull();
  expect(served.installationList).toHaveLength(1);
  expect(screen.getAllByText('defunkt')).toHaveLength(1);
});

test('422 no_organization is told in the dialog', async () => {
  const { user } = await typeLogin('someone', { add: [refused('no_organization')] });
  await user.click(submitButton());
  expect(await within(addDialog()).findByText(messages['allowlist.rule.no_organization'])).toBeInTheDocument();
});

test('422 members_permission_missing explains how to accept the new permissions, and "Try again" sends the same entry again', async () => {
  const { served, user } = await openAllowlist(ALLOWLIST_ROUTE, {
    add: [refused('members_permission_missing'), storedAs({ kind: 'org_members', loginSnapshot: 'acme' })],
  });
  await user.click(addButton());
  await user.click(kindRadio(messages['allowlist.kind.org_members']));
  await user.click(submitButton());
  await user.click(await screen.findByRole('button', { name: messages['allowlist.orgMembers.confirm'] }));
  const alert = await within(addDialog()).findByText(messages['allowlist.rule.members_permission_missing']);
  expect(alert).toHaveTextContent('accept the updated permissions');
  await user.click(within(addDialog()).getByRole('button', { name: messages['states.retry'] }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(served.addInstallation.map(bodyOf)).toEqual([{ kind: 'org_members' }, { kind: 'org_members' }]);
});

test('502 is the error state of the dialog with its request id, "Try again" sends the same entry again, and the typed login stays', async () => {
  const { served, user } = await typeLogin('someone', { add: [envelope(502, 'github_unavailable'), storedAs()] });
  await user.click(submitButton());
  const state = await within(addDialog()).findByRole('alert');
  expect(state).toHaveTextContent(messages['errors.github_unavailable']);
  expect(state).toHaveTextContent('req-00000001');
  expect(loginField()).toHaveValue('someone');
  await user.click(within(state).getByRole('button', { name: messages['states.retry'] }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(served.addInstallation.map(bodyOf)).toEqual([
    { kind: 'user', login: 'someone' },
    { kind: 'user', login: 'someone' },
  ]);
});

test('503 github_rate_limited counts down before "Try again" works', async () => {
  const { user } = await typeLogin('someone', {
    add: [envelope(503, 'github_rate_limited', { 'retry-after': '30' })],
  });
  await user.click(submitButton());
  const state = await within(addDialog()).findByRole('alert');
  expect(state).toHaveTextContent(messages['errors.github_rate_limited']);
  expect(within(state).getByRole('button', { name: messages['states.retry'] })).toBeDisabled();
  expect(within(state).getByText('You can try again in 30 seconds.')).toBeInTheDocument();
});

test('403 is the forbidden state in the dialog, which stays open with no retry', async () => {
  const { user } = await typeLogin('someone', { add: [envelope(403, 'forbidden')] });
  await user.click(submitButton());
  const state = await within(addDialog()).findByRole('alert');
  expect(state).toHaveTextContent(messages['errors.forbidden']);
  expect(within(state).queryByRole('button', { name: messages['states.retry'] })).toBeNull();
  expect(loginField()).toHaveValue('someone');
});

test('a rule code that comes with another status is not taken for the rule: it is the general error state', async () => {
  const { user } = await typeLogin('someone', { add: [envelope(500, 'github_account_not_found')] });
  await user.click(submitButton());
  const state = await within(addDialog()).findByRole('alert');
  expect(state).toHaveTextContent(messages['errors.unknown']);
  expect(within(addDialog()).queryByText(messages['allowlist.rule.github_account_not_found'])).toBeNull();
});

test('the button is busy while the request is out, and Enter pressed twice sends one request', async () => {
  const gate = held(storedAs());
  const { served, user } = await typeLogin('someone', { add: [gate.answer] });
  await user.keyboard('{Enter}{Enter}');
  await waitFor(() => {
    expect(submitButton()).toHaveAttribute('aria-busy', 'true');
  });
  expect(served.addInstallation).toHaveLength(1);
  gate.release();
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(served.addInstallation).toHaveLength(1);
});

test('the members of the organisation take no login and ask a question first; Cancel sends nothing', async () => {
  const { served, user } = await openAllowlist(ALLOWLIST_ROUTE);
  await user.click(addButton());
  await user.click(kindRadio(messages['allowlist.kind.org_members']));
  expect(within(addDialog()).queryByRole('textbox')).toBeNull();
  await user.click(submitButton());
  const question = await screen.findByRole('alertdialog', { name: messages['allowlist.orgMembers.title'] });
  expect(question).toHaveAccessibleDescription(messages['allowlist.orgMembers.description']);
  expect(question).toHaveTextContent('current and future member');
  expect(question).toHaveTextContent('including private members');
  expect(within(question).getByRole('button', { name: messages['common.cancel'] })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  await user.click(within(question).getByRole('button', { name: messages['common.cancel'] }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(served.addInstallation).toEqual([]);
  expect(addDialog()).toBeInTheDocument();
});

test('confirming the question sends the members of the organisation to the scope of the screen and closes both', async () => {
  const { served, user } = await openAllowlist(REPOSITORY_ROUTE, {
    add: [storedAs({ scope: 'repository', repositoryId: 1, kind: 'org_members', loginSnapshot: 'acme' })],
  });
  await user.click(addButton());
  await user.click(kindRadio(messages['allowlist.kind.org_members']));
  await user.click(submitButton());
  await user.click(await screen.findByRole('button', { name: messages['allowlist.orgMembers.confirm'] }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(served.addRepository.map(bodyOf)).toEqual([{ kind: 'org_members' }]);
  expect(served.addInstallation).toEqual([]);
  expect(addButton()).toHaveFocus();
});

test('the members of the organisation are not offered for the installation of a user account, and the dialog says why', async () => {
  const { user } = await openAllowlist(ALLOWLIST_ROUTE, {
    tenants: [tenantOf(summary({ accountType: 'User' }), 'acme/widgets')],
  });
  await user.click(addButton());
  expect(kindRadio(messages['allowlist.kind.org_members'])).toBeDisabled();
  expect(addDialog()).toHaveTextContent(messages['allowlist.add.orgMembers.userAccount']);
});

test('the members of the organisation are offered once per scope: with one listed the choice is disabled and says so', async () => {
  const { user } = await openAllowlist(ALLOWLIST_ROUTE, {
    installationList: [installationPage([entryOf({ kind: 'org_members', loginSnapshot: 'acme', githubId: 1234 })])],
  });
  await user.click(addButton());
  expect(kindRadio(messages['allowlist.kind.org_members'])).toBeDisabled();
  expect(addDialog()).toHaveTextContent(messages['allowlist.add.orgMembers.exists']);
});

test('the members of the installation count for the installation only: a repository can still have its own', async () => {
  const { user } = await openAllowlist(REPOSITORY_ROUTE, {
    repositoryList: [
      repositoryPage(
        [repositoryEntryOf()],
        [entryOf({ id: 8, kind: 'org_members', loginSnapshot: 'acme', readOnly: true })],
      ),
    ],
  });
  await user.click(addButton());
  expect(kindRadio(messages['allowlist.kind.org_members'])).toBeEnabled();
});

test('the dialog is keyboard-complete: it opens with Enter, Tab stays inside, Escape closes it, and focus returns to the button', async () => {
  const { user } = await openAllowlist(ALLOWLIST_ROUTE);
  addButton().focus();
  await user.keyboard('{Enter}');
  const dialog = await screen.findByRole('dialog', { name: messages['allowlist.add.title'] });
  const inside = [
    kindRadio(messages['allowlist.kind.user']),
    loginField(),
    within(dialog).getByRole('button', { name: messages['common.cancel'] }),
    submitButton(),
    within(dialog).getByRole('button', { name: messages['common.close'] }),
    kindRadio(messages['allowlist.kind.user']),
  ];
  expect(inside[0]).toHaveFocus();
  for (const element of inside.slice(1)) {
    await user.tab();
    expect(element).toHaveFocus();
  }
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(addButton()).toHaveFocus();
});

test('axe passes on the open dialog, with a refusal shown, and on the question', async () => {
  const { user } = await openAllowlist(ALLOWLIST_ROUTE);
  await user.click(addButton());
  await user.click(submitButton());
  await within(addDialog()).findByText(messages['allowlist.rule.invalid_login']);
  await expectNoA11yViolations(document.body);
  await user.click(kindRadio(messages['allowlist.kind.org_members']));
  await user.click(submitButton());
  await screen.findByRole('alertdialog');
  await expectNoA11yViolations(document.body);
});
