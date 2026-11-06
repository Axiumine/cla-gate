// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { logoutRoute } from '../../shared/auth-contract.ts';
import { answer, envelope, json } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { spyOnPageNavigation } from '../test-support/location.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { ALICE } from '../test-support/session.ts';
import {
  item,
  openList,
  openMine,
  pageOf,
  renderMine,
  serveOnePage,
  serveSignatures,
  signaturesTable,
} from './test-support.ts';

// E18-S03: the empty list, a failing endpoint, the notice of what maintainers can see, the guard of the route and the entry in
// the navigation.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('an empty list says that nothing was signed yet, with an explanation, and shows no table and no pager', async () => {
  serveOnePage();
  const { container } = await openMine();
  expect(
    await screen.findByRole('heading', { level: 2, name: messages['me.signatures.empty.title'] }),
  ).toHaveTextContent('You have not signed any CLA yet');
  expect(screen.getByText(messages['me.signatures.empty.description'])).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('navigation', { name: messages['pager.label'] })).toBeNull();
  await expectNoA11yViolations(container);
});

test('a failing endpoint shows the error state with the request ID, and "Try again" asks again and shows the list', async () => {
  let failing = true;
  serveSignatures([[null, () => (failing ? envelope(500, 'internal_server_error') : pageOf([item()]))]]);
  const { user, container } = await openMine();
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.internal_server_error']);
  expect(alert).toHaveTextContent('req-00000001');
  expect(screen.queryByRole('table')).toBeNull();
  await expectNoA11yViolations(container);
  failing = false;
  await user.click(screen.getByRole('button', { name: messages['states.retry'] }));
  expect(await screen.findByRole('table')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a refetch that fails leaves the list on screen with a banner above it', async () => {
  let failing = false;
  serveSignatures([[null, () => (failing ? envelope(503, 'service_unavailable') : pageOf([item()]))]]);
  const { queryClient } = await openList();
  failing = true;
  await act(async () => {
    await queryClient.refetchQueries();
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(messages['errors.service_unavailable']);
  expect(within(signaturesTable()).getByText('Individual CLA')).toBeInTheDocument();
});

test('a 429 on the list shows the countdown state of the error state', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  serveSignatures([[null, () => envelope(429, 'too_many_requests', { 'retry-after': '7' })]]);
  renderMine();
  expect(await screen.findByText('You can try again in 7 seconds.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: messages['states.retry'] })).toBeDisabled();
});

test('the notice states exactly what maintainers can see: the name typed, the GitHub login and the verified email chosen', async () => {
  serveOnePage(item());
  await openList();
  expect(screen.getByRole('heading', { level: 2, name: messages['me.signatures.notice.title'] })).toBeInTheDocument();
  const notice = screen.getByText(messages['me.signatures.notice.body']);
  expect(notice).toHaveTextContent(/name you typed, your GitHub login and the verified email address you chose/u);
});

test('the page title is "My signatures" in the tab, and the list is announced with it', async () => {
  serveOnePage(item());
  await openList();
  expect(document.title).toBe('My signatures · CLA');
});

test('a visitor without a session is sent to the login with the page itself as return_to, and nothing is asked of the list', async () => {
  // The stub of `location` copies the address the page has now, so the address is set first.
  window.history.replaceState(null, '', '/me/signatures?cursor=c2');
  const assign = spyOnPageNavigation();
  const seen = serveOnePage(item());
  renderWithProviders(<AppRouter />, { route: '/me/signatures?cursor=c2' });
  await waitFor(() => {
    expect(assign).toHaveBeenCalledExactlyOnceWith('/api/auth/login?return_to=%2Fme%2Fsignatures%3Fcursor%3Dc2');
  });
  expect(seen).toHaveLength(0);
  expect(screen.queryByRole('table')).toBeNull();
});

test('the navigation has a link to the screen, which opens it and is marked as the current page', async () => {
  serveOnePage(item());
  const { user } = renderWithProviders(<AppRouter />, { session: ALICE });
  await user.click(await screen.findByRole('link', { name: messages['nav.signatures'], hidden: true }));
  expect(await screen.findByRole('heading', { level: 1, name: messages['me.signatures.title'] })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/me/signatures');
  expect(screen.getByRole('link', { name: messages['nav.signatures'], hidden: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('the list is dropped from the cache when the person logs out', async () => {
  serveOnePage(item());
  answer(logoutRoute.path, json(null, 204));
  const { user, queryClient, setSession } = await openList();
  expect(queryClient.getQueryCache().find({ queryKey: ['me', 'signatures', null], exact: true })).toBeDefined();
  setSession(undefined);
  await user.click(screen.getByRole('button', { name: messages['auth.logout'] }));
  await screen.findAllByRole('link', { name: messages['auth.login'] });
  expect(queryClient.getQueryCache().find({ queryKey: ['me', 'signatures', null], exact: true })).toBeUndefined();
});
