// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { QueryClient } from '@tanstack/react-query';
import { queries, type RenderResult, render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import type { ReactElement, ReactNode } from 'react';
import type { z } from 'zod';
import { sessionResponseSchema } from '../../shared/auth.ts';
import { sessionRoute } from '../../shared/auth-contract.ts';
import { createQueryClient } from '../api/query-client.ts';
import { AppProviders } from '../providers.tsx';
import { server } from './server.ts';

export interface RenderOptions {
  /** The path, with its query string, the app starts on: `/` when absent. */
  readonly route?: string;
  /** The signed-in user the session endpoint answers with. Absent means anonymous: the endpoint answers 401. */
  readonly session?: z.input<typeof sessionResponseSchema>;
}

export interface Rendered extends RenderResult {
  /** A user-event instance for this render: `await user.click(...)`, `await user.keyboard(...)`. */
  readonly user: UserEvent;
  /** The query cache of this render, to read, seed or clear from a test. */
  readonly queryClient: QueryClient;
}

/** The app's query client, except that a query never retries: a failing test fails at once instead of after the back-off. */
function testQueryClient(): QueryClient {
  const client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } });
  return client;
}

/** The answer of the server to a request without a live session (E10-S02): 401 with the standard error body. */
function anonymous(): Response {
  const error = { code: 'unauthorized', message: 'Unauthorized', requestId: 'test-request' };
  return HttpResponse.json({ error }, { status: 401 });
}

/**
 * Renders `ui` the way the app runs: on `route`, inside the providers of the app (`AppProviders`: the query client with
 * `retry: false`, the i18n provider of E17-S02 and the theme provider of E17-S05), with the session endpoint answering as
 * `session` says. The router joins there as E17-S08 lands, so a test written now keeps working. The session is checked
 * against the shared contract, so a fixture that the server could never send fails the test that uses it. The result is
 * Testing Library's plus `user`, the user-event instance that acts on that render, and its `queryClient`.
 */
export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}): Rendered {
  const { route = '/', session } = options;
  window.history.replaceState(null, '', route);
  const body = session === undefined ? undefined : sessionResponseSchema.parse(session);
  server.use(http.get(sessionRoute.path, () => (body === undefined ? anonymous() : HttpResponse.json(body))));
  const queryClient = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppProviders queryClient={queryClient}>{children}</AppProviders>
  );
  return { ...render(ui, { wrapper, queries }), user: userEvent.setup(), queryClient };
}
