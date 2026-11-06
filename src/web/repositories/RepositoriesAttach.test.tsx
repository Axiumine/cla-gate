// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { held } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { watchDefault } from '../test-support/default-prevented.ts';
import {
  attachButton,
  attachDialog,
  attachedAs,
  bodyOf,
  changeButton,
  claOf,
  documentSelect,
  documentsOf,
  gadgets,
  installationDocument,
  openRepositories,
  pageOf,
  pathOf,
  repositoriesTable,
  repositoryDocument,
  rowOf,
  rowsOf,
  saveButton,
  widgets,
} from './test-support.ts';

// E18-S10: attaching a CLA document to a repository, and detaching it: the dialog, the select fed by the documents of the repository, the
// PUT addressed through the repository of the row, and the list that is asked for again. Nothing is optimistic.

const cells = (name: string) =>
  within(rowOf(name))
    .getAllByRole('cell')
    .map((cell) => cell.textContent);
/** The cells of a row while a dialog is open, when the rest of the page is hidden from assistive technology. */
const hiddenCells = (name: string) =>
  within(screen.getByRole('row', { name: (accessibleName) => accessibleName.startsWith(name), hidden: true }))
    .getAllByRole('cell', { hidden: true })
    .map((cell) => cell.textContent);
const status = () => screen.getByText(/^(A CLA is attached|The CLA is detached|Nothing changed|.* is not in this)/);

test('Attach CLA opens a dialog named after the repository, with the documents of that repository asked for through the installation and the repository of the row', async () => {
  const { served, user } = await openRepositories();
  await user.click(attachButton('acme/gadgets'));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveAccessibleName(`${messages['repositories.attach.title']} acme/gadgets`);
  expect(dialog).toHaveAccessibleDescription(messages['repositories.attach.description']);
  await waitFor(() => {
    expect(served.documents).toHaveLength(1);
  });
  expect(served.documents[0]?.method).toBe('GET');
  expect(pathOf(served.documents[0])).toBe('/api/installations/5/repositories/2/documents');
});

test("the select offers no CLA, then the repository's own documents, then those of the installation, each with its version and where it applies, and the text is never asked for", async () => {
  const { served, user } = await openRepositories(undefined, {
    documents: [
      documentsOf({
        repositoryScoped: [repositoryDocument(21, 'Gadgets CLA', { major: 2, minor: 3 })],
        installationScoped: [
          installationDocument(11, 'Individual CLA', { major: 1, minor: 0 }),
          installationDocument(12, 'Draft', null),
        ],
      }),
    ],
  });
  await user.click(attachButton('acme/gadgets'));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  expect(
    within(documentSelect())
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual([
    'No CLA (detach)',
    'Gadgets CLA (2.3), this repository only',
    'Individual CLA (1.0), whole installation',
    'Draft (not published), whole installation',
  ]);
  expect(served.documents.map(pathOf)).toEqual(['/api/installations/5/repositories/2/documents']);
});

test('a repository with no document starts on no CLA, and one with a document starts on that document', async () => {
  const { user } = await openRepositories();
  await user.click(attachButton('acme/gadgets'));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  expect(documentSelect()).toHaveValue('none');
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  await user.click(changeButton('acme/widgets'));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  expect(documentSelect()).toHaveValue('11');
});

test('the document a repository has is a choice even when the documents of the repository do not list it', async () => {
  const { user } = await openRepositories(undefined, {
    list: [pageOf([widgets({ document: claOf({ id: 99, name: 'Corporate CLA' }) })])],
    documents: [
      documentsOf({ installationScoped: [installationDocument(11, 'Individual CLA', { major: 1, minor: 0 })] }),
    ],
  });
  await user.click(changeButton('acme/widgets'));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  expect(documentSelect()).toHaveValue('99');
  expect(
    within(documentSelect()).getByRole('option', { name: 'Corporate CLA (1.0), whole installation' }),
  ).toBeInTheDocument();
});

test('Save sends a PUT to the repository of the row with the chosen document and the CSRF header, asks for the list again, closes, and says so', async () => {
  const watch = watchDefault('submit');
  const { served, user } = await openRepositories(undefined, {
    list: [pageOf([widgets(), gadgets()]), pageOf([widgets(), gadgets({ document: claOf() })])],
  });
  await user.click(attachButton('acme/gadgets'));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  await user.selectOptions(documentSelect(), 'Individual CLA (1.0), whole installation');
  await user.click(saveButton());
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(served.attach.map((seen) => [seen.method, pathOf(seen)])).toEqual([
    ['PUT', '/api/repositories/2/cla-document'],
  ]);
  expect(bodyOf(served.attach[0])).toEqual({ documentId: 11 });
  expect(served.attach[0]?.headers['x-csrf-token']).toBeTruthy();
  expect(served.list).toHaveLength(2);
  expect(cells('acme/gadgets').slice(0, 3)).toEqual(['acme/gadgets', 'Disabled', 'Individual CLA1.0']);
  expect(status()).toHaveTextContent('A CLA is attached to acme/gadgets.');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(watch.prevented).toEqual([true]);
});

test('nothing is optimistic: while the request is out the row still shows no CLA, the dialog stays open, and Save is busy', async () => {
  const request = held(attachedAs(11));
  const { user } = await openRepositories(undefined, {
    list: [pageOf([widgets(), gadgets()]), pageOf([widgets(), gadgets({ document: claOf() })])],
    attach: [request.answer],
  });
  await user.click(attachButton('acme/gadgets'));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  await user.selectOptions(documentSelect(), '11');
  await user.click(saveButton());
  expect(saveButton()).toHaveAttribute('aria-busy', 'true');
  expect(hiddenCells('acme/gadgets')[2]).toBe(messages['repositories.cla.none']);
  await user.keyboard('{Escape}');
  expect(attachDialog()).toBeInTheDocument();
  request.release();
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(cells('acme/gadgets')[2]).toBe('Individual CLA1.0');
});

test('a double click on Save and the Enter key repeating send one request', async () => {
  const request = held(attachedAs(11));
  const { served, user } = await openRepositories(undefined, { attach: [request.answer] });
  await user.click(attachButton('acme/gadgets'));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  await user.selectOptions(documentSelect(), '11');
  await user.dblClick(saveButton());
  await user.keyboard('{Enter}{Enter}');
  expect(served.attach).toHaveLength(1);
  request.release();
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(served.attach).toHaveLength(1);
});

test('choosing no CLA detaches: the body is null, and the row that had a document shows none once the list is asked for again', async () => {
  const { served, user } = await openRepositories(undefined, {
    list: [
      pageOf([widgets({ enabled: false }), gadgets()]),
      pageOf([widgets({ enabled: false, document: null }), gadgets()]),
    ],
    attach: [attachedAs(null)],
  });
  await user.click(changeButton('acme/widgets'));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  await user.selectOptions(documentSelect(), messages['repositories.attach.none']);
  await user.click(saveButton());
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(bodyOf(served.attach[0])).toEqual({ documentId: null });
  expect(pathOf(served.attach[0])).toBe('/api/repositories/1/cla-document');
  expect(cells('acme/widgets')[2]).toBe(messages['repositories.cla.none']);
  expect(status()).toHaveTextContent('The CLA is detached from acme/widgets.');
});

test('changed: false is an information message and not an error: the dialog closes and the page says nothing changed', async () => {
  const { user } = await openRepositories(undefined, { attach: [attachedAs(11, false)] });
  await user.click(attachButton('acme/gadgets'));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  await user.selectOptions(documentSelect(), '11');
  await user.click(saveButton());
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(status()).toHaveTextContent('Nothing changed for acme/gadgets: it already was that way.');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a repository that vanished (404) closes the dialog, is removed by the refetch, and the page says it is gone; focus goes to the results', async () => {
  const { served, user } = await openRepositories(undefined, {
    list: [pageOf([widgets(), gadgets()]), pageOf([widgets()])],
    attach: [envelope(404, 'not_found')],
  });
  await user.click(attachButton('acme/gadgets'));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  await user.selectOptions(documentSelect(), '11');
  await user.click(saveButton());
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(served.list).toHaveLength(2);
  expect(rowsOf(repositoriesTable()).map((row) => row[0])).toEqual(['acme/widgets']);
  expect(status()).toHaveTextContent('acme/gadgets is not in this installation any more.');
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 2, name: messages['repositories.results.title'] })).toHaveFocus();
  });
});

test('Escape and Cancel close the dialog with no request and put focus back on the button that opened it; reopening starts from the repository again', async () => {
  const { served, user } = await openRepositories();
  await user.click(attachButton('acme/gadgets'));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  await user.selectOptions(documentSelect(), '11');
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(attachButton('acme/gadgets')).toHaveFocus();
  await user.click(attachButton('acme/gadgets'));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  expect(documentSelect()).toHaveValue('none');
  await user.click(within(attachDialog()).getByRole('button', { name: messages['common.cancel'] }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(attachButton('acme/gadgets')).toHaveFocus();
  expect(served.attach).toEqual([]);
});

test('the dialog is keyboard-complete: Tab stays inside it and reaches the select, Cancel, Save and the close button, and Enter on Save saves', async () => {
  const { served, user } = await openRepositories();
  await user.click(attachButton('acme/gadgets'));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  const reached = new Set<string>();
  for (let step = 0; step < 8; step += 1) {
    await user.tab();
    expect(attachDialog().contains(document.activeElement)).toBe(true);
    reached.add(document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '');
  }
  expect(reached).toContain(messages['common.cancel']);
  expect(reached).toContain(messages['repositories.attach.submit']);
  expect(reached).toContain(messages['common.close']);
  await user.selectOptions(documentSelect(), '11');
  saveButton().focus();
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(served.attach).toHaveLength(1);
  });
});

test('while the documents are not there Save is off, and a failed list is the error state in the dialog with Try again', async () => {
  const { served, user } = await openRepositories(undefined, {
    documents: [envelope(502, 'github_unavailable'), documentsOf()],
  });
  await user.click(attachButton('acme/gadgets'));
  expect(await within(attachDialog()).findByRole('alert')).toHaveTextContent(messages['errors.github_unavailable']);
  expect(saveButton()).toBeDisabled();
  await user.click(within(attachDialog()).getByRole('button', { name: messages['states.retry'] }));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  expect(saveButton()).toBeEnabled();
  expect(served.documents).toHaveLength(2);
});

test('the dialog passes axe', async () => {
  const { user } = await openRepositories();
  await user.click(changeButton('acme/widgets'));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  await expectNoA11yViolations(document.body);
});
