// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  ACTIVE_TEXT,
  bodyOf,
  button,
  draftOf,
  editorField,
  held,
  noContent,
  openEditor,
  replaceText,
  savedAt,
  statusRegion,
} from './test-support.ts';

// E18-S05: saving and discarding the draft. Nothing is automatic: a request goes out when the person asks.

afterEach(() => {
  vi.useRealTimers();
});

const saveButton = () => button(messages['editor.save']);

test('"Save draft" sends the text and the revision the editor read, null when no draft was saved, and says "Draft saved."', async () => {
  const { served, user } = await openEditor();
  await replaceText(user, 'Text of the first draft');
  await user.click(saveButton());
  expect(await statusRegion(messages['editor.saved'])).toBeInTheDocument();
  expect(served.save.map((seen) => [seen.method, new URL(seen.url).pathname])).toEqual([
    ['PUT', '/api/installations/5/documents/11/draft'],
  ]);
  expect(bodyOf(served.save[0])).toEqual({ contentMd: 'Text of the first draft', expectedRevision: null });
  expect(editorField()).toHaveValue('Text of the first draft');
});

test('after a save the next one names the new revision, and the draft is shown as saved with Save off until the text changes', async () => {
  const { served, user } = await openEditor({ save: [savedAt(1), savedAt(2)] });
  await replaceText(user, 'One');
  await user.click(saveButton());
  await statusRegion(messages['editor.saved']);
  expect(saveButton()).toBeDisabled();
  expect(screen.getByText(messages['document.facts.draft']).closest('dl')).toHaveTextContent(
    messages['documents.draftSaved'],
  );
  expect(screen.getByRole('button', { name: messages['editor.discard'] })).toBeInTheDocument();
  await replaceText(user, 'One and two');
  expect(saveButton()).toBeEnabled();
  expect(screen.queryByText(messages['editor.saved'])).toBeNull();
  await user.click(saveButton());
  await waitFor(() => {
    expect(served.save).toHaveLength(2);
  });
  expect(bodyOf(served.save[1])).toEqual({ contentMd: 'One and two', expectedRevision: 1 });
});

test('a saved draft is saved at its revision: expectedRevision is the revision of the draft that was read', async () => {
  const { served, user } = await openEditor({ draft: [draftOf('Saved before', 3)] });
  await replaceText(user, 'Saved before, then changed');
  await user.click(saveButton());
  await statusRegion(messages['editor.saved']);
  expect(bodyOf(served.save[0])).toEqual({ contentMd: 'Saved before, then changed', expectedRevision: 3 });
});

test('nothing is saved by itself: typing, leaving the field and a long wait send no request', async () => {
  const { served, user } = await openEditor();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await replaceText(user, 'Typed and left alone');
  await user.tab();
  await user.click(document.body);
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
  expect(served.save).toEqual([]);
  expect(served.discard).toEqual([]);
  expect(served.publish).toEqual([]);
});

test('a save in flight shows "Save draft" as busy, a double click sends one request, and the editor goes on when it is done', async () => {
  const gate = held(savedAt(1));
  const { served, user } = await openEditor({ save: [gate.answer] });
  await replaceText(user, 'Double clicked');
  await user.dblClick(saveButton());
  await waitFor(() => {
    expect(saveButton()).toHaveAttribute('aria-busy', 'true');
  });
  expect(served.save).toHaveLength(1);
  gate.release();
  await statusRegion(messages['editor.saved']);
  expect(saveButton()).not.toHaveAttribute('aria-busy');
  expect(served.save).toHaveLength(1);
});

test('what is typed while a save is under way stays as unsaved work on top of the saved text', async () => {
  const gate = held(savedAt(1));
  const { user } = await openEditor({ save: [gate.answer] });
  await replaceText(user, 'Sent text');
  await user.click(saveButton());
  await waitFor(() => {
    expect(saveButton()).toHaveAttribute('aria-busy', 'true');
  });
  await user.type(editorField(), ' and more');
  gate.release();
  await waitFor(() => {
    expect(saveButton()).not.toHaveAttribute('aria-busy');
  });
  expect(editorField()).toHaveValue('Sent text and more');
  expect(saveButton()).toBeEnabled();
});

test('"Discard draft" asks first, in an alert dialog that says what is deleted, and Cancel changes nothing', async () => {
  const { served, user } = await openEditor({ draft: [draftOf('The draft', 3)] });
  await user.click(button(messages['editor.discard']));
  const dialog = screen.getByRole('alertdialog', { name: messages['editor.discard.title'] });
  expect(dialog).toHaveAccessibleDescription(messages['editor.discard.description']);
  await user.click(within(dialog).getByRole('button', { name: messages['common.cancel'] }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(served.discard).toEqual([]);
  expect(editorField()).toHaveValue('The draft');
});

test('confirming the discard sends DELETE, shows the active version, forgets unsaved changes, and takes away the badge and the button', async () => {
  const { served, user } = await openEditor({ draft: [draftOf('The draft', 3)], activeText: 'Active text' });
  await replaceText(user, 'The draft, edited');
  await user.click(button(messages['editor.discard']));
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: messages['editor.discard.confirm'] }),
  );
  expect(await statusRegion(messages['editor.discarded'])).toBeInTheDocument();
  expect(served.discard.map((seen) => [seen.method, new URL(seen.url).pathname])).toEqual([
    ['DELETE', '/api/installations/5/documents/11/draft'],
  ]);
  expect(editorField()).toHaveValue('Active text');
  expect(screen.queryByRole('button', { name: messages['editor.discard'] })).toBeNull();
  expect(screen.getByText(messages['document.facts.draft']).closest('dl')).toHaveTextContent(
    messages['document.facts.noDraft'],
  );
});

test('a failed discard is shown, the draft and the text stay, and nothing is said to be discarded', async () => {
  const { user } = await openEditor({
    draft: [draftOf('The draft', 3)],
    discard: [envelope(500, 'internal_server_error')],
  });
  await user.click(button(messages['editor.discard']));
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: messages['editor.discard.confirm'] }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.internal_server_error']);
  expect(editorField()).toHaveValue('The draft');
  expect(screen.queryByText(messages['editor.discarded'])).toBeNull();
  expect(screen.getByRole('button', { name: messages['editor.discard'] })).toBeInTheDocument();
});

test('a discard that finds no draft is a 204 like any other and ends in the active version', async () => {
  const { user } = await openEditor({ draft: [draftOf('The draft', 3)], discard: [noContent()] });
  await user.click(button(messages['editor.discard']));
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: messages['editor.discard.confirm'] }),
  );
  await statusRegion(messages['editor.discarded']);
  expect(editorField()).toHaveValue(ACTIVE_TEXT);
});

test('the discard dialog passes axe', async () => {
  const { user } = await openEditor({ draft: [draftOf('The draft', 3)] });
  await user.click(button(messages['editor.discard']));
  await screen.findByRole('alertdialog');
  await expectNoA11yViolations(document.body);
});
