// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { messages } from '../../i18n/index.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
import { editorField, heading, openEditor, replaceText } from '../test-support.ts';
import { address, openHistory, serveHistory, versionsTable } from './test-support.ts';

// E18-S11: the second tab of a document lives in the address (`?tab=history`), and switching tabs is not leaving the page, so the
// unsaved text of the first tab neither asks a question nor goes away.

const tab = (name: string) => screen.getByRole('tab', { name });
const editorTab = () => tab(messages['document.tabs.editor']);
const historyTab = () => tab(messages['document.tabs.history']);
const nav = () => screen.getByRole('navigation', { name: messages['tenant.nav.label'] });

/** Dispatches `beforeunload` the way the browser does and says whether the page asked to keep the person. */
function pageAsksToStay(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

test('the History tab puts ?tab=history in the address and the Editor tab takes it out, and the Back button follows', async () => {
  serveHistory();
  const { user } = await openEditor();
  expect(address()).toBe('/installations/5/documents/11');
  await user.click(historyTab());
  expect(await screen.findByRole('table', { name: messages['history.caption'] })).toBeInTheDocument();
  expect(address()).toBe('/installations/5/documents/11?tab=history');
  expect(historyTab()).toHaveAttribute('aria-selected', 'true');
  await user.click(editorTab());
  expect(address()).toBe('/installations/5/documents/11');
  expect(editorTab()).toHaveAttribute('aria-selected', 'true');
  window.history.back();
  expect(await screen.findByRole('table', { name: messages['history.caption'] })).toBeInTheDocument();
  expect(address()).toBe('/installations/5/documents/11?tab=history');
});

test('an address with ?tab=history opens on the History tab, and the editor text is not in the page', async () => {
  await openHistory();
  expect(historyTab()).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByRole('textbox', { name: messages['editor.text.label'] })).toBeNull();
  expect(versionsTable()).toBeInTheDocument();
});

test.each(['%3Cscript%3Ealert(1)%3C%2Fscript%3E', 'HISTORY', 'editor', '', '1', 'history%00'])(
  'a tab value of %j that is not "history" opens the Editor tab',
  async (value) => {
    serveHistory();
    await openEditor();
    window.history.pushState(null, '', `/installations/5/documents/11?tab=${value}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await screen.findByRole('textbox', { name: messages['editor.text.label'] })).toBeInTheDocument();
    expect(editorTab()).toHaveAttribute('aria-selected', 'true');
    expect(historyTab()).toHaveAttribute('aria-selected', 'false');
  },
);

test('the arrow keys move between the two tabs, and the focus and the address follow', async () => {
  serveHistory();
  const { user } = await openEditor();
  editorTab().focus();
  await user.keyboard('{ArrowRight}');
  expect(historyTab()).toHaveFocus();
  expect(await screen.findByRole('table', { name: messages['history.caption'] })).toBeInTheDocument();
  expect(address()).toBe('/installations/5/documents/11?tab=history');
  await user.keyboard('{ArrowLeft}');
  expect(editorTab()).toHaveFocus();
  expect(address()).toBe('/installations/5/documents/11');
});

test('switching tabs with unsaved edits asks nothing and loses nothing: the text is there when the Editor tab is back', async () => {
  serveHistory();
  const { user } = await openEditor();
  await replaceText(user, 'Work that is not saved');
  await user.click(historyTab());
  expect(await screen.findByRole('table', { name: messages['history.caption'] })).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  await user.click(editorTab());
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(editorField()).toHaveValue('Work that is not saved');
});

test('with unsaved edits a link away from the History tab still asks, and "Stay" keeps the page and the text', async () => {
  serveHistory();
  const { user } = await openEditor();
  await replaceText(user, 'Work that is not saved');
  await user.click(historyTab());
  await screen.findByRole('table', { name: messages['history.caption'] });
  await user.click(within(nav()).getByRole('link', { name: messages['tenant.nav.overview'] }));
  const dialog = await screen.findByRole('alertdialog', { name: messages['editor.leave.title'] });
  await user.click(within(dialog).getByRole('button', { name: messages['editor.leave.stay'] }));
  expect(address()).toBe('/installations/5/documents/11?tab=history');
  await user.click(editorTab());
  expect(editorField()).toHaveValue('Work that is not saved');
});

test('with unsaved edits "Leave without saving" from the History tab goes where the link goes', async () => {
  serveHistory();
  const { user } = await openEditor();
  await replaceText(user, 'Work that is lost');
  await user.click(historyTab());
  await screen.findByRole('table', { name: messages['history.caption'] });
  await user.click(within(nav()).getByRole('link', { name: messages['tenant.nav.overview'] }));
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: messages['editor.leave.confirm'] }),
  );
  expect(await heading('acme')).toBeInTheDocument();
});

test('the browser is asked to keep the page on the History tab while edits are unsaved, and not otherwise', async () => {
  serveHistory();
  const { user } = await openEditor();
  await user.click(historyTab());
  await screen.findByRole('table', { name: messages['history.caption'] });
  expect(pageAsksToStay()).toBe(false);
  await user.click(editorTab());
  await replaceText(user, 'Work that is not saved');
  await user.click(historyTab());
  expect(pageAsksToStay()).toBe(true);
});

test('the tabs and the History tab pass axe', async () => {
  const { user } = await openHistory();
  await expectNoA11yViolations(document.body);
  await user.click(editorTab());
  await expectNoA11yViolations(document.body);
});
