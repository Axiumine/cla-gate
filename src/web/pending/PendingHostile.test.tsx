// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { messages } from '../i18n/index.ts';
import { repositoriesOf, repository, summary } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { visibleText } from '../ui/user-text.ts';
import {
  firstOf,
  OVERRIDES_ROUTE,
  openOverrides,
  openPending,
  overrideOf,
  overridesPage,
  overridesTable,
  pageOf,
  pendingOf,
  pendingTable,
  reasonField,
  recordDialog,
  renderPending,
  rowsOf,
  servePending,
  UNLINKED_SHA,
  unlinked,
  unsigned,
} from './test-support.ts';

// E18-S08: the repository, the login of a contributor, the login of the person who recorded an override and the reason they gave are text a
// person controls and the server sends verbatim. They are drawn as text in the list, in the dialogs, in the names of the buttons and in
// the title of the tab, and nowhere as markup. A repository name that has not the shape of one is never linked.

const NAMES = [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES].map(
  (name) => [JSON.stringify(name).slice(0, 40), name] as const,
);
const collapsed = (text: string): string => text.replace(/[\t\n\f\r ]+/gu, ' ').trim();

/** Elements and attributes that a browser would act on, beyond what `activeContent` looks for. */
const ACTIVE = '[onerror], [onclick], [onload], style, iframe, object, embed';

/** A pull request whose repository, contributor login and unlinked commit all carry `name`. */
const hostilePr = (name: string) =>
  pendingOf({
    repository: { id: 1, fullName: name },
    reasons: [unsigned(4711, name), unlinked()],
  });

const openHostile = (name: string) =>
  openPending('/installations/5/pending', {
    pending: [pageOf([hostilePr(name)])],
    tenants: [{ summary: summary(), answer: () => repositoriesOf([repository(1, name)]) }],
  });

test.each(NAMES)(
  '%s is text in the cells, with the hidden characters written out, and is not linked',
  async (_label, name) => {
    await openHostile(name);
    const main = screen.getByRole('main');
    const [cells] = rowsOf(pendingTable());
    expect(cells?.[0]).toBe(visibleText(name));
    expect(cells?.[4]).toContain(`${messages['pending.reason.unsigned_contributor']} ${visibleText(name)}`);
    expect(within(pendingTable()).queryByRole('link')).toBeNull();
    expect(activeContent(main)).toEqual([]);
    expect(main.querySelectorAll(ACTIVE)).toHaveLength(0);
  },
);

test.each(NAMES)(
  '%s is text in the dialog: the read-only repository field, and in the name of the button',
  async (_label, name) => {
    const { user } = await openHostile(name);
    const button = firstOf(within(pendingTable()).getAllByRole('button', { name: /^Record override/ }));
    expect(button.getAttribute('aria-label')).toBe(
      messages['pending.override.label']
        .replace('{commit}', UNLINKED_SHA.slice(0, 7))
        .replace('{repository}', visibleText(name)),
    );
    await user.click(button);
    const dialog = await screen.findByRole('dialog', { name: messages['pending.override.title'] });
    // A one-line field takes no line break: the browser drops them from the value, which is what the field shows.
    expect(within(dialog).getByRole('textbox', { name: messages['pending.override.repository'] })).toHaveValue(
      visibleText(name).replace(/[\r\n]/gu, ''),
    );
    expect(activeContent(dialog)).toEqual([]);
    expect(dialog.querySelectorAll(ACTIVE)).toHaveLength(0);
  },
);

test.each(NAMES)(
  'the account %s is text in the title of the tab, with the hidden characters written out',
  async (_label, name) => {
    servePending({
      tenants: [
        { summary: summary({ accountLogin: name }), answer: () => repositoriesOf([repository(1, 'acme/widgets')]) },
      ],
    });
    renderPending('/installations/5/pending');
    await screen.findByRole('table', { name: messages['pending.caption'] });
    await waitFor(() => {
      expect(document.title).toBe(`${messages['pending.title']}: ${collapsed(visibleText(name))} · CLA`);
    });
    expect(activeContent(screen.getByRole('main'))).toEqual([]);
  },
);

test.each(NAMES)(
  'the repository %s is a choice of the filter as plain text, hidden characters written out',
  async (_label, name) => {
    await openHostile(name);
    const options = within(screen.getByRole('combobox', { name: messages['pending.filter.repository'] })).getAllByRole(
      'option',
    );
    expect(options.map((option) => option.textContent)).toEqual([
      messages['pending.filter.repository.all'],
      visibleText(name),
    ]);
  },
);

test.each(NAMES)(
  '%s as the login and the reason of an override is text in the table and in the removal dialog',
  async (_label, name) => {
    const { user } = await openOverrides(`${OVERRIDES_ROUTE}&repository=1`, {
      overrides: [overridesPage([overrideOf({ createdBy: { githubId: 4711, login: name }, reason: name })])],
    });
    const main = screen.getByRole('main');
    const [cells] = rowsOf(overridesTable());
    expect(cells?.[1]).toBe(`${visibleText(name)}4711`);
    expect(cells?.[3]).toBe(visibleText(name));
    expect(activeContent(main)).toEqual([]);
    expect(main.querySelectorAll(ACTIVE)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /^Remove the override/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(activeContent(dialog)).toEqual([]);
  },
);

test('a pull request of a repository with a well-formed name is linked, and one with a hostile name next to it is not', async () => {
  await openPending('/installations/5/pending', {
    pending: [pageOf([pendingOf(), hostilePr('<img src=x onerror=alert(1)>/x')])],
  });
  expect(
    within(pendingTable())
      .getAllByRole('link')
      .map((link) => link.getAttribute('href')),
  ).toEqual(['https://github.com/acme/widgets/pull/45']);
});

test('the reason typed in the dialog stays text in the field and is sent as typed', async () => {
  const { user, served } = await openPending('/installations/5/pending');
  await user.click(screen.getByRole('button', { name: /^Record override/ }));
  await screen.findByRole('dialog');
  await user.click(reasonField());
  await user.paste("<script>alert(1)</script> =cmd|' /C calc'!A0");
  await user.click(within(recordDialog()).getByRole('button', { name: messages['pending.override.submit'] }));
  await waitFor(() => {
    expect(served.record).toHaveLength(1);
  });
  expect(JSON.parse(String(served.record[0]?.text))).toEqual({
    commitSha: UNLINKED_SHA,
    reason: "<script>alert(1)</script> =cmd|' /C calc'!A0",
  });
  expect(activeContent(screen.getByRole('main'))).toEqual([]);
});

test('every hostile name at once does not break the page: the list, the dialog and the overrides pass axe', async () => {
  const items = NAMES.map(([, name], index) =>
    pendingOf({
      evaluationId: index + 1,
      repository: { id: 1, fullName: name },
      reasons: [unsigned(index + 1000, name), unlinked(`${String(index).padStart(2, '0')}${'a'.repeat(38)}`)],
    }),
  );
  const { user } = await openPending('/installations/5/pending', { pending: [pageOf(items)] });
  expect(within(pendingTable()).getAllByRole('row')).toHaveLength(NAMES.length + 1);
  await expectNoA11yViolations(document.body);
  await user.click(firstOf(within(pendingTable()).getAllByRole('button', { name: /^Record override/ })));
  await screen.findByRole('dialog');
  await expectNoA11yViolations(document.body);
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  await user.click(screen.getByRole('tab', { name: messages['pending.tab.overrides'] }));
  await screen.findByRole('option', { name: 'acme/widgets' });
  await expectNoA11yViolations(document.body);
});

test('every hostile name at once as the logins and reasons of the overrides passes axe, and the table keeps its layout classes', async () => {
  const items = NAMES.map(([, name], index) =>
    overrideOf({ id: index + 1, createdBy: { githubId: index + 1, login: name }, reason: name }),
  );
  const { user } = await openOverrides(`${OVERRIDES_ROUTE}&repository=1`, { overrides: [overridesPage(items)] });
  await expectNoA11yViolations(document.body);
  for (const bdi of overridesTable().querySelectorAll('bdi')) {
    expect(bdi.className).toContain('wrap-anywhere');
  }
  await user.click(firstOf(screen.getAllByRole('button', { name: /^Remove the override/ })));
  await screen.findByRole('alertdialog');
  await expectNoA11yViolations(document.body);
});
