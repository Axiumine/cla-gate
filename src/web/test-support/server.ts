// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { CORPORATE_AVAILABILITY_PATH } from '../../shared/corporate-claims.ts';
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
 * What the server says of a repository that has no corporate agreement in force, which is nearly every repository (E21-S04): the claim of an
 * employee is not offered. The sign page asks for it whenever it shows a form, so it is a handler of the server itself and not of each
 * test; a test of the entry answers `true` with `server.use(...)` (`answerAvailability` in corporate/test-support.ts).
 */
const NO_CORPORATE_AGREEMENT = http.get(CORPORATE_AVAILABILITY_PATH, () =>
  HttpResponse.json({ corporateAvailable: false }),
);

/**
 * The one MSW server of the web tests (E17-S01). The setup file (vitest.setup.ts) starts it for every test file, refuses
 * any request that has no handler and removes the handlers a test added; a test adds its own with `server.use(...)`.
 */
export const server = setupServer(NOT_OPERATOR, NO_CORPORATE_AGREEMENT);
