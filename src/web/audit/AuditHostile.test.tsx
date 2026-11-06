// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { assert, expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { messages } from '../i18n/index.ts';
import { repositoriesOf, repository, summary } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { applyUtilitiesOf } from '../test-support/tailwind.ts';
import { visibleText } from '../ui/user-text.ts';
import { metadataText } from './metadata-text.ts';
import {
  AUDIT_ROUTE,
  auditTable,
  eventOf,
  metadataButton,
  openAudit,
  pageOf,
  renderAudit,
  rowsOf,
  serveAudit,
} from './test-support.ts';

// E18-S09: the login of an actor, the kind of a subject, an action code the catalogue does not know, and the metadata of a row are
// text the server sends verbatim. They are drawn as text in the table and in the metadata block, never as markup, and a very long value
// breaks where it must instead of widening the table.

const NAMES = [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES].map(
  (name) => [JSON.stringify(name).slice(0, 40), name] as const,
);
const collapsed = (text: string): string => text.replace(/[\t\n\f\r ]+/gu, ' ').trim();

/** Elements and attributes that a browser would act on, beyond what `activeContent` looks for. */
const ACTIVE = '[onerror], [onclick], [onload], style, iframe, object, embed';

/** The length of the long value. */
const LONG = 10_000;

test.each(NAMES)(
  '%s as the login of the actor is text in the cell, with the hidden characters written out',
  async (_label, name) => {
    await openAudit(AUDIT_ROUTE, { log: [pageOf([eventOf({ actor: { githubId: 4711, login: name } })])] });
    const main = screen.getByRole('main');
    expect(rowsOf(auditTable())[0]?.[1]).toBe(`4711 ${visibleText(name)}`);
    expect(within(auditTable()).queryByRole('link')).toBeNull();
    expect(activeContent(main)).toEqual([]);
    expect(main.querySelectorAll(ACTIVE)).toHaveLength(0);
  },
);

test.each(NAMES)(
  '%s as an action code the catalogue does not know is raw text in code, and as a subject type is text',
  async (_label, name) => {
    await openAudit(AUDIT_ROUTE, {
      log: [pageOf([eventOf({ action: name, subject: { type: name, id: 9 } })])],
    });
    const main = screen.getByRole('main');
    const [cells] = rowsOf(auditTable());
    expect(cells?.[2]).toBe(visibleText(name));
    expect(cells?.[3]).toBe(`${visibleText(name)} 9`);
    expect(activeContent(main)).toEqual([]);
    expect(main.querySelectorAll(ACTIVE)).toHaveLength(0);
  },
);

test.each(NAMES)(
  '%s in the metadata is text in a pre, as the sorted JSON of it, and nothing in it is an element',
  async (_label, name) => {
    const metadata = { [name]: name, nested: { list: [name], text: name } };
    const { user } = await openAudit(AUDIT_ROUTE, { log: [pageOf([eventOf({ metadata })])] });
    const main = screen.getByRole('main');
    await user.click(metadataButton(12));
    const block = main.querySelector('pre');
    expect(block?.textContent).toBe(metadataText(metadata));
    expect(block?.children).toHaveLength(0);
    expect(activeContent(main)).toEqual([]);
    expect(main.querySelectorAll(ACTIVE)).toHaveLength(0);
  },
);

test.each(NAMES)(
  'the account %s is text in the title of the tab, with the hidden characters written out',
  async (_label, name) => {
    serveAudit({
      tenants: [
        { summary: summary({ accountLogin: name }), answer: () => repositoriesOf([repository(1, 'acme/widgets')]) },
      ],
    });
    renderAudit(AUDIT_ROUTE);
    await screen.findByRole('table', { name: messages['audit.caption'] });
    await waitFor(() => {
      expect(document.title).toBe(`${messages['audit.title']}: ${collapsed(visibleText(name))} · CLA`);
    });
    expect(activeContent(screen.getByRole('main'))).toEqual([]);
  },
);

test('a metadata value that looks like HTML is escaped text: the characters are in the page and no element came of them', async () => {
  const markup = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const { user } = await openAudit(AUDIT_ROUTE, { log: [pageOf([eventOf({ metadata: { kind: markup } })])] });
  await user.click(metadataButton(12));
  const block = screen.getByRole('main').querySelector('pre');
  expect(block?.textContent).toContain(markup);
  expect(block?.innerHTML).not.toContain('<img');
  expect(block?.innerHTML).not.toContain('<script');
});

test('a value of 10,000 characters is in the page whole, in a pre and in a cell that break anywhere, so the table keeps its layout', async () => {
  const long = 'x'.repeat(LONG);
  const { user } = await openAudit(AUDIT_ROUTE, {
    log: [pageOf([eventOf({ actor: { githubId: 4711, login: long }, metadata: { kind: long } })])],
  });
  await user.click(metadataButton(12));
  const block = screen.getByRole('main').querySelector('pre');
  assert.isNotNull(block);
  expect(block.textContent).toContain(long);
  const login = within(auditTable()).getByText(long);
  const stop = await applyUtilitiesOf(document.body);
  try {
    expect(getComputedStyle(login).getPropertyValue('overflow-wrap')).toBe('anywhere');
    expect(getComputedStyle(block).getPropertyValue('overflow-wrap')).toBe('anywhere');
    expect(getComputedStyle(block).getPropertyValue('white-space')).toBe('pre-wrap');
  } finally {
    stop();
  }
  expect(auditTable().parentElement).toHaveClass('overflow-x-auto');
});

test('every hostile name at once as the actor, the action and the metadata passes axe, closed and open', async () => {
  const items = NAMES.map(([, name], index) =>
    eventOf({
      id: index + 1,
      actor: { githubId: index + 1, login: name },
      action: name,
      subject: { type: name, id: index + 1 },
      metadata: { [name]: name },
    }),
  );
  const { user, container } = await openAudit(AUDIT_ROUTE, { log: [pageOf(items)] });
  expect(within(auditTable()).getAllByRole('row')).toHaveLength(NAMES.length + 1);
  await expectNoA11yViolations(container);
  for (const button of screen.getAllByRole('button', { name: /^Show metadata of event/ })) {
    await user.click(button);
  }
  expect(screen.getByRole('main').querySelectorAll('pre')).toHaveLength(NAMES.length);
  await expectNoA11yViolations(container);
});
