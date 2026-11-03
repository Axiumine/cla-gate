// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { logoutRequestSchema, sessionResponseSchema } from './auth.ts';
import { defineRoute } from './contract.ts';

// The descriptors of the session routes of E10 (E17-S04). The server registers `/api/auth/session` and
// `/api/auth/logout` from these values and the web client calls them through the same ones. Login start is a browser
// navigation, not an API call, so it has no descriptor; its path and its one parameter are the constants below.

/** `GET /api/auth/session` (E10-S02): the caller, until when, and the CSRF token. Without a live session it is a 401. */
export const sessionRoute = defineRoute({
  method: 'GET',
  path: '/api/auth/session',
  responses: { 200: sessionResponseSchema },
});

/**
 * `POST /api/auth/logout` (E10-S06): no body, or `{}`, or `{ "everywhere": true }`; unknown keys are a 400. A call with
 * no body sends no body at all, because an empty body labelled `application/json` is a 400 too.
 */
export const logoutRoute = defineRoute({
  method: 'POST',
  path: '/api/auth/logout',
  body: logoutRequestSchema,
  responses: { 204: z.undefined() },
});

/**
 * The header that carries the CSRF token on every POST, PUT, PATCH and DELETE (E10-S03). The token is the `csrfToken` of
 * the session response; the server compares it in constant time and answers `403 csrf_invalid` when it is missing or wrong.
 */
export const CSRF_HEADER = 'x-csrf-token';

/**
 * `GET /api/auth/login` (E10-S04): the start of the login. A link the browser follows with a full-page navigation, never
 * an API call, so it has no route descriptor. It writes nothing, which is why a plain link is enough (E17-S08).
 */
export const LOGIN_PATH = '/api/auth/login';

/** The one parameter of {@link LOGIN_PATH}: the path on this site where the login ends. The server checks it again (E10-S04). */
export const LOGIN_RETURN_TO_PARAM = 'return_to';
