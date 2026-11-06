// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';
import { messages } from '../i18n/index.ts';

/** What a test of a screen holds from its render: the person, the query cache and the way to end the session. */
export interface LoggedInApp {
  readonly user: UserEvent;
  readonly queryClient: QueryClient;
  readonly setSession: (session: undefined) => void;
}

/**
 * The person logs out of the screen (the server answers `204`, so the session is gone when the page asks again): the app falls back to
 * its first page, the cache holds no query of any tenant, and `shown`, a text that only a tenant's data has, is nowhere on the page.
 */
export async function logOutAndExpectNoTrace(
  { user, queryClient, setSession }: LoggedInApp,
  shown: string,
): Promise<void> {
  setSession(undefined);
  await user.click(screen.getByRole('button', { name: messages['auth.logout'] }));
  await screen.findByRole('heading', { level: 1, name: messages['app.name'] });
  expect(queryClient.getQueryCache().findAll({ queryKey: ['installation'] })).toEqual([]);
  expect(screen.queryByText(shown)).toBeNull();
}
