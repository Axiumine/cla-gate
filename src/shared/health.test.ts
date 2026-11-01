// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { healthResponseSchema, readyResponseSchema, unavailableResponseSchema } from './health.ts';

test.each([
  ['health', healthResponseSchema, { status: 'ok' }, { status: 'ready' }],
  ['ready', readyResponseSchema, { status: 'ready' }, { status: 'ok' }],
  ['unavailable', unavailableResponseSchema, { status: 'unavailable' }, { status: 'ready' }],
])('the %s response accepts only its own status', (_name, schema, valid, invalid) => {
  expect(schema.safeParse(valid).success).toBe(true);
  expect(schema.safeParse(invalid).success).toBe(false);
});

test('a response with a missing status is rejected', () => {
  expect(healthResponseSchema.safeParse({}).success).toBe(false);
});
