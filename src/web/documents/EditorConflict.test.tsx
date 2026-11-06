// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  bodyOf,
  button,
  draftOf,
  editorField,
  openEditor,
  replaceText,
  savedAt,
  statusRegion,
} from './test-support.ts';

// E18-S05: a save at a revision the server has moved past (409 draft_conflict) keeps the local text; "Load latest" replaces it only
// when it is chosen. A 422 about the text is shown under the editor; any other failure leaves the text on screen too.

const conflict = () => envelope(409, 'draft_conflict', {}, { currentRevision: 5 });
const loadLatest = () => button(messages['editor.conflict.load']);

/** An editor opened on the draft at revision 3 where the person has typed `mine` and saved into a conflict. */
async function conflictOn(serve: Parameters<typeof openEditor>[0] = {}) {
  const opened = await openEditor({
    draft: [draftOf('Their first text', 3), draftOf('Their newer text', 5)],
    save: [conflict()],
    ...serve,
  });
  await replaceText(opened.user, 'My local text');
  await opened.user.click(button(messages['editor.save']));
  await screen.findByRole('alert');
  return opened;
}

test('409 draft_conflict keeps the local text, shows the banner with "Load latest", and says nothing was saved', async () => {
  await conflictOn();
  const banner = screen.getByRole('alert');
  expect(banner).toHaveTextContent(messages['editor.conflict.title']);
  expect(banner).toHaveTextContent(messages['editor.conflict.message']);
  expect(within(banner).getByRole('button', { name: messages['editor.conflict.load'] })).toBeEnabled();
  expect(editorField()).toHaveValue('My local text');
  expect(screen.queryByText(messages['editor.saved'])).toBeNull();
});

test('the text on screen is replaced only when "Load latest" is chosen, by the draft the other admin saved', async () => {
  const { served, user } = await conflictOn();
  expect(served.draft).toHaveLength(1);
  expect(editorField()).toHaveValue('My local text');
  await user.click(loadLatest());
  expect(await statusRegion(messages['editor.loaded'])).toBeInTheDocument();
  expect(editorField()).toHaveValue('Their newer text');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(served.draft).toHaveLength(2);
});

test('after "Load latest" the next save is made at the revision that was loaded', async () => {
  const { served, user } = await conflictOn({ save: [conflict(), savedAt(6)] });
  await user.click(loadLatest());
  await statusRegion(messages['editor.loaded']);
  await replaceText(user, 'Mine again');
  await user.click(button(messages['editor.save']));
  await statusRegion(messages['editor.saved']);
  expect(bodyOf(served.save[1])).toEqual({ contentMd: 'Mine again', expectedRevision: 5 });
});

test('when the other admin discarded the draft meanwhile, "Load latest" keeps the local text as unsaved work, and the next save has no revision', async () => {
  const { served, user } = await conflictOn({
    draft: [draftOf('Their first text', 3), draftOf(null)],
    save: [conflict(), savedAt(1)],
  });
  await user.click(loadLatest());
  await screen.findByText(messages['editor.discard'], { selector: 'button' }).catch(() => undefined);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(editorField()).toHaveValue('My local text');
  expect(button(messages['editor.save'])).toBeEnabled();
  await user.click(button(messages['editor.save']));
  await statusRegion(messages['editor.saved']);
  expect(bodyOf(served.save[1])).toEqual({ contentMd: 'My local text', expectedRevision: null });
});

test('a failed "Load latest" is shown, the banner stays and so does the local text', async () => {
  const { user } = await conflictOn({ draft: [draftOf('Their first text', 3), envelope(502, 'github_unavailable')] });
  await user.click(loadLatest());
  const alerts = await screen.findAllByRole('alert');
  expect(alerts.some((alert) => alert.textContent.includes(messages['errors.github_unavailable']))).toBe(true);
  expect(screen.getByText(messages['editor.conflict.title'])).toBeInTheDocument();
  expect(editorField()).toHaveValue('My local text');
});

test('the conflict banner passes axe', async () => {
  await conflictOn();
  await expectNoA11yViolations(document.body);
});

test.each([
  ['content_empty', undefined, messages['documents.rule.content_empty']],
  ['content_invalid_characters', undefined, messages['documents.rule.content_invalid_characters']],
  ['content_too_deeply_nested', undefined, messages['documents.rule.content_too_deeply_nested']],
  [
    'content_too_large',
    { limitBytes: 204_800, actualBytes: 250_001 },
    'The text is too large: 250,001 bytes, and the limit is 204,800.',
  ],
] as const)(
  '422 %s is shown under the editor with its message, the field is marked invalid, and the text stays',
  async (code, details, message) => {
    const { user } = await openEditor({ save: [envelope(422, code, {}, details)] });
    await replaceText(user, 'Text the server refuses');
    await user.click(button(messages['editor.save']));
    await screen.findByText(message);
    expect(editorField()).toBeInvalid();
    expect(editorField()).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(editorField()).toHaveValue('Text the server refuses');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText(messages['editor.saved'])).toBeNull();
  },
);

test('editing the text takes the 422 away, because it was about the text that was sent', async () => {
  const { user } = await openEditor({ save: [envelope(422, 'content_empty')] });
  await replaceText(user, ' ');
  await user.click(button(messages['editor.save']));
  await screen.findByText(messages['documents.rule.content_empty']);
  await user.type(editorField(), 'x');
  expect(screen.queryByText(messages['documents.rule.content_empty'])).toBeNull();
  expect(editorField()).toBeValid();
});

test('a 422 about the text passes axe', async () => {
  const { user } = await openEditor({ save: [envelope(422, 'content_empty')] });
  await replaceText(user, ' ');
  await user.click(button(messages['editor.save']));
  await screen.findByText(messages['documents.rule.content_empty']);
  await expectNoA11yViolations(document.body);
});

test('a 403 keeps the text on screen and shows the forbidden message, with no sign that anything was saved', async () => {
  const { user } = await openEditor({ save: [envelope(403, 'forbidden')] });
  await replaceText(user, 'Text of a person who lost the role');
  await user.click(button(messages['editor.save']));
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.forbidden']);
  expect(editorField()).toHaveValue('Text of a person who lost the role');
  expect(screen.queryByText(messages['editor.saved'])).toBeNull();
  expect(button(messages['editor.save'])).toBeEnabled();
});

test.each([
  ['a 422 with a code the editor has no words for', envelope(422, 'zzzz_made_up'), messages['errors.unknown']],
  ['a content_too_large that lacks its numbers', envelope(422, 'content_too_large'), messages['errors.unknown']],
  ['a 500', envelope(500, 'internal_server_error'), messages['errors.internal_server_error']],
])('%s is the general error state, and the text stays', async (_label, answer, message) => {
  const { user } = await openEditor({ save: [answer] });
  await replaceText(user, 'Kept text');
  await user.click(button(messages['editor.save']));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(editorField()).toHaveValue('Kept text');
});
