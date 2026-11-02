// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { jobIdFor } from './job-id.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('the id of a key is a UUID with the version nibble 5 and the RFC 4122 variant', () => {
  for (const key of ['5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c', 'a', '', 'x'.repeat(500)]) {
    expect(jobIdFor(key)).toMatch(UUID);
  }
});

test('the same key always gives the same id and another key another one', () => {
  expect(jobIdFor('delivery-1')).toBe(jobIdFor('delivery-1'));
  expect(jobIdFor('delivery-1')).not.toBe(jobIdFor('delivery-2'));
  expect(jobIdFor('delivery-1')).not.toBe(jobIdFor('Delivery-1'));
});

test('the id is pinned: a change of the derivation would orphan every job waiting under an old id', () => {
  expect(jobIdFor('5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c')).toBe('bef279f0-9028-53de-9d4f-75a957fca264');
});
