// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { AppError } from './errors.ts';
import { parseInput } from './request-body.ts';

const schema = z.strictObject({ name: z.string() });

test('an input of the shape the schema describes is returned parsed', () => {
  expect(parseInput(schema, { name: 'x' })).toEqual({ name: 'x' });
});

test.each([
  ['no input', undefined],
  ['null', null],
  ['an input of the wrong shape', { name: 7 }],
  ['a key the schema does not know', { name: 'x', other: 1 }],
  ['a list', [{ name: 'x' }]],
])('%s is a 400 bad_request', (_label, input) => {
  expect(() => parseInput(schema, input)).toThrow(AppError);
  expect(() => parseInput(schema, input)).toThrow(expect.objectContaining({ status: 400, code: 'bad_request' }));
});
