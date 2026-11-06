// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ANONYMOUS_REFUSALS, isExpectedRefusal, type Refusal } from './console-rules.ts';

const line = (status: number, reason: string): string =>
  `Failed to load resource: the server responded with a status of ${String(status)} (${reason})`;
const REFUSED = line(401, 'Unauthorized');

test.each([
  [REFUSED, 'http://127.0.0.1:40000/api/auth/session'],
  [REFUSED, 'http://127.0.0.1:40000/api/sign/71000101'],
  [REFUSED, 'http://127.0.0.1:40000/api/sign/71000101?pr=23'],
  ['Failed to load resource: the server responded with a status of 401 ()', '/api/auth/session'],
])('%s from %s is the refusal of a visitor with no session', (text, address) => {
  expect(isExpectedRefusal(text, address, ANONYMOUS_REFUSALS)).toBe(true);
});

test.each([
  ['a 403 from the session endpoint', line(403, 'Forbidden'), '/api/auth/session'],
  ['a 500 from the session endpoint', line(500, 'Internal Server Error'), '/api/auth/session'],
  ['a 401 from a tenant route', REFUSED, '/api/installations'],
  ['a 401 from a path that only starts like the session', REFUSED, '/api/auth/session/extra'],
  ['a 401 from a path that only starts like the sign route', REFUSED, '/api/signature'],
  ['a script error', "Uncaught TypeError: Cannot read properties of undefined (reading 'x')", '/api/auth/session'],
  ['a message that only quotes the line', `Error: ${REFUSED}`, '/api/auth/session'],
  ['a line with no status', 'Failed to load resource: net::ERR_FAILED', '/api/auth/session'],
])('%s is a problem', (_name, text, address) => {
  expect(isExpectedRefusal(text, address, ANONYMOUS_REFUSALS)).toBe(false);
});

const TENANT_404: readonly Refusal[] = [{ status: 404, path: '/api/installations/9003', within: true }];

test('a refusal a spec names covers the path and everything below it, with that status only', () => {
  const answer = line(404, 'Not Found');
  expect(isExpectedRefusal(answer, 'http://127.0.0.1:1/api/installations/9003', TENANT_404)).toBe(true);
  expect(isExpectedRefusal(answer, 'http://127.0.0.1:1/api/installations/9003/documents?limit=100', TENANT_404)).toBe(
    true,
  );
  expect(isExpectedRefusal(answer, 'http://127.0.0.1:1/api/installations/90031/documents', TENANT_404)).toBe(false);
  expect(isExpectedRefusal(line(500, 'Internal Server Error'), '/api/installations/9003/documents', TENANT_404)).toBe(
    false,
  );
});

test('nothing is expected when the spec names nothing', () => {
  expect(isExpectedRefusal(REFUSED, '/api/auth/session', [])).toBe(false);
});
