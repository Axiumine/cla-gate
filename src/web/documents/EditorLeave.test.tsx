// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { button, editorField, heading, openEditor, replaceText } from './test-support.ts';

// E18-S05: unsaved local edits hold the navigation: the router asks first, and the browser asks when the page is reloaded or closed.

const nav = () => screen.getByRole('navigation', { name: messages['tenant.nav.label'] });
const overviewLink = () => within(nav()).getByRole('link', { name: messages['tenant.nav.overview'] });

/** Dispatches `beforeunload` the way the browser does and says whether the page asked to keep the person. */
function pageAsksToStay(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

test('with nothing unsaved a link leaves at once, and the browser is not asked to keep the page', async () => {
  const { user } = await openEditor();
  expect(pageAsksToStay()).toBe(false);
  await user.click(overviewLink());
  expect(await heading('acme')).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

test('with unsaved edits a link opens a question, and "Stay" keeps the page and the text', async () => {
  const { user } = await openEditor();
  await replaceText(user, 'Work that is not saved');
  await user.click(overviewLink());
  const dialog = await screen.findByRole('alertdialog', { name: messages['editor.leave.title'] });
  expect(dialog).toHaveAccessibleDescription(messages['editor.leave.description']);
  await user.click(within(dialog).getByRole('button', { name: messages['editor.leave.stay'] }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(editorField()).toHaveValue('Work that is not saved');
  expect(screen.getByRole('heading', { level: 1, name: 'Individual CLA' })).toBeInTheDocument();
});

test('"Leave without saving" goes where the link goes', async () => {
  const { user } = await openEditor();
  await replaceText(user, 'Work that is lost');
  await user.click(overviewLink());
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: messages['editor.leave.confirm'] }),
  );
  expect(await heading('acme')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).toBeNull();
});

test('Escape does not answer the question, and the focus starts on "Stay", the safe answer', async () => {
  const { user } = await openEditor();
  await replaceText(user, 'Work that is not saved');
  await user.click(overviewLink());
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByRole('button', { name: messages['editor.leave.stay'] })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: messages['editor.leave.stay'] }));
  expect(editorField()).toHaveValue('Work that is not saved');
});

test('while edits are unsaved the browser is asked to keep the page, and once they are saved it is not', async () => {
  const { user } = await openEditor();
  await replaceText(user, 'Work that is not saved');
  expect(pageAsksToStay()).toBe(true);
  await user.click(button(messages['editor.save']));
  await screen.findByText(messages['editor.saved'], { selector: '[role="status"]' });
  expect(pageAsksToStay()).toBe(false);
  await user.click(overviewLink());
  expect(await heading('acme')).toBeInTheDocument();
});

test('typing the text back to what is saved is not unsaved work', async () => {
  const { user } = await openEditor({ activeText: 'Same' });
  await replaceText(user, 'Different');
  expect(pageAsksToStay()).toBe(true);
  await replaceText(user, 'Same');
  expect(pageAsksToStay()).toBe(false);
});

test('the question passes axe', async () => {
  const { user } = await openEditor();
  await replaceText(user, 'Work that is not saved');
  await user.click(overviewLink());
  await screen.findByRole('alertdialog');
  await expectNoA11yViolations(document.body);
});
