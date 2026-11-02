// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { queries, type RenderResult, render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import type { ReactElement } from 'react';
import type { z } from 'zod';
import { sessionResponseSchema } from '../../shared/auth.ts';
import { I18nProvider } from '../i18n/index.ts';
import { server } from './server.ts';

/** The session endpoint of E10-S02; E17-S04 replaces this literal with the shared route descriptor. */
const SESSION_PATH = '/api/auth/session';

export interface RenderOptions {
  /** The path, with its query string, the app starts on: `/` when absent. */
  readonly route?: string;
  /** The signed-in user the session endpoint answers with. Absent means anonymous: the endpoint answers 401. */
  readonly session?: z.input<typeof sessionResponseSchema>;
}

export interface Rendered extends RenderResult {
  /** A user-event instance for this render: `await user.click(...)`, `await user.keyboard(...)`. */
  readonly user: UserEvent;
}

/** The answer of the server to a request without a live session (E10-S02): 401 with the standard error body. */
function anonymous(): Response {
  const error = { code: 'unauthorized', message: 'Unauthorized', requestId: 'test-request' };
  return HttpResponse.json({ error }, { status: 401 });
}

/**
 * Renders `ui` the way the app runs: on `route`, inside the i18n provider (E17-S02), with the session endpoint answering as
 * `session` says. The query client, router and theme providers join here as E17-S04 to E17-S08 land, so a test written
 * now keeps working. The session
 * is checked against the shared contract, so a fixture that the server could never send fails the test that uses it. The
 * result is Testing Library's plus `user`, the user-event instance that acts on that render.
 */
export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}): Rendered {
  const { route = '/', session } = options;
  window.history.replaceState(null, '', route);
  const body = session === undefined ? undefined : sessionResponseSchema.parse(session);
  server.use(http.get(SESSION_PATH, () => (body === undefined ? anonymous() : HttpResponse.json(body))));
  return { ...render(ui, { wrapper: I18nProvider, queries }), user: userEvent.setup() };
}
