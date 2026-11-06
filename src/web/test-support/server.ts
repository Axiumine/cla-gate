// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { OPERATOR_INSTALLATIONS_PATH } from '../../shared/operator.ts';

/**
 * What the server says to a person who does not operate the instance (E11-S08): the `404 not_found` of a route that does not exist. The
 * user menu asks for it on every page of a signed-in person (E18-S13), so it is a handler of the server itself and not of each test; a test
 * of the operator screen answers differently with `server.use(...)`, which takes precedence.
 */
const NOT_OPERATOR = http.get(OPERATOR_INSTALLATIONS_PATH, () =>
  HttpResponse.json({ error: { code: 'not_found', message: 'Not found', requestId: 'test-request' } }, { status: 404 }),
);

/**
 * The one MSW server of the web tests (E17-S01). The setup file (vitest.setup.ts) starts it for every test file, refuses
 * any request that has no handler and removes the handlers a test added; a test adds its own with `server.use(...)`.
 */
export const server = setupServer(NOT_OPERATOR);
