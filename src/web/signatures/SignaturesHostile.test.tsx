// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { listedOf, listOf } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { summary, tenantOf } from '../installations/test-support.ts';
import { stubDownloads } from '../setup/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { visibleText } from '../ui/user-text.ts';
import {
  documentSelect,
  exportLink,
  openSignatures,
  pageOf,
  renderSignatures,
  rowsOf,
  SIGNATURES_ROUTE,
  serveSignatures,
  signatureOf,
  signaturesTable,
} from './test-support.ts';

// E18-S07: the name a signer typed, their login, their email, the name of the document and the repository are text a person controls
// and the server sends verbatim. They are drawn as text in the cells, in the details, in the title of the revoke question and in the
// title of the tab, and nowhere as markup. The file of the export is the server's, handed over as it is.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const NAMES = [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES].map(
  (name) => [JSON.stringify(name).slice(0, 40), name] as const,
);
const collapsed = (text: string): string => text.replace(/[\t\n\f\r ]+/gu, ' ').trim();

/** Elements and attributes that a browser would act on, beyond what `activeContent` looks for. */
const ACTIVE = '[onerror], [onclick], [onload], style, iframe, object, embed';

/** Ada's signature, with `name` in every place the signer or the signature has text of their own. */
const hostileOf = (name: string) =>
  signatureOf({
    signer: { login: name, name, email: name },
    document: { id: 11, name },
    source: { repositoryFullName: name, prNumber: 45 },
  });

const openHostile = (name: string) => openSignatures(SIGNATURES_ROUTE, { search: [pageOf([hostileOf(name)])] });
/** The first button of the table that has `name`: the one of the first row. */
const rowButton = (name: RegExp) => {
  const [button] = within(signaturesTable()).getAllByRole('button', { name });
  if (button === undefined) {
    throw new Error(`no button for ${String(name)}`);
  }
  return button;
};

test.each(NAMES)(
  '%s is text in the cells: the signer, the document and the repository, as written',
  async (_label, name) => {
    await openHostile(name);
    const main = screen.getByRole('main');
    const cells = rowsOf(signaturesTable())[0] ?? [];
    expect(cells[0]).toBe(`${visibleText(name)}${visibleText(name)}`);
    expect(cells[2]).toBe(visibleText(name));
    expect(cells[5]).toContain(visibleText(name));
    expect(activeContent(main)).toEqual([]);
    expect(main.querySelectorAll(ACTIVE)).toHaveLength(0);
  },
);

test.each(NAMES)('%s is text in the details of the row, the email too', async (_label, name) => {
  const { user } = await openHostile(name);
  await user.click(rowButton(/^Details of the signature of/));
  const details = await screen.findByRole('dialog');
  expect(details.textContent).toContain(visibleText(name));
  expect(within(details).getByText(messages['signatures.details.email']).nextElementSibling?.textContent).toBe(
    visibleText(name),
  );
  expect(activeContent(details)).toEqual([]);
  expect(details.querySelectorAll(ACTIVE)).toHaveLength(0);
});

test.each(NAMES)(
  '%s is text in the title of the revoke question, and in the name of the button',
  async (_label, name) => {
    const { user } = await openHostile(name);
    const button = rowButton(/^Revoke the signature of/);
    expect(button.getAttribute('aria-label')).toBe(
      messages['signatures.revoke.label'].replace('{signer}', visibleText(name)),
    );
    await user.click(button);
    const question = await screen.findByRole('alertdialog');
    expect(question.textContent).toContain(visibleText(name));
    expect(activeContent(question)).toEqual([]);
    expect(question.querySelectorAll(ACTIVE)).toHaveLength(0);
  },
);

test.each(NAMES)(
  'the account %s is text in the title of the tab, with the hidden characters written out',
  async (_label, name) => {
    serveSignatures({ tenants: [tenantOf(summary({ accountLogin: name }), 'acme/widgets')] });
    renderSignatures(SIGNATURES_ROUTE);
    await screen.findByRole('table', { name: messages['signatures.caption'] });
    await waitFor(() => {
      expect(document.title).toBe(`${messages['signatures.title']}: ${collapsed(visibleText(name))} · CLA`);
    });
    expect(activeContent(screen.getByRole('main'))).toEqual([]);
  },
);

test.each(NAMES)(
  'the document %s is a choice of the filter as plain text, hidden characters written out',
  async (_label, name) => {
    await openSignatures(SIGNATURES_ROUTE, { documents: [listOf(listedOf({ id: 11, name }))] });
    const options = within(documentSelect()).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      messages['signatures.filter.document.all'],
      visibleText(name),
    ]);
    expect(activeContent(screen.getByRole('main'))).toEqual([]);
  },
);

test('a hostile name does not reach the address of the export or the name of the file saved', async () => {
  const downloads = stubDownloads();
  const formula = "=cmd|' /C calc'!A0";
  const body = `signature_id,signer\r\n900,'${formula}\r\n`;
  const { user } = await openSignatures(`${SIGNATURES_ROUTE}?document=11`, {
    search: [pageOf([hostileOf(formula)])],
    documents: [listOf(listedOf({ id: 11, name: formula }))],
    csv: [new Response(body, { headers: { 'content-disposition': `attachment; filename="${formula}.csv"` } })],
  });
  expect(exportLink().getAttribute('href')).toBe('/api/installations/5/documents/11/signatures.csv?state=all');
  await user.click(exportLink());
  expect(await screen.findByText('Saved as signatures-11.csv.')).toBeInTheDocument();
  expect(downloads.saved()).toEqual([{ name: 'signatures-11.csv', address: 'blob:made-up-address' }]);
  expect(await downloads.create.mock.calls[0]?.[0].text()).toBe(body);
});

test('every hostile name at once does not break the page: the table, the details and the revoke question pass axe', async () => {
  const items = NAMES.map(([, name], index) =>
    signatureOf({
      id: index + 1,
      githubUserId: index + 1000,
      signer: { login: name, name, email: name },
      document: { id: 11, name },
      source: { repositoryFullName: name, prNumber: null },
    }),
  );
  const { user } = await openSignatures(SIGNATURES_ROUTE, { search: [pageOf(items)] });
  expect(within(signaturesTable()).getAllByRole('row')).toHaveLength(NAMES.length + 1);
  await expectNoA11yViolations(document.body);
  await user.click(rowButton(/^Details of the signature of/));
  await screen.findByRole('dialog');
  await expectNoA11yViolations(document.body);
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  await user.click(rowButton(/^Revoke the signature of/));
  await screen.findByRole('alertdialog');
  await expectNoA11yViolations(document.body);
});
