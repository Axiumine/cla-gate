// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { spyOnPageNavigation } from '../test-support/location.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { ALICE, CSRF_TOKEN } from '../test-support/session.ts';
import { answerAvailability, answerClaim, claimBox, claimButton, REPO_ID } from './test-support.ts';

// E21-S04: the page at /corporate/claim/:githubRepoId in the shell of the app, and the form it holds.

const ROUTE = `/corporate/claim/${REPO_ID}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

test('a repository that offers the claim shows the entry, the box and the button in the main landmark, and passes axe', async () => {
  answerAvailability(true);
  const { container } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  const entry = await screen.findByRole('heading', { level: 2, name: messages['corporate.claim.title'] });
  const page = screen.getByRole('heading', { level: 1, name: messages['corporate.claim.pageTitle'] });
  expect(screen.getByRole('main')).toContainElement(entry);
  expect(screen.getByRole('main')).toContainElement(page);
  expect(screen.getByText(messages['corporate.claim.intro'])).toBeInTheDocument();
  expect(claimBox()).not.toBeChecked();
  expect(document.title).toBe(`${messages['corporate.claim.pageTitle']} · CLA`);
  await expectNoA11yViolations(container);
});

test('a repository that does not offer the claim says so in one line, whatever the reason, and shows no entry', async () => {
  answerAvailability(false);
  renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  expect(await screen.findByText(messages['corporate.claim.unavailable'])).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: messages['corporate.claim.title'] })).toBeNull();
  expect(screen.queryByRole('button', { name: messages['corporate.claim.submit'] })).toBeNull();
});

test('a visitor without a session is sent to the login with the page as return_to, and the entry is not shown', async () => {
  answerAvailability(true);
  const assign = spyOnPageNavigation();
  renderWithProviders(<AppRouter />, { route: ROUTE });
  await vi.waitFor(() => {
    expect(assign).toHaveBeenCalledExactlyOnceWith(`/api/auth/login?return_to=${encodeURIComponent(ROUTE)}`);
  });
  expect(screen.queryByRole('heading', { name: messages['corporate.claim.title'] })).toBeNull();
});

test('the claim sends the confirmation and the CSRF token, and the success says "Covered by a corporate CLA" and names no company', async () => {
  answerAvailability(true);
  const posted = answerClaim('covered');
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  await screen.findByRole('heading', { level: 2, name: messages['corporate.claim.title'] });
  await user.click(claimBox());
  await user.click(claimButton());
  expect(await screen.findByText('Covered by a corporate CLA')).toBeInTheDocument();
  expect(screen.getByText(messages['corporate.claim.doneDetail'])).toBeInTheDocument();
  expect(posted).toEqual([{ csrf: CSRF_TOKEN, body: { confirm: true } }]);
  expect(screen.queryByRole('button', { name: messages['corporate.claim.submit'] })).toBeNull();
});

test('a person who is covered already is told the same words as one who got covered now', async () => {
  answerAvailability(true);
  answerClaim('already_covered');
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  await screen.findByRole('heading', { level: 2, name: messages['corporate.claim.title'] });
  await user.click(claimBox());
  await user.click(claimButton());
  expect(await screen.findByText(messages['corporate.claim.done'])).toBeInTheDocument();
});

test('the button with the box unticked names what is missing and asks the server nothing', async () => {
  answerAvailability(true);
  const posted = answerClaim('covered');
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  await screen.findByRole('heading', { level: 2, name: messages['corporate.claim.title'] });
  expect(screen.queryByText(messages['corporate.claim.confirmRequired'])).toBeNull();
  await user.click(claimButton());
  expect(await screen.findByText(messages['corporate.claim.confirmRequired'])).toBeInTheDocument();
  expect(posted).toEqual([]);
});

test.each([
  [409, 'no_matching_approval', messages['corporate.error.no_matching_approval']],
  [503, 'upstream_unavailable', messages['corporate.error.upstream_unavailable']],
  [409, 'installation_suspended', messages['corporate.error.installation_suspended']],
  [409, 'version_outdated', messages['corporate.error.version_outdated']],
] as const)(
  'a %i %s answer is told in the words of the catalog, the form stays and the person may try again',
  async (status, code, words) => {
    answerAvailability(true);
    const posted = answerClaim({ status, code });
    const { user } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
    await screen.findByRole('heading', { level: 2, name: messages['corporate.claim.title'] });
    await user.click(claimBox());
    await user.click(claimButton());
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(words)).toBeInTheDocument();
    expect(within(alert).queryByRole('button')).toBeNull();
    await user.click(claimButton());
    await vi.waitFor(() => {
      expect(posted).toHaveLength(2);
    });
  },
);

test('a limit or a failure with no corporate code is shown by the generic state, with its request ID', async () => {
  answerAvailability(true);
  answerClaim({ status: 500, code: 'internal_server_error' });
  const { user } = renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  await screen.findByRole('heading', { level: 2, name: messages['corporate.claim.title'] });
  await user.click(claimBox());
  await user.click(claimButton());
  expect(await screen.findByText(messages['errors.internal_server_error'])).toBeInTheDocument();
  expect(screen.getByText('req-claim')).toBeInTheDocument();
});

test('a failure to ask whether the repository offers the claim is the generic state of the page', async () => {
  answerAvailability({ status: 500, code: 'internal_server_error' });
  renderWithProviders(<AppRouter />, { route: ROUTE, session: ALICE });
  expect(await screen.findByText(messages['errors.internal_server_error'])).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: messages['corporate.claim.submit'] })).toBeNull();
});

test.each(['abc', '0', '012', '1.5', '99999999999999999'])(
  'the address /corporate/claim/%s is the not-found page',
  async (id) => {
    renderWithProviders(<AppRouter />, { route: `/corporate/claim/${id}`, session: ALICE });
    expect(
      await screen.findByRole('heading', { level: 1, name: messages['states.notFound.title'] }),
    ).toBeInTheDocument();
  },
);
