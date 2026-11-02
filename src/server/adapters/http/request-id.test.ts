// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import { generateRequestId } from './request-id.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test.each([['trace-1234'], ['0a1b2c3d4e5f.6789_ABC-def'], ['a'.repeat(64)], ['8f14e45f-ceea-4f3d-9b6b-1d8a9c0e4a77']])(
  'a well formed id %j from the caller is kept',
  (id) => {
    expect(generateRequestId({ headers: { 'x-request-id': id } })).toBe(id);
  },
);

test.each([
  ['missing', {}],
  ['too short', { 'x-request-id': 'abc' }],
  ['too long', { 'x-request-id': 'a'.repeat(65) }],
  ['with spaces', { 'x-request-id': 'forged line text' }],
  ['with a quote', { 'x-request-id': 'abcdefgh"}{' }],
  ['repeated', { 'x-request-id': ['abcdefgh', 'ijklmnop'] }],
])('an id that is %s is replaced by a fresh UUID', (_label, headers) => {
  const id = generateRequestId({ headers });
  expect(id).toMatch(UUID);
  expect(generateRequestId({ headers })).not.toBe(id);
});

test.each([[WEBHOOK_PATH], [`${WEBHOOK_PATH}?delivery=1`]])(
  'the webhook path never keeps the id of the caller, so no header value of a delivery reaches the log (E06-S07): %s',
  (url) => {
    const headers = { 'x-request-id': 'trace-1234' };
    expect(generateRequestId({ headers, url })).toMatch(UUID);
  },
);

test.each([['/healthz'], ['/api/me?x=1'], [`${WEBHOOK_PATH}/extra`], ['/webhooks/githubx'], [undefined]])(
  'every other path keeps a well formed id of the caller: %j',
  (url) => {
    expect(generateRequestId({ headers: { 'x-request-id': 'trace-1234' }, url })).toBe('trace-1234');
  },
);
