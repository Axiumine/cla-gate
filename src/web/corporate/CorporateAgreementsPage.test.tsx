// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent } from '../test-support/hostile.ts';
import { spyOnPageNavigation } from '../test-support/location.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { ALICE } from '../test-support/session.ts';
import { agreementWith, answerAgreements } from './test-support.ts';

// E21-S02: the page at /corporate/agreements in the shell of the app.

const ROUTE = '/corporate/agreements';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The text of the cells of the row of the table whose first cell holds exactly `first`. */
function rowStartingWith(first: string): string[] {
  const row = screen
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryAllByRole('cell').at(0)?.textContent === first);
  return within(row ?? document.body)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);
}

test('the page lists the agreements of the person, newest first, in the main landmark of the shell, and passes axe', async () => {
  answerAgreements([
    {
      items: [agreementWith(9), agreementWith(8, { revoked: true, activeApprovalCount: 0, companyName: 'Zeta Ltd' })],
      nextCursor: null,
    },
  ]);
  const { container } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  const heading = await screen.findByRole('heading', { level: 1, name: messages['corporate.agreements.title'] });
  expect(screen.getByRole('main')).toContainElement(heading);
  expect(await screen.findByRole('table', { name: messages['corporate.agreements.caption'] })).toBeInTheDocument();
  expect(rowStartingWith('Company 9')).toEqual([
    'Company 9',
    'Title 9',
    'Acme corporate CLA',
    'acme-org',
    '2026-10-02 10:30 UTC',
    '2',
    messages['status.active'],
  ]);
  expect(rowStartingWith('Zeta Ltd').slice(-2)).toEqual(['0', messages['status.revoked']]);
  expect(document.title).toBe(`${messages['corporate.agreements.title']} · CLA`);
  await expectNoA11yViolations(container);
});

test('a company erased from the records is shown as erased, in the place of its name and title', async () => {
  answerAgreements([{ items: [agreementWith(3, { companyName: null, signatoryTitle: null })], nextCursor: null }]);
  renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  const table = await screen.findByRole('table');
  expect(within(table).getAllByText(messages['corporate.agreements.erased'])).toHaveLength(2);
});

test('a person with no agreement is told so, and the list is not drawn', async () => {
  answerAgreements([{ items: [], nextCursor: null }]);
  renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  expect(
    await screen.findByRole('heading', { level: 2, name: messages['corporate.agreements.emptyTitle'] }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});

test('the next page is asked for with the cursor of the answer, which goes into the address, and Previous returns to the first', async () => {
  const requests = answerAgreements([
    { items: [agreementWith(9)], nextCursor: 'cursor-two' },
    { items: [agreementWith(5)], nextCursor: null },
    { items: [agreementWith(9)], nextCursor: 'cursor-two' },
  ]);
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  await screen.findByText('Company 9');
  await user.click(screen.getByRole('button', { name: messages['pager.next'] }));
  expect(await screen.findByText('Company 5')).toBeInTheDocument();
  expect(requests.map((url) => url.searchParams.get('cursor'))).toEqual([null, 'cursor-two']);
  expect(window.location.search).toBe('?cursor=cursor-two');
  await user.click(screen.getByRole('button', { name: messages['pager.previous'] }));
  expect(await screen.findByText('Company 9')).toBeInTheDocument();
  expect(window.location.search).toBe('');
});

test('a cursor in the address is sent as it is, and a cursor that is not a short text is the first page', async () => {
  const requests = answerAgreements([{ items: [agreementWith(5)], nextCursor: null }]);
  renderWithProviders(<AppRouter />, { route: `${ROUTE}?cursor=abc`, session: ALICE });
  await screen.findByText('Company 5');
  expect(requests.map((url) => url.searchParams.get('cursor'))).toEqual(['abc']);
});

test('a cursor of absurd length is dropped and the first page is asked for', async () => {
  const requests = answerAgreements([{ items: [agreementWith(5)], nextCursor: null }]);
  renderWithProviders(<AppRouter />, { route: `${ROUTE}?cursor=${'x'.repeat(600)}`, session: ALICE });
  await screen.findByText('Company 5');
  expect(requests.map((url) => url.searchParams.get('cursor'))).toEqual([null]);
});

test('hostile names are text: no element, no script link, and the characters as they were typed', async () => {
  const hostile = [
    '<img src=x onerror=alert(1)>',
    '=HYPERLINK("http://evil.example","click")',
    '<script>alert(1)</script>',
  ];
  answerAgreements([
    {
      items: hostile.map((name, index) =>
        agreementWith(20 + index, {
          companyName: name,
          signatoryTitle: name,
          document: { id: 11, name },
          installation: { accountLogin: name },
        }),
      ),
      nextCursor: null,
    },
  ]);
  renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  const table = await screen.findByRole('table');
  expect(activeContent(table)).toEqual([]);
  expect(table.querySelector('a')).toBeNull();
  for (const name of hostile) {
    expect(table.textContent).toContain(name);
  }
});

test('a visitor without a session is sent to the login with the page as return_to', async () => {
  answerAgreements([{ items: [], nextCursor: null }]);
  const assign = spyOnPageNavigation();
  renderWithProviders(<AppRouter />, { route: ROUTE });
  await vi.waitFor(() => {
    expect(assign).toHaveBeenCalledExactlyOnceWith(`/api/auth/login?return_to=${encodeURIComponent(ROUTE)}`);
  });
});
