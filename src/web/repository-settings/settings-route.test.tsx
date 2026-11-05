// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { expect, test, vi } from 'vitest';
import { sessionRoute } from '../../shared/auth-contract.ts';
import { answer } from '../api/test-support.ts';
import * as navigate from '../auth/navigate.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { renderWithProviders } from '../test-support/render.tsx';
import { server } from '../test-support/server.ts';
import { ALICE } from '../test-support/session.ts';
import { on, SETTINGS_ADDRESS } from './test-support.ts';

// E22-S03: the address of the settings screen. Only row ids make an address, and only a signed-in person reaches the screen.

test('the document title is the title of the screen', async () => {
  answer('/api/installations/7/repositories/42/badge-snippet', on());
  renderWithProviders(<AppRouter />, { route: SETTINGS_ADDRESS, session: ALICE });
  await screen.findByRole('heading', { level: 1, name: messages['repository.settings.title'] });
  expect(document.title).toBe(`${messages['repository.settings.title']} · CLA`);
});

test.each([
  ['a name', '/installations/acme/repositories/42/settings'],
  ['a zero', '/installations/0/repositories/42/settings'],
  ['a leading zero', '/installations/007/repositories/42/settings'],
  ['a sign', '/installations/7/repositories/-1/settings'],
  ['a decimal point', '/installations/7/repositories/4.2/settings'],
  ['sixteen digits', '/installations/7/repositories/1234567890123456/settings'],
])('an address with %s for an id is the not-found page, and nothing is asked of the server', async (_what, address) => {
  const seen = answer('/api/installations/:installationId/repositories/:repositoryId/badge-snippet', on());
  renderWithProviders(<AppRouter />, { route: address, session: ALICE });
  expect(await screen.findByText(messages['states.notFound.message'])).toBeInTheDocument();
  expect(seen).toEqual([]);
});

test('the largest id of fifteen digits is an address', async () => {
  const seen = answer('/api/installations/999999999999999/repositories/1/badge-snippet', on());
  renderWithProviders(<AppRouter />, {
    route: '/installations/999999999999999/repositories/1/settings',
    session: ALICE,
  });
  await screen.findByRole('checkbox', { name: messages['repository.badge.toggle'] });
  expect(seen).toHaveLength(1);
});

test('a visitor without a session is sent to the login and the screen asks nothing of the server', async () => {
  const assign = vi.spyOn(navigate, 'navigateToPage').mockImplementation(() => undefined);
  server.use(
    http.get(sessionRoute.path, () =>
      HttpResponse.json({ error: { code: 'unauthorized', message: 'x', requestId: 'r-1' } }, { status: 401 }),
    ),
  );
  const seen = answer('/api/installations/7/repositories/42/badge-snippet', on());
  renderWithProviders(<AppRouter />, { route: SETTINGS_ADDRESS });
  await vi.waitFor(() => {
    expect(assign).toHaveBeenCalledExactlyOnceWith(`/api/auth/login?return_to=${encodeURIComponent(SETTINGS_ADDRESS)}`);
  });
  expect(seen).toEqual([]);
  expect(screen.queryByRole('heading', { level: 1, name: messages['repository.settings.title'] })).toBeNull();
});
