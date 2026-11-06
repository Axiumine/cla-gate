// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ALLOWLIST_LOGIN_PATTERN } from '../../shared/allowlist.ts';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { json } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { summary, tenantOf } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { visibleText } from '../ui/user-text.ts';
import {
  ALLOWLIST_ROUTE,
  entriesTable,
  entryOf,
  installationPage,
  openAllowlist,
  removeButton,
  renderAllowlist,
  rowsOf,
  serveAllowlist,
} from './test-support.ts';

// E18-S06: a login is a snapshot of text that GitHub holds and a person chose, and the person who added an entry is a login too. They are
// drawn as text in the list and in the dialogs, and nowhere as markup. A login snapshot can only be what a GitHub login looks like: the
// contract refuses anything else, so a response that carries markup there never reaches the screen at all.

const NAMES = [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES].map(
  (name) => [JSON.stringify(name).slice(0, 40), name] as const,
);
const INVALID_LOGINS = NAMES.filter(([, name]) => !ALLOWLIST_LOGIN_PATTERN.test(name));
const collapsed = (text: string): string => text.replace(/[\t\n\f\r ]+/gu, ' ').trim();

/** Elements and attributes that a browser would act on, beyond what `activeContent` looks for. */
const ACTIVE = '[onerror], [onclick], [onload], style, iframe, object, embed, form';

test.each(NAMES)(
  'the login %s of the person who added the entry is text in the cell, as written',
  async (_label, name) => {
    await openAllowlist(ALLOWLIST_ROUTE, {
      installationList: [installationPage([entryOf({ createdBy: { githubId: 4711, login: name } })])],
    });
    const cell = within(entriesTable()).getAllByRole('row')[1]?.querySelectorAll('td')[3];
    expect(cell?.textContent).toBe(visibleText(name));
    expect(activeContent(screen.getByRole('main'))).toEqual([]);
    expect(screen.getByRole('main').querySelectorAll(ACTIVE)).toHaveLength(0);
  },
);

test.each(NAMES)(
  'the login %s of the person who added the entry is text in the removal question too',
  async (_label, name) => {
    const { user } = await openAllowlist(ALLOWLIST_ROUTE, {
      installationList: [installationPage([entryOf({ createdBy: { githubId: 4711, login: name } })])],
    });
    await user.click(removeButton('defunkt'));
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText(/^Added by/).textContent).toContain(visibleText(name));
    expect(activeContent(question)).toEqual([]);
    expect(question.querySelectorAll(ACTIVE)).toHaveLength(0);
  },
);

test.each(INVALID_LOGINS)(
  'a login snapshot of %s is refused by the contract: the screen shows the error and none of it',
  async (_label, name) => {
    serveAllowlist({
      installationList: [json({ entries: [{ ...entryOf(), loginSnapshot: name }], nextCursor: null })],
    });
    renderAllowlist(ALLOWLIST_ROUTE);
    const state = await screen.findByRole('alert');
    const main = screen.getByRole('main');
    expect(state).toHaveTextContent(messages['errors.contract']);
    expect(screen.queryByRole('table')).toBeNull();
    expect(main.textContent).not.toContain(visibleText(name));
    expect(activeContent(main)).toEqual([]);
  },
);

test.each(NAMES)(
  'the account %s is text in the title of the tab, with the hidden characters written out',
  async (_label, name) => {
    serveAllowlist({ tenants: [tenantOf(summary({ accountLogin: name }), 'acme/widgets')] });
    renderAllowlist(ALLOWLIST_ROUTE);
    await screen.findByRole('heading', { level: 2, name: messages['allowlist.entries.title'] });
    await waitFor(() => {
      expect(document.title).toBe(`${messages['allowlist.title']}: ${collapsed(visibleText(name))} · CLA`);
    });
    expect(activeContent(screen.getByRole('main'))).toEqual([]);
  },
);

test('every hostile name at once does not break the page: the list and the removal question pass axe', async () => {
  const entries = NAMES.map(([, name], index) =>
    entryOf({
      id: index + 1,
      githubId: index + 1000,
      loginSnapshot: `user-${String(index)}`,
      createdBy: { githubId: 4711, login: name },
    }),
  );
  const { user } = await openAllowlist(ALLOWLIST_ROUTE, { installationList: [installationPage(entries)] });
  expect(rowsOf(entriesTable())).toHaveLength(NAMES.length);
  await expectNoA11yViolations(document.body);
  await user.click(removeButton('user-0'));
  await screen.findByRole('alertdialog');
  await expectNoA11yViolations(document.body);
});
