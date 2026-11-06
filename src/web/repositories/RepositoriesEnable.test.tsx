// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { held } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { summary } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  attachDialog,
  attachedAs,
  claOf,
  documentSelect,
  enableButton,
  gadgets,
  openRepositories,
  pageOf,
  pathOf,
  repositoriesTable,
  rowOf,
  rowsOf,
  rule,
  saveButton,
  switchedTo,
  widgets,
} from './test-support.ts';

// E18-S10: turning the check on. The POST is addressed through the repository of the row and carries no body; `409 no_active_cla` shows the
// fix with the way to the dialog that attaches a CLA and to the editor; a call that changed nothing is information; nothing is optimistic.

const status = () => screen.getByText(/^(The CLA check is on|Nothing changed|.* is not in this)/);
const cellsOf = (name: string) =>
  within(rowOf(name))
    .getAllByRole('cell')
    .map((cell) => cell.textContent);
const FIX = messages['repositories.rule.no_active_cla'];
const attachFix = () => screen.getByRole('button', { name: messages['repositories.fix.attach'] });

test('Enable sends a POST with no body to the repository of the row, with the CSRF header, asks for the list again, and says so', async () => {
  const { served, user } = await openRepositories(undefined, {
    list: [pageOf([widgets(), gadgets()]), pageOf([widgets(), gadgets({ enabled: true, document: claOf() })])],
  });
  await user.click(enableButton('acme/gadgets'));
  await waitFor(() => {
    expect(cellsOf('acme/gadgets')[1]).toBe('Enabled');
  });
  expect(served.enable.map((seen) => [seen.method, pathOf(seen)])).toEqual([['POST', '/api/repositories/2/enable']]);
  expect(served.enable[0]?.text).toBe('');
  expect(served.enable[0]?.headers['x-csrf-token']).toBeTruthy();
  expect(served.enable[0]?.headers['content-type']).toBeUndefined();
  expect(served.list).toHaveLength(2);
  expect(status()).toHaveTextContent('The CLA check is on for acme/gadgets.');
  expect(within(rowOf('acme/gadgets')).queryByRole('button', { name: /^Enable/ })).toBeNull();
  expect(within(rowOf('acme/gadgets')).getByRole('button', { name: /^Disable/ })).toBeInTheDocument();
});

test('nothing is optimistic and a double click is one request: while it is out the button is busy and the row still says disabled', async () => {
  const request = held(switchedTo(true));
  const { served, user } = await openRepositories(undefined, {
    list: [pageOf([widgets(), gadgets()]), pageOf([widgets(), gadgets({ enabled: true })])],
    enable: [request.answer],
  });
  await user.dblClick(enableButton('acme/gadgets'));
  expect(enableButton('acme/gadgets')).toHaveAttribute('aria-busy', 'true');
  expect(cellsOf('acme/gadgets')[1]).toBe('Disabled');
  request.release();
  await waitFor(() => {
    expect(cellsOf('acme/gadgets')[1]).toBe('Enabled');
  });
  expect(served.enable).toHaveLength(1);
});

test('changed: false is an information message and not an error', async () => {
  const { user } = await openRepositories(undefined, { enable: [switchedTo(true, false)] });
  await user.click(enableButton('acme/gadgets'));
  await waitFor(() => {
    expect(status()).toHaveTextContent('Nothing changed for acme/gadgets: it already was that way.');
  });
  expect(screen.queryByRole('alert')).toBeNull();
});

test('409 no_active_cla shows the fix under the button, "attach a CLA and publish a version first", with the button that opens the dialog and the link to the list of documents when none is attached', async () => {
  const { served, user } = await openRepositories(undefined, { enable: [rule(409, 'no_active_cla')] });
  await user.click(enableButton('acme/gadgets'));
  const alert = await within(rowOf('acme/gadgets')).findByRole('alert');
  expect(alert).toHaveTextContent(FIX);
  expect(FIX).toContain('attach a CLA and publish a version first');
  expect(
    within(rowOf('acme/gadgets')).getByRole('link', { name: messages['repositories.fix.documents'] }),
  ).toHaveAttribute('href', '/installations/5/documents');
  expect(
    within(rowOf('acme/gadgets')).getByRole('button', { name: messages['repositories.fix.attach'] }),
  ).toBeInTheDocument();
  expect(served.list).toHaveLength(1);
  expect(cellsOf('acme/gadgets')[1]).toBe('Disabled');
});

test('when a document is attached but has no published version, the fix links to the editor of that document', async () => {
  const { user } = await openRepositories(undefined, {
    list: [pageOf([gadgets({ document: claOf({ id: 12, name: 'Draft CLA', activeVersion: null }) })])],
    enable: [rule(409, 'no_active_cla')],
  });
  await user.click(enableButton('acme/gadgets'));
  await within(rowOf('acme/gadgets')).findByRole('alert');
  expect(within(rowOf('acme/gadgets')).getByRole('link', { name: messages['repositories.editor'] })).toHaveAttribute(
    'href',
    '/installations/5/documents/12',
  );
});

test('a repo admin is offered the dialog and no link to a screen that would refuse them', async () => {
  const { user } = await openRepositories(undefined, {
    tenants: [{ summary: summary({ role: 'repo_admin' }), answer: () => pageOf([]) }],
    enable: [rule(409, 'no_active_cla')],
  });
  await user.click(enableButton('acme/gadgets'));
  await within(rowOf('acme/gadgets')).findByRole('alert');
  expect(within(rowOf('acme/gadgets')).queryByRole('link')).toBeNull();
  expect(attachFix()).toBeInTheDocument();
});

test('"Attach a CLA" in the fix opens the dialog of that row, and once a CLA is attached the fix that asked for it is gone', async () => {
  const { served, user } = await openRepositories(undefined, {
    list: [pageOf([widgets(), gadgets()]), pageOf([widgets(), gadgets({ document: claOf() })])],
    enable: [rule(409, 'no_active_cla')],
    attach: [attachedAs(11)],
  });
  await user.click(enableButton('acme/gadgets'));
  await within(rowOf('acme/gadgets')).findByRole('alert');
  await user.click(attachFix());
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveAccessibleName(`${messages['repositories.attach.title']} acme/gadgets`);
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  expect(served.documents.map(pathOf)).toEqual(['/api/installations/5/repositories/2/documents']);
  await user.selectOptions(documentSelect(), '11');
  await user.click(saveButton());
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(within(rowOf('acme/gadgets')).queryByRole('alert')).toBeNull();
  expect(cellsOf('acme/gadgets')[2]).toBe('Individual CLA1.0');
});

test('the fix passes axe, and the dialog it opens does too', async () => {
  const { user } = await openRepositories(undefined, { enable: [rule(409, 'no_active_cla')] });
  await user.click(enableButton('acme/gadgets'));
  await within(rowOf('acme/gadgets')).findByRole('alert');
  await expectNoA11yViolations(document.body);
  await user.click(attachFix());
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  await expectNoA11yViolations(document.body);
  expect(attachDialog()).toBeInTheDocument();
});

test('409 installation_suspended is told in words under the button', async () => {
  const { user } = await openRepositories(undefined, { enable: [rule(409, 'installation_suspended')] });
  await user.click(enableButton('acme/gadgets'));
  expect(await within(rowOf('acme/gadgets')).findByRole('alert')).toHaveTextContent(
    messages['repositories.rule.installation_suspended'],
  );
});

test('a 403 under the button is the forbidden state with no Try again', async () => {
  const { user } = await openRepositories(undefined, { enable: [rule(403, 'forbidden')] });
  await user.click(enableButton('acme/gadgets'));
  const alert = await within(rowOf('acme/gadgets')).findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.forbidden']);
  expect(within(alert).queryByRole('button', { name: messages['states.retry'] })).toBeNull();
});

test('GitHub being down is the error state under the button, and Try again sends the same request again', async () => {
  const { served, user } = await openRepositories(undefined, {
    enable: [rule(502, 'github_unavailable'), switchedTo(true)],
    list: [pageOf([widgets(), gadgets()]), pageOf([widgets(), gadgets({ enabled: true })])],
  });
  await user.click(enableButton('acme/gadgets'));
  const alert = await within(rowOf('acme/gadgets')).findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.github_unavailable']);
  await user.click(within(alert).getByRole('button', { name: messages['states.retry'] }));
  await waitFor(() => {
    expect(cellsOf('acme/gadgets')[1]).toBe('Enabled');
  });
  expect(served.enable).toHaveLength(2);
});

test('a repository that vanished (404) is removed by the refetch and the page says it is gone; focus goes to the results', async () => {
  const { user } = await openRepositories(undefined, {
    list: [pageOf([widgets(), gadgets()]), pageOf([widgets()])],
    enable: [envelope(404, 'not_found')],
  });
  await user.click(enableButton('acme/gadgets'));
  await waitFor(() => {
    expect(rowsOf(repositoriesTable()).map((row) => row[0])).toEqual(['acme/widgets']);
  });
  expect(status()).toHaveTextContent('acme/gadgets is not in this installation any more.');
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 2, name: messages['repositories.results.title'] })).toHaveFocus();
  });
});

test('a repository that no longer matches the filter leaves the list after the change, and focus goes to the results', async () => {
  const { user } = await openRepositories('/installations/5/repositories?enabled=false', {
    list: [pageOf([gadgets()]), pageOf([])],
  });
  await user.click(enableButton('acme/gadgets'));
  await screen.findByRole('heading', { level: 3, name: messages['repositories.empty.title'] });
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 2, name: messages['repositories.results.title'] })).toHaveFocus();
  });
  expect(status()).toHaveTextContent('The CLA check is on for acme/gadgets.');
});
