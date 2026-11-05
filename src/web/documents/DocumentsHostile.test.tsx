// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { HOSTILE_CLA_ROWS } from '../../shared/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { visibleText } from '../ui/user-text.ts';
import {
  detailOf,
  draftOf,
  EDITOR_ROUTE,
  LIST_ROUTE,
  listedOf,
  listOf,
  renderDocuments,
  serveDocuments,
} from './test-support.ts';

// E18-S05: a document name, a repository name and a CLA text are text that people chose. They are drawn as text in the list, in the
// editor and in its preview, and nowhere as markup.

const NAMES = [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES].map(
  (name) => [JSON.stringify(name).slice(0, 40), name] as const,
);

/** Elements and attributes that a signer's browser would act on, beyond what `activeContent` looks for. */
const ACTIVE = '[onerror], [onclick], [onload], style, iframe, object, embed, form';

test.each(NAMES)(
  'the name %s is text in the list, in the link and in the scope cell, as written',
  async (_label, name) => {
    serveDocuments({
      list: [listOf(listedOf({ id: 11, name, scope: 'repository', repositoryId: 7, repositoryFullName: name }))],
    });
    renderDocuments(LIST_ROUTE);
    const table = await screen.findByRole('table', { name: messages['documents.caption'] });
    const row = within(table).getAllByRole('row')[1];
    const cells = row?.querySelectorAll('td');
    expect(cells?.[0]?.textContent).toBe(visibleText(name));
    expect(cells?.[1]?.textContent).toBe(visibleText(name));
    expect(table.querySelector('a[href="/installations/5/documents/11"]')?.textContent).toBe(visibleText(name));
    expect(activeContent(screen.getByRole('main'))).toEqual([]);
    expect(screen.getByRole('main').querySelectorAll(ACTIVE)).toHaveLength(0);
  },
);

test.each(NAMES)(
  'the name %s is text in the h1 of the editor, with the hidden characters written out',
  async (_label, name) => {
    serveDocuments({ detail: [detailOf(listedOf({ name }))] });
    renderDocuments(EDITOR_ROUTE);
    const h1 = await screen.findByRole('heading', { level: 1 });
    await screen.findByRole('textbox', { name: messages['editor.text.label'] });
    expect(h1.textContent).toBe(visibleText(name));
    expect(activeContent(screen.getByRole('main'))).toEqual([]);
  },
);

test.each(HOSTILE_CLA_ROWS)(
  'hostile CLA text, %s: the preview keeps it inert and the text of what was refused stays readable',
  async (_label, source, shown) => {
    serveDocuments({ draft: [draftOf(source, 1)] });
    renderDocuments(EDITOR_ROUTE);
    await screen.findByRole('textbox', { name: messages['editor.text.label'] });
    const preview = screen.getByRole('region', { name: messages['editor.preview.title'] });
    expect(activeContent(preview)).toEqual([]);
    expect(preview.querySelectorAll(ACTIVE)).toHaveLength(0);
    expect(preview.querySelectorAll('script, img')).toHaveLength(0);
    expect(preview.textContent).toContain(shown);
    expect(document.querySelectorAll('script')).toHaveLength(0);
  },
);

test('a text with the table of hostile rows at once is inert in the preview, in the field it is plain text, and the page passes axe', async () => {
  const everything = HOSTILE_CLA_ROWS.map(([, source]) => source).join('\n\n');
  serveDocuments({ draft: [draftOf(everything, 1)] });
  renderDocuments(EDITOR_ROUTE);
  const field = await screen.findByRole('textbox', { name: messages['editor.text.label'] });
  expect(field).toHaveValue(everything);
  const preview = screen.getByRole('region', { name: messages['editor.preview.title'] });
  expect(activeContent(preview)).toEqual([]);
  expect(preview.querySelectorAll(ACTIVE)).toHaveLength(0);
  await expectNoA11yViolations(document.body);
});
