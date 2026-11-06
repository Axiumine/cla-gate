// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { githubDown, repositoriesOf, repository, summary, tenantOf } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  bodyOf,
  button,
  heading,
  held,
  LIST_ROUTE,
  listedOf,
  listOf,
  renderDocuments,
  serveDocuments,
} from './test-support.ts';

// E18-S05: the "New document" dialog: a name of 1 to 100 characters, a scope (the whole installation or one repository) and a kind.

/** U+202E, the right-to-left override, from its code point: written out it would reorder the text around it in this file. */
const RLO = String.fromCodePoint(0x202e);
const NAME = `${messages['documents.new.name']} ${messages['common.required']}`;
const dialog = () => screen.getByRole('dialog', { name: messages['documents.new.title'] });
const nameField = () => within(dialog()).getByRole('textbox', { name: NAME });
const scopeField = () => within(dialog()).getByRole('combobox', { name: messages['documents.new.scope'] });
const kindField = () => within(dialog()).getByRole('combobox', { name: messages['documents.new.kind'] });
const create = () => within(dialog()).getByRole('button', { name: messages['documents.new.submit'] });

/** The list screen with its dialog open. */
async function openDialog(serve: Parameters<typeof serveDocuments>[0] = {}) {
  const served = serveDocuments(serve);
  const rendered = renderDocuments(LIST_ROUTE);
  await screen.findByRole('table');
  await rendered.user.click(button(messages['documents.new']));
  await screen.findByRole('dialog', { name: messages['documents.new.title'] });
  return { served, ...rendered };
}

test('the dialog has a required name, a scope with the whole installation first, and a kind with only "Individual"', async () => {
  await openDialog();
  expect(nameField()).toHaveValue('');
  expect(nameField()).toHaveAccessibleDescription(messages['documents.new.nameHelp']);
  await waitFor(() => {
    expect(
      within(scopeField())
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([messages['documents.new.scopeInstallation'], 'acme/widgets', 'acme/gadgets']);
  });
  expect(scopeField()).toHaveValue('');
  expect(
    within(kindField())
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual([messages['documents.kind.individual']]);
  expect(kindField()).toHaveValue('individual');
});

test('the repositories are asked for when the dialog opens, and not before: the first hundred of this tenant', async () => {
  const served = serveDocuments();
  const { user } = renderDocuments(LIST_ROUTE);
  await screen.findByRole('table');
  expect(served.tenants.repositories).toEqual([]);
  await user.click(button(messages['documents.new']));
  await within(await screen.findByRole('dialog')).findByRole('option', { name: 'acme/widgets' });
  expect(served.tenants.repositories.map((seen) => [new URL(seen.url).pathname, new URL(seen.url).search])).toEqual([
    ['/api/installations/5/repositories', '?limit=100'],
  ]);
});

test('creating a document of the whole installation sends the name and the kind, with no repository, and opens its editor', async () => {
  const { served, user } = await openDialog();
  await user.type(nameField(), 'Individual CLA v2');
  await user.click(create());
  await heading('Individual CLA');
  expect(served.create.map((seen) => [seen.method, new URL(seen.url).pathname])).toEqual([
    ['POST', '/api/installations/5/documents'],
  ]);
  expect(bodyOf(served.create[0])).toEqual({ name: 'Individual CLA v2', kind: 'individual' });
  expect(window.location.pathname).toBe('/installations/5/documents/12');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('the name is sent as the server will store it: without the spaces around it', async () => {
  const { served, user } = await openDialog();
  await user.type(nameField(), '   Padded name   ');
  await user.click(create());
  await waitFor(() => {
    expect(served.create).toHaveLength(1);
  });
  expect(bodyOf(served.create[0])).toEqual({ name: 'Padded name', kind: 'individual' });
});

test('a document of one repository sends the id of the repository chosen by its name', async () => {
  const { served, user } = await openDialog();
  await within(scopeField()).findByRole('option', { name: 'acme/gadgets' });
  await user.type(nameField(), 'Gadgets CLA');
  await user.selectOptions(scopeField(), 'acme/gadgets');
  await user.click(create());
  await waitFor(() => {
    expect(served.create).toHaveLength(1);
  });
  expect(bodyOf(served.create[0])).toEqual({ name: 'Gadgets CLA', kind: 'individual', repositoryId: 2 });
});

test.each([
  ['an empty name', ''],
  ['a name of spaces', '    '],
  ['a name of 101 characters', 'n'.repeat(101)],
  ['a name with a control character', 'bad\u0007name'],
  ['a name with a right-to-left override', `bad${RLO}name`],
])('%s is refused on the name field before anything is sent', async (_label, name) => {
  const { served, user } = await openDialog();
  if (name !== '') {
    await user.click(nameField());
    await user.paste(name);
  }
  await user.click(create());
  expect(nameField()).toBeInvalid();
  expect(within(dialog()).getByText(messages['documents.rule.invalid_name'])).toBeInTheDocument();
  expect(served.create).toEqual([]);
});

test('a name of exactly 100 characters is sent', async () => {
  const { served, user } = await openDialog();
  await user.click(nameField());
  await user.paste('n'.repeat(100));
  await user.click(create());
  await waitFor(() => {
    expect(served.create).toHaveLength(1);
  });
});

test('typing in the name takes the mark away', async () => {
  const { user } = await openDialog();
  await user.click(create());
  expect(nameField()).toBeInvalid();
  await user.type(nameField(), 'A');
  expect(nameField()).toBeValid();
});

test.each([
  ['invalid_name', 422, messages['documents.rule.invalid_name']],
  ['document_name_taken', 409, messages['documents.rule.document_name_taken']],
  ['document_limit_reached', 422, messages['documents.rule.document_limit_reached']],
] as const)(
  '%s from the server is shown on the name field, and the typed values stay',
  async (code, status, message) => {
    const { user } = await openDialog({ create: [envelope(status, code)] });
    await user.type(nameField(), 'Taken name');
    await user.click(create());
    await waitFor(() => {
      expect(nameField()).toBeInvalid();
    });
    expect(within(dialog()).getByText(message)).toBeInTheDocument();
    expect(nameField()).toHaveValue('Taken name');
    expect(scopeField()).toHaveValue('');
    expect(kindField()).toHaveValue('individual');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  },
);

test('kind_not_supported is shown on the kind field and not on the name', async () => {
  const { user } = await openDialog({ create: [envelope(422, 'kind_not_supported')] });
  await user.type(nameField(), 'A name');
  await user.click(create());
  await waitFor(() => {
    expect(kindField()).toBeInvalid();
  });
  expect(within(dialog()).getByText(messages['documents.rule.kind_not_supported'])).toBeInTheDocument();
  expect(nameField()).toBeValid();
});

test("editing a field takes the server's answer away, and the next try goes out again", async () => {
  const { served, user } = await openDialog({ create: [envelope(409, 'document_name_taken')] });
  await user.type(nameField(), 'Taken');
  await user.click(create());
  await waitFor(() => {
    expect(nameField()).toBeInvalid();
  });
  await user.type(nameField(), ' too');
  expect(nameField()).toBeValid();
  await user.selectOptions(kindField(), 'individual');
  await user.click(create());
  await waitFor(() => {
    expect(served.create).toHaveLength(2);
  });
});

test('a name edited while the request is out does not lock the dialog: the next try goes out, and the answer to the first one is dropped', async () => {
  const gate = held(envelope(409, 'document_name_taken'));
  const { served, user } = await openDialog({
    create: [gate.answer, Response.json({ document: listedOf({ id: 12, activeVersion: null }) }, { status: 201 })],
  });
  await user.type(nameField(), 'Taken');
  await user.click(create());
  await waitFor(() => {
    expect(served.create).toHaveLength(1);
  });
  await user.type(nameField(), ' too');
  gate.release();
  await waitFor(() => {
    expect(create()).not.toHaveAttribute('aria-busy', 'true');
  });
  expect(nameField()).toBeValid();
  await user.click(create());
  await heading('Individual CLA');
  expect(served.create.map((seen) => bodyOf(seen))).toEqual([
    { name: 'Taken', kind: 'individual' },
    { name: 'Taken too', kind: 'individual' },
  ]);
});

test('any other failure is the error state in the dialog, and the typed values stay', async () => {
  const { user } = await openDialog({ create: [envelope(403, 'forbidden')] });
  await user.type(nameField(), 'Forbidden name');
  await user.click(create());
  expect(await within(dialog()).findByText(messages['errors.forbidden'])).toBeInTheDocument();
  expect(nameField()).toHaveValue('Forbidden name');
  expect(nameField()).toBeValid();
  expect(create()).toBeEnabled();
});

test('"Create document" is busy while the request is under way, and a double click sends one request', async () => {
  const gate = held(Response.json({ document: listedOf({ id: 12, activeVersion: null }) }, { status: 201 }));
  const { served, user } = await openDialog({ create: [gate.answer] });
  await user.type(nameField(), 'Slow');
  await user.dblClick(create());
  await waitFor(() => {
    expect(create()).toHaveAttribute('aria-busy', 'true');
  });
  expect(served.create).toHaveLength(1);
  gate.release();
  await heading('Individual CLA');
  expect(served.create).toHaveLength(1);
});

test('Cancel closes the dialog, and it opens empty the next time', async () => {
  const { served, user } = await openDialog();
  await user.type(nameField(), 'Never created');
  await user.click(within(dialog()).getByRole('button', { name: messages['common.cancel'] }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(button(messages['documents.new']));
  await screen.findByRole('dialog');
  expect(nameField()).toHaveValue('');
  expect(served.create).toEqual([]);
});

test('while the repositories load the scope is off, and a failure to load them is shown with "Try again" and leaves the whole installation to choose', async () => {
  let failing = true;
  const tenant = {
    summary: summary(),
    answer: () => (failing ? githubDown() : repositoriesOf([repository(1, 'acme/widgets')])),
  };
  const { user } = await openDialog({ tenants: [tenant] });
  expect(await within(dialog()).findByText(messages['errors.github_unavailable'])).toBeInTheDocument();
  expect(scopeField()).toBeEnabled();
  expect(within(scopeField()).getAllByRole('option')).toHaveLength(1);
  failing = false;
  await user.click(within(dialog()).getByRole('button', { name: messages['states.retry'] }));
  expect(await within(scopeField()).findByRole('option', { name: 'acme/widgets' })).toBeInTheDocument();
  expect(within(dialog()).queryByText(messages['errors.github_unavailable'])).toBeNull();
});

test('the scope is off until the repositories have answered', async () => {
  const gate = held(repositoriesOf([repository(1, 'acme/widgets')]));
  await openDialog({ tenants: [{ summary: summary(), answer: gate.answer }] });
  expect(scopeField()).toBeDisabled();
  gate.release();
  await within(scopeField()).findByRole('option', { name: 'acme/widgets' });
  expect(scopeField()).toBeEnabled();
});

test('a tenant with more repositories than the dialog lists says so', async () => {
  await openDialog({
    tenants: [{ summary: summary(), answer: () => repositoriesOf([repository(1, 'acme/widgets')], 'more') }],
  });
  expect(await within(dialog()).findByText(/Only the first 100 repositories are listed/)).toBeInTheDocument();
});

test('a tenant with no more repositories says nothing about it', async () => {
  await openDialog({ tenants: [tenantOf(summary(), 'acme/widgets')] });
  await within(scopeField()).findByRole('option', { name: 'acme/widgets' });
  expect(within(dialog()).queryByText(/Only the first/)).toBeNull();
});

test('the dialog, with its fields, a field error and the error state, passes axe', async () => {
  const { user } = await openDialog({ create: [envelope(403, 'forbidden')] });
  await within(scopeField()).findByRole('option', { name: 'acme/widgets' });
  await expectNoA11yViolations(document.body);
  await user.click(create());
  await within(dialog()).findByText(messages['documents.rule.invalid_name']);
  await expectNoA11yViolations(document.body);
  await user.type(nameField(), 'Name');
  await user.click(create());
  await within(dialog()).findByText(messages['errors.forbidden']);
  await expectNoA11yViolations(document.body);
});

test('the list of documents is asked for again after a create, so the new document is in it', async () => {
  const served = serveDocuments({
    list: [listOf(listedOf()), listOf(listedOf(), listedOf({ id: 12, name: 'Second CLA' }))],
  });
  const { user } = renderDocuments(LIST_ROUTE);
  await screen.findByRole('table');
  await user.click(button(messages['documents.new']));
  await user.type(nameField(), 'Second CLA');
  await user.click(create());
  await heading('Individual CLA');
  await user.click(
    within(screen.getByRole('navigation', { name: messages['tenant.nav.label'] })).getByRole('link', {
      name: messages['tenant.nav.documents'],
    }),
  );
  expect(await screen.findByRole('link', { name: 'Second CLA' })).toBeInTheDocument();
  expect(served.list).toHaveLength(2);
});
