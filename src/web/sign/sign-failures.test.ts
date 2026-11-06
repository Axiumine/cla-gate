// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { ApiError, ContractError, NetworkError } from '../api/index.ts';
import { isNoActiveCla, isStaleRefusal, isUnauthenticated } from './sign-failures.ts';

// E18-S02: which failures of the sign page's requests are states of the page. Each answer is read by status and code together.

const error = (status: number, code: string) => new ApiError({ status, code });

test.each([
  [error(401, 'unauthenticated'), true],
  [error(401, 'unauthorized'), true],
  [error(403, 'forbidden'), false],
  [error(404, 'not_found'), false],
  [error(500, 'internal_server_error'), false],
  [new NetworkError(new Error('offline')), false],
  [new ContractError('GET /x', 'response', []), false],
  ['401', false],
  [undefined, false],
])('%j is a missing session: %s', (failure, expected) => {
  expect(isUnauthenticated(failure)).toBe(expected);
});

test.each([
  [error(409, 'no_active_cla'), true],
  [error(409, 'conflict'), false],
  [error(409, 'stale_version'), false],
  [error(404, 'no_active_cla'), false],
  [error(422, 'no_active_cla'), false],
  [new NetworkError(new Error('offline')), false],
  [{ status: 409, code: 'no_active_cla' }, false],
  [undefined, false],
])('%j is a repository with no CLA in force: %s', (failure, expected) => {
  expect(isNoActiveCla(failure)).toBe(expected);
});

test.each([
  [error(409, 'stale_version'), true],
  [error(409, 'stale_consent'), true],
  [error(409, 'no_active_cla'), false],
  [error(409, 'unsupported_document_kind'), false],
  [error(422, 'hash_mismatch'), false],
  [error(422, 'stale_version'), false],
  [new ContractError('POST /x', 'body', []), false],
  [{ status: 409, code: 'stale_version' }, false],
  [undefined, false],
])('%j is a refusal because the text is out of date: %s', (failure, expected) => {
  expect(isStaleRefusal(failure)).toBe(expected);
});
