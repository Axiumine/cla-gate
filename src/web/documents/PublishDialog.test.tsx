// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  ABC_HASH,
  bodyOf,
  button,
  detailOf,
  draftOf,
  EDITOR_ROUTE,
  heading,
  openEditor,
  openPublish,
  publishDialog,
  rationaleField,
  renderDocuments,
  replaceText,
  savedAt,
  serveDocuments,
  submitButton,
  unpublished,
} from './test-support.ts';

// E18-S05: the publish dialog. A version is made from the saved draft; the form is there when the text on screen is that draft.

afterEach(() => {
  vi.restoreAllMocks();
});

const radio = (name: string) => within(publishDialog()).getByRole('radio', { name });

test('with unsaved edits the dialog asks to save first and has no form; saving turns it into the publish form', async () => {
  const { served, user } = await openEditor({ draft: [draftOf('abc', 3)], save: [savedAt(4)] });
  await replaceText(user, 'abc changed');
  await user.click(button(messages['editor.publish']));
  const dialog = await screen.findByRole('dialog', { name: messages['publish.title'] });
  expect(within(dialog).getByText(messages['publish.saveFirst'])).toBeInTheDocument();
  expect(within(dialog).queryByRole('radio')).toBeNull();
  expect(within(dialog).queryByRole('button', { name: messages['publish.submit'] })).toBeNull();
  await user.click(within(dialog).getByRole('button', { name: messages['editor.save'] }));
  expect(await within(publishDialog()).findByRole('button', { name: messages['publish.submit'] })).toBeInTheDocument();
  expect(bodyOf(served.save[0])).toEqual({ contentMd: 'abc changed', expectedRevision: 3 });
  expect(within(publishDialog()).queryByText(messages['publish.saveFirst'])).toBeNull();
});

test('with no draft saved the dialog asks to save first too, even when the text is the active version', async () => {
  const { user } = await openEditor();
  await user.click(button(messages['editor.publish']));
  const dialog = await screen.findByRole('dialog', { name: messages['publish.title'] });
  expect(within(dialog).getByText(messages['publish.saveFirst'])).toBeInTheDocument();
  expect(within(dialog).queryByRole('textbox')).toBeNull();
});

test('a failed save in the dialog is shown there, and the dialog stays on "save first"', async () => {
  const { user } = await openEditor({
    save: [envelope(403, 'forbidden')],
  });
  await user.click(button(messages['editor.publish']));
  const dialog = await screen.findByRole('dialog', { name: messages['publish.title'] });
  await user.click(within(dialog).getByRole('button', { name: messages['editor.save'] }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(messages['errors.forbidden']);
  expect(within(dialog).getByText(messages['publish.saveFirst'])).toBeInTheDocument();
});

test('Cancel closes the dialog and sends nothing', async () => {
  const { served, user } = await openPublish();
  await user.click(within(publishDialog()).getByRole('button', { name: messages['common.cancel'] }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(served.publish).toEqual([]);
});

test('the form of a document with a version has the two kinds of change, minor chosen first, and the number it would get', async () => {
  await openPublish();
  expect(radio(messages['publish.bump.minor'])).toBeChecked();
  expect(radio(messages['publish.bump.minor'])).toBeEnabled();
  expect(radio(messages['publish.bump.major'])).not.toBeChecked();
  expect(within(publishDialog()).getByText('Version 1.1')).toBeInTheDocument();
  expect(within(publishDialog()).getByText(messages['publish.result.note'])).toBeInTheDocument();
});

test('choosing major changes the number it would get to the next major, and back', async () => {
  const { user } = await openPublish();
  await user.click(radio(messages['publish.bump.major']));
  expect(within(publishDialog()).getByText('Version 2.0')).toBeInTheDocument();
  await user.click(radio(messages['publish.bump.minor']));
  expect(within(publishDialog()).getByText('Version 1.1')).toBeInTheDocument();
});

test('a document with no version is published as a major one: major is chosen, minor cannot be, and the number is 1.0', async () => {
  serveDocuments({ detail: [detailOf(unpublished())], draft: [draftOf('abc', 3)] });
  const { user } = renderDocuments(EDITOR_ROUTE);
  await heading('Individual CLA');
  await user.click(button(messages['editor.publish']));
  await screen.findByRole('dialog', { name: messages['publish.title'] });
  expect(radio(messages['publish.bump.major'])).toBeChecked();
  expect(radio(messages['publish.bump.minor'])).toBeDisabled();
  expect(within(publishDialog()).getByText(messages['publish.bump.first'])).toBeInTheDocument();
  expect(within(publishDialog()).getByText('Version 1.0')).toBeInTheDocument();
});

test('the SHA-256 of the text is computed in the browser and shown as a preview, over the canonical text', async () => {
  await openPublish();
  expect(await within(publishDialog()).findByText(ABC_HASH)).toBeInTheDocument();
  expect(within(publishDialog()).getByText(messages['publish.hash'])).toBeInTheDocument();
});

test('a browser that cannot compute the hash says so, and the form still works', async () => {
  vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new TypeError('no crypto'));
  await openPublish();
  expect(await within(publishDialog()).findByText(messages['publish.hash.failed'])).toBeInTheDocument();
  expect(submitButton()).toBeEnabled();
});

test.each(['resolves', 'rejects'] as const)(
  'a hash that %s after the dialog was closed changes nothing on the page',
  async (outcome) => {
    const gate = Promise.withResolvers<ArrayBuffer>();
    vi.spyOn(crypto.subtle, 'digest').mockReturnValue(gate.promise);
    const { user } = await openPublish();
    expect(within(publishDialog()).getByText(messages['publish.hash.pending'])).toBeInTheDocument();
    await user.click(within(publishDialog()).getByRole('button', { name: messages['common.cancel'] }));
    if (outcome === 'resolves') {
      gate.resolve(new ArrayBuffer(32));
    } else {
      gate.reject(new TypeError('no crypto'));
    }
    await gate.promise.catch(() => undefined);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(messages['publish.hash.failed'])).toBeNull();
  },
);

test('the dialog says that a published version is immutable', async () => {
  await openPublish();
  expect(within(publishDialog()).getByText(messages['publish.immutable'])).toBeInTheDocument();
});

test('the rationale is required: an empty one and one of spaces send nothing and are marked on the field', async () => {
  const { served, user } = await openPublish();
  await user.click(submitButton());
  expect(rationaleField()).toBeInvalid();
  expect(within(publishDialog()).getByText(messages['documents.rule.invalid_rationale'])).toBeInTheDocument();
  await user.type(rationaleField(), '   ');
  await user.click(submitButton());
  expect(rationaleField()).toBeInvalid();
  expect(served.publish).toEqual([]);
});

test('a rationale of more than 2000 characters is refused before anything is sent, and 2000 is accepted', async () => {
  const { served, user } = await openPublish();
  await user.click(rationaleField());
  await user.paste('x'.repeat(2001));
  await user.click(submitButton());
  expect(rationaleField()).toBeInvalid();
  expect(served.publish).toEqual([]);
  await user.clear(rationaleField());
  await user.paste('x'.repeat(2000));
  await user.click(submitButton());
  await waitFor(() => {
    expect(served.publish).toHaveLength(1);
  });
});

test('typing in the rationale clears the mark that it was needed', async () => {
  const { user } = await openPublish();
  await user.click(submitButton());
  expect(rationaleField()).toBeInvalid();
  await user.type(rationaleField(), 'Fixed a typo');
  expect(rationaleField()).toBeValid();
});

test('a minor publish sends the draft revision, the bump, the trimmed rationale and the active version, and no acknowledgeResigning', async () => {
  const { served, user } = await openPublish();
  await user.click(rationaleField());
  await user.paste('  Fixed a typo in section 2  ');
  await user.click(submitButton());
  await waitFor(() => {
    expect(served.publish).toHaveLength(1);
  });
  expect(served.publish[0]?.method).toBe('POST');
  expect(new URL(served.publish[0]?.url ?? '').pathname).toBe('/api/installations/5/documents/11/versions');
  expect(bodyOf(served.publish[0])).toEqual({
    source: { type: 'draft', revision: 3 },
    bump: 'minor',
    rationale: 'Fixed a typo in section 2',
    expectedActiveVersionId: 301,
  });
});

test('a first publish of a document with no version expects no active version', async () => {
  const served = serveDocuments({ detail: [detailOf(unpublished())], draft: [draftOf('abc', 3)] });
  const { user } = renderDocuments(EDITOR_ROUTE);
  await heading('Individual CLA');
  await user.click(button(messages['editor.publish']));
  await screen.findByRole('dialog', { name: messages['publish.title'] });
  await user.click(rationaleField());
  await user.paste('First version');
  await user.click(submitButton());
  await waitFor(() => {
    expect(served.publish).toHaveLength(1);
  });
  expect(bodyOf(served.publish[0])).toEqual({
    source: { type: 'draft', revision: 3 },
    bump: 'major',
    rationale: 'First version',
    expectedActiveVersionId: null,
  });
});

test('the publish form and the "save first" question pass axe', async () => {
  const { user } = await openPublish();
  await within(publishDialog()).findByText(ABC_HASH);
  await expectNoA11yViolations(document.body);
  await user.click(within(publishDialog()).getByRole('button', { name: messages['common.cancel'] }));
  await replaceText(user, 'abc and more');
  await user.click(button(messages['editor.publish']));
  await screen.findByText(messages['publish.saveFirst']);
  await expectNoA11yViolations(document.body);
});
