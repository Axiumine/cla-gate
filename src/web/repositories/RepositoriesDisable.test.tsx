// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { held } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  confirmDisable,
  disableButton,
  disableDialog,
  gadgets,
  openRepositories,
  pageOf,
  pathOf,
  repositoriesTable,
  rowOf,
  rowsOf,
  rule,
  switchedTo,
  widgets,
} from './test-support.ts';

// E18-S10: turning the check off. An alert dialog says what it does, the POST is addressed through the repository of the row and carries no
// body, nothing is optimistic, and a refusal is shown in the dialog, which stays open.

const cancel = () => within(disableDialog()).getByRole('button', { name: messages['common.cancel'] });
const status = () => screen.getByText(/^(The CLA check is off|Nothing changed|.* is not in this)/);
const OFF = [pageOf([widgets(), gadgets()]), pageOf([widgets({ enabled: false }), gadgets()])];

test('Disable opens an alert dialog that names the repository and says what it does, and focus starts on Cancel', async () => {
  const { user } = await openRepositories();
  await user.click(disableButton('acme/widgets'));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveAccessibleName(`${messages['repositories.disable.title']} acme/widgets`);
  expect(dialog).toHaveAccessibleDescription(messages['repositories.disable.description']);
  const description = messages['repositories.disable.description'];
  expect(description).toContain('New license/cla checks stop');
  expect(description).toContain('Open pull requests get a neutral result');
  expect(description).toContain('Existing check results and the history of signatures stay');
  expect(cancel()).toHaveFocus();
});

test('Escape does nothing, and Cancel closes the dialog with no request and puts focus back on the Disable button', async () => {
  const { served, user } = await openRepositories();
  await user.click(disableButton('acme/widgets'));
  await screen.findByRole('alertdialog');
  await user.keyboard('{Escape}');
  expect(disableDialog()).toBeInTheDocument();
  await user.click(cancel());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(disableButton('acme/widgets')).toHaveFocus();
  expect(served.disable).toEqual([]);
});

test('Tab stays inside the dialog', async () => {
  const { user } = await openRepositories();
  await user.click(disableButton('acme/widgets'));
  await screen.findByRole('alertdialog');
  for (let step = 0; step < 5; step += 1) {
    await user.tab();
    expect(disableDialog().contains(document.activeElement)).toBe(true);
  }
});

test('confirming sends a POST with no body to the repository of the row, with the CSRF header, asks for the list again, closes, and says so', async () => {
  const { served, user } = await openRepositories(undefined, { list: OFF });
  await user.click(disableButton('acme/widgets'));
  await user.click(confirmDisable());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(served.disable.map((seen) => [seen.method, pathOf(seen)])).toEqual([['POST', '/api/repositories/1/disable']]);
  expect(served.disable[0]?.text).toBe('');
  expect(served.disable[0]?.headers['x-csrf-token']).toBeTruthy();
  expect(served.list).toHaveLength(2);
  expect(rowsOf(repositoriesTable()).map((cells) => cells[1])).toEqual(['Disabled', 'Disabled']);
  expect(status()).toHaveTextContent('The CLA check is off for acme/widgets.');
  expect(within(rowOf('acme/widgets')).getByRole('button', { name: /^Enable/ })).toBeInTheDocument();
});

test('nothing is optimistic and a double click is one request: the dialog stays open and busy while the request is out', async () => {
  const request = held(switchedTo(false));
  const { served, user } = await openRepositories(undefined, { list: OFF, disable: [request.answer] });
  await user.click(disableButton('acme/widgets'));
  await user.dblClick(confirmDisable());
  expect(confirmDisable()).toHaveAttribute('aria-busy', 'true');
  await user.keyboard('{Escape}');
  await user.click(cancel());
  expect(disableDialog()).toBeInTheDocument();
  expect(
    within(screen.getByRole('row', { name: /^acme\/widgets/, hidden: true })).getByText('Enabled'),
  ).toBeInTheDocument();
  request.release();
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(served.disable).toHaveLength(1);
});

test('changed: false is an information message and not an error', async () => {
  const { user } = await openRepositories(undefined, { disable: [switchedTo(false, false)] });
  await user.click(disableButton('acme/widgets'));
  await user.click(confirmDisable());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(status()).toHaveTextContent('Nothing changed for acme/widgets: it already was that way.');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a 403 keeps the dialog open with the forbidden state and no Try again', async () => {
  const { user } = await openRepositories(undefined, { disable: [rule(403, 'forbidden')] });
  await user.click(disableButton('acme/widgets'));
  await user.click(confirmDisable());
  const alert = await within(disableDialog()).findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.forbidden']);
  expect(within(alert).queryByRole('button', { name: messages['states.retry'] })).toBeNull();
  expect(disableDialog()).toBeInTheDocument();
});

test('409 installation_suspended is told in words in the dialog, which stays open', async () => {
  const { served, user } = await openRepositories(undefined, { disable: [rule(409, 'installation_suspended')] });
  await user.click(disableButton('acme/widgets'));
  await user.click(confirmDisable());
  expect(await within(disableDialog()).findByRole('alert')).toHaveTextContent(
    messages['repositories.rule.installation_suspended'],
  );
  expect(served.list).toHaveLength(1);
});

test('GitHub being down is the error state in the dialog, and Try again sends the same request again; reopening forgets the failure', async () => {
  const { served, user } = await openRepositories(undefined, {
    list: OFF,
    disable: [rule(502, 'github_unavailable'), switchedTo(false)],
  });
  await user.click(disableButton('acme/widgets'));
  await user.click(confirmDisable());
  await within(disableDialog()).findByRole('alert');
  await user.click(cancel());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  await user.click(disableButton('acme/widgets'));
  await screen.findByRole('alertdialog');
  expect(within(disableDialog()).queryByRole('alert')).toBeNull();
  await user.click(confirmDisable());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(served.disable).toHaveLength(2);
});

test('Try again in the dialog sends the request again', async () => {
  const { served, user } = await openRepositories(undefined, {
    list: OFF,
    disable: [rule(502, 'github_unavailable'), switchedTo(false)],
  });
  await user.click(disableButton('acme/widgets'));
  await user.click(confirmDisable());
  const alert = await within(disableDialog()).findByRole('alert');
  await user.click(within(alert).getByRole('button', { name: messages['states.retry'] }));
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(served.disable).toHaveLength(2);
});

test('a repository that vanished (404) closes the dialog, is removed by the refetch, and the page says it is gone', async () => {
  const { user } = await openRepositories(undefined, {
    list: [pageOf([widgets(), gadgets()]), pageOf([gadgets()])],
    disable: [envelope(404, 'not_found')],
  });
  await user.click(disableButton('acme/widgets'));
  await user.click(confirmDisable());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(rowsOf(repositoriesTable()).map((row) => row[0])).toEqual(['acme/gadgets']);
  expect(status()).toHaveTextContent('acme/widgets is not in this installation any more.');
});

test('a repository that no longer matches the filter leaves the list after the change, and focus goes to the results', async () => {
  const { user } = await openRepositories('/installations/5/repositories?enabled=true', {
    list: [pageOf([widgets()]), pageOf([])],
  });
  await user.click(disableButton('acme/widgets'));
  await user.click(confirmDisable());
  await screen.findByRole('heading', { level: 3, name: messages['repositories.empty.title'] });
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 2, name: messages['repositories.results.title'] })).toHaveFocus();
  });
});

test('the dialog passes axe', async () => {
  const { user } = await openRepositories();
  await user.click(disableButton('acme/widgets'));
  await screen.findByRole('alertdialog');
  await expectNoA11yViolations(document.body);
});
