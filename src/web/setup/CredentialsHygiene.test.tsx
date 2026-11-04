// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { HOSTILE_NAMES } from '../../shared/hostile-names.ts';
import { messages } from '../i18n/index.ts';
import { AppRouter } from '../router.tsx';
import { activeContent } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { Credentials } from './Credentials.tsx';
import {
  CONVERTED,
  copyButton,
  downloadButton,
  openCredentials,
  revealButton,
  SETUP_CSRF,
  SETUP_TOKEN,
  serveSetup,
  spyOnConsole,
  stubDownloads,
  stubRequestSubmit,
  unlockThroughThePage,
} from './test-support.ts';

// E19-S07: the credentials are in the mutation result and on the screen, and nowhere else: no address, no history state, no
// Web Storage, no cookie, no query cache, no console, no document head; and they are gone when the page is left.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** One distinctive piece of each secret, as it is in the JSON of a cache and in the DOM (the key is several lines, so a line of it). */
const SECRET_PIECES = [
  'made-up-client-secret-VALUE-1',
  'made-up-webhook-secret-VALUE-2',
  'made-up-private-key-VALUE-3',
];

/** The three secrets, by the label of their fields. */
const SECRET_LABELS = [
  'secrets/github_client_secret',
  'secrets/github_webhook_secret',
  'secrets/github_app_private_key',
];

/** The text of everything a cache holds: the data of every query and of every mutation, and the mutation's variables. */
function cacheText(queryClient: QueryClient): string {
  const queries = queryClient
    .getQueryCache()
    .getAll()
    .map((query) => query.state.data);
  const mutations = queryClient
    .getMutationCache()
    .getAll()
    .map((mutation) => [mutation.state.data, mutation.state.variables]);
  return JSON.stringify([queries, mutations]);
}

function expectNoneOf(text: string, pieces: readonly string[], where: string): void {
  for (const piece of pieces) {
    expect(text, `${piece} in ${where}`).not.toContain(piece);
  }
}

/** Everything the browser keeps for a page, as one text. */
function browserText(): string {
  return JSON.stringify([
    Object.entries(localStorage),
    Object.entries(sessionStorage),
    document.cookie,
    window.location.href,
    // type-coverage:ignore-next-line -- the DOM library types history.state as any; it is only turned into text
    window.history.state,
    document.head.innerHTML,
  ]);
}

test('with the credentials on the screen, revealed, copied and downloaded, none is in storage, cookie, address, history, head or console', async () => {
  const logged = spyOnConsole();
  stubDownloads();
  const { user } = await openCredentials();
  for (const label of SECRET_LABELS) {
    await user.click(revealButton(label));
    await user.click(copyButton(label));
    await user.click(downloadButton(label));
  }
  expectNoneOf(
    browserText(),
    [...SECRET_PIECES, CONVERTED.clientId, String(CONVERTED.appId)],
    'what the browser keeps',
  );
  expect(localStorage).toHaveLength(0);
  expect(sessionStorage).toHaveLength(0);
  expect(document.cookie).toBe('');
  expect(window.location.search).toBe('');
  expect(logged()).toBe('[]');
});

test('the credentials are in no query: the query cache holds the setup status and the session, not the conversion', async () => {
  const { queryClient } = await openCredentials();
  expectNoneOf(
    JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => [query.queryKey, query.state.data]),
    ),
    [...SECRET_PIECES, CONVERTED.clientId],
    'the query cache',
  );
});

test('they are in one mutation, kept for no time once nothing watches it, and its variables are only the code and the state', async () => {
  const { queryClient } = await openCredentials();
  const mutations = queryClient.getMutationCache().getAll();
  expect(mutations).toHaveLength(1);
  expect(mutations[0]?.gcTime).toBe(0);
  expect(JSON.stringify(mutations[0]?.state.variables ?? null)).not.toContain('VALUE');
  expect(cacheText(queryClient)).toContain(SECRET_PIECES[0]);
});

test('leaving the page empties the mutation cache: the credentials are no longer held anywhere', async () => {
  const { queryClient, unmount } = await openCredentials();
  unmount();
  await waitFor(() => {
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });
  expectNoneOf(cacheText(queryClient), SECRET_PIECES, 'the caches after the page was left');
});

test('pagehide clears the screen and the mutation result, so a page restored from the back/forward cache shows none of them', async () => {
  const { queryClient, user } = await openCredentials();
  await user.click(revealButton('secrets/github_client_secret'));
  expect(document.body.innerHTML).toContain(CONVERTED.clientSecret);
  act(() => {
    window.dispatchEvent(new Event('pagehide'));
  });
  expect(await screen.findByRole('heading', { level: 1, name: messages['setup.callback.title'] })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: messages['setup.credentials.title'] })).toBeNull();
  expectNoneOf(document.documentElement.outerHTML, [...SECRET_PIECES, CONVERTED.clientId], 'the page after pagehide');
  await waitFor(() => {
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });
  expectNoneOf(cacheText(queryClient), SECRET_PIECES, 'the caches after pagehide');
});

test('the whole flow, unlock, form, posting, and then the return and the credentials, leaves storage, cookie and console clean', async () => {
  const logged = spyOnConsole();
  stubRequestSubmit();
  serveSetup();
  const first = renderWithProviders(<AppRouter />, { route: '/setup' });
  await unlockThroughThePage(first.user);
  await first.user.click(screen.getByRole('button', { name: messages['setup.app.submit'] }));
  await screen.findByRole('heading', { level: 1, name: messages['setup.post.title'] });
  expectNoneOf(
    `${browserText()}${first.container.innerHTML}`,
    [SETUP_TOKEN, SETUP_CSRF],
    'the setup page after the posting step',
  );
  first.unmount();
  const { queryClient, container } = await openCredentials();
  expectNoneOf(browserText(), [SETUP_TOKEN, SETUP_CSRF, ...SECRET_PIECES], 'what the browser keeps');
  expectNoneOf(container.innerHTML, [SETUP_TOKEN, SETUP_CSRF], 'the credentials page');
  expect(localStorage).toHaveLength(0);
  expect(sessionStorage).toHaveLength(0);
  expect(document.cookie).toBe('');
  expectNoneOf(
    JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
    [SETUP_TOKEN],
    'the query cache',
  );
  expect(logged()).toBe('[]');
});

test('hostile text in every field of the conversion stays text: no script, no image, no link that runs script, no link off GitHub', async () => {
  for (const name of HOSTILE_NAMES) {
    const { container, user, unmount } = renderWithProviders(
      <Credentials
        result={{
          ...CONVERTED,
          slug: name,
          htmlUrl: name,
          clientId: name,
          clientSecret: name,
          webhookSecret: name,
          privateKeyPem: name,
        }}
      />,
    );
    for (const label of SECRET_LABELS) {
      await user.click(revealButton(label));
    }
    expect(activeContent(container), `rendering ${JSON.stringify(name)}`).toEqual([]);
    const addresses = [...container.querySelectorAll('a')].map((link) => link.getAttribute('href') ?? '');
    for (const address of addresses) {
      expect(address.startsWith('https://github.com/'), `${address} for ${JSON.stringify(name)}`).toBe(true);
    }
    for (const link of container.querySelectorAll('a')) {
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(screen.getByLabelText('GITHUB_CLIENT_ID')).toHaveValue(name);
    expect(screen.getByLabelText('secrets/github_app_private_key')).toHaveValue(name);
    unmount();
  }
});
