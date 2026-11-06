// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { messages } from '../i18n/index.ts';
import { repository, summary } from '../installations/test-support.ts';
import { firstOf } from '../pending/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { visibleText } from '../ui/user-text.ts';
import {
  claOf,
  confirmDisable,
  documentSelect,
  documentsOf,
  installationDocument,
  openRepositories,
  pageOf,
  REPOSITORIES_ROUTE,
  repositoriesTable,
  rowsOf,
} from './test-support.ts';

// E18-S10: the name of a repository, the name of a document and the login of the account are text a person controls and the server sends
// verbatim. They are drawn as text in the table, in the names of the buttons, in the dialogs, in the notice and in the title of the tab,
// and nowhere as markup. A repository name never becomes a link: the one link of a row is the settings link, to a path of the app.

const NAMES = [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES].map(
  (name) => [JSON.stringify(name).slice(0, 40), name] as const,
);
const collapsed = (text: string): string => text.replace(/[\t\n\f\r ]+/gu, ' ').trim();

/** Elements and attributes that a browser would act on, beyond what `activeContent` looks for. */
const ACTIVE = '[onerror], [onclick], [onload], style, iframe, object, embed';

/** A repository (enforcing, with a document) whose name and whose document's name are both `name`. */
const hostileRepository = (name: string) => repository(1, name, { enabled: true, document: claOf({ name }) });

const openHostile = (name: string, enabled = true) =>
  openRepositories(REPOSITORIES_ROUTE, {
    list: [
      pageOf([repository(1, name, { enabled, document: claOf({ name }) })]),
      pageOf([repository(1, name, { enabled: !enabled, document: claOf({ name }) })]),
    ],
    documents: [documentsOf({ installationScoped: [installationDocument(11, name, { major: 1, minor: 0 })] })],
  });

test.each(NAMES)(
  '%s as the repository and the document is text in the cells, with the hidden characters written out, and is not linked',
  async (_label, name) => {
    await openRepositories(REPOSITORIES_ROUTE, { list: [pageOf([hostileRepository(name)])] });
    const main = screen.getByRole('main');
    const [cells] = rowsOf(repositoriesTable());
    expect(cells?.[0]).toBe(visibleText(name));
    expect(cells?.[2]).toBe(`${visibleText(name)}1.0`);
    const links = within(repositoriesTable()).queryAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/installations/5/repositories/1/settings']);
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      messages['repositories.settings.label'].replace('{repository}', () => visibleText(name)),
    ]);
    expect(activeContent(main)).toEqual([]);
    expect(main.querySelectorAll(ACTIVE)).toHaveLength(0);
  },
);

test.each(NAMES)('%s as the repository is text in the names of the three buttons of its row', async (_label, name) => {
  await openRepositories(REPOSITORIES_ROUTE, {
    list: [pageOf([hostileRepository(name), repository(2, name, { enabled: false, document: null })])],
  });
  const labels = within(repositoriesTable())
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));
  const named = (message: string) => message.replace('{repository}', () => visibleText(name));
  expect(labels).toEqual([
    named(messages['repositories.attach.changeLabel']),
    named(messages['repositories.disable.label']),
    named(messages['repositories.attach.label']),
    named(messages['repositories.enable.label']),
  ]);
});

test.each(NAMES)('%s is text in the attach dialog: the title, and the choices of the select', async (_label, name) => {
  const { user } = await openHostile(name);
  await user.click(firstOf(screen.getAllByRole('button', { name: /^Change CLA/ })));
  const dialog = await screen.findByRole('dialog');
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe(
    `${messages['repositories.attach.title']} ${visibleText(name)}`,
  );
  expect(
    within(documentSelect())
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual([messages['repositories.attach.none'], `${visibleText(name)} (1.0), whole installation`]);
  expect(activeContent(dialog)).toEqual([]);
  expect(dialog.querySelectorAll(ACTIVE)).toHaveLength(0);
});

test.each(NAMES)('%s is text in the question that turns the check off', async (_label, name) => {
  const { user } = await openHostile(name);
  await user.click(firstOf(screen.getAllByRole('button', { name: /^Disable the CLA check/ })));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe(
    `${messages['repositories.disable.title']} ${visibleText(name)}`,
  );
  expect(activeContent(dialog)).toEqual([]);
  expect(dialog.querySelectorAll(ACTIVE)).toHaveLength(0);
});

test.each(NAMES)('%s is text in the notice that says what a change did', async (_label, name) => {
  const { user } = await openHostile(name);
  await user.click(firstOf(screen.getAllByRole('button', { name: /^Disable the CLA check/ })));
  await user.click(confirmDisable());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  const notice = screen.getByText(
    messages['repositories.notice.disabled'].replace('{repository}', () => visibleText(name)),
    {
      normalizer: (text) => text,
    },
  );
  expect(notice.textContent).toBe(
    messages['repositories.notice.disabled'].replace('{repository}', () => visibleText(name)),
  );
  expect(activeContent(screen.getByRole('main'))).toEqual([]);
});

test.each(NAMES)(
  '%s as the account is text in the title of the tab, with the hidden characters written out',
  async (_label, name) => {
    await openRepositories(REPOSITORIES_ROUTE, {
      tenants: [{ summary: summary({ accountLogin: name }), answer: () => pageOf([]) }],
      list: [pageOf([hostileRepository(name)])],
    });
    await waitFor(() => {
      expect(document.title).toBe(`${messages['repositories.title']}: ${collapsed(visibleText(name))} · CLA`);
    });
    expect(document.title).toBe(visibleText(document.title));
  },
);

test('a repository name never reaches the title of the tab, which names the screen and the account', async () => {
  await openRepositories(REPOSITORIES_ROUTE, { list: [pageOf([hostileRepository('zzzz-repository-name')])] });
  await waitFor(() => {
    expect(document.title).toBe('Repositories: acme · CLA');
  });
  expect(document.title).not.toContain('zzzz');
});

test('a hostile name does not break the page: the list, the attach dialog and the question pass axe', async () => {
  const name = `<img src=x onerror=alert(1)> ${'n'.repeat(200)}`;
  const { user } = await openHostile(name);
  await expectNoA11yViolations(document.body);
  await user.click(firstOf(screen.getAllByRole('button', { name: /^Change CLA/ })));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  await expectNoA11yViolations(document.body);
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  await user.click(firstOf(screen.getAllByRole('button', { name: /^Disable the CLA check/ })));
  await screen.findByRole('alertdialog');
  await expectNoA11yViolations(document.body);
});
