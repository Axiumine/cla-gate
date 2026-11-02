// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, expectTypeOf, test } from 'vitest';
import { type GithubId, githubIdSchema, parseGithubId } from './github-id.ts';

test.each([1, 41_898_282, Number.MAX_SAFE_INTEGER])('%d is a GitHub id', (value) => {
  expect(parseGithubId(value)).toBe(value);
});

test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '7', null, undefined, 7n])(
  '%s is not a GitHub id',
  (value) => {
    expect(() => parseGithubId(value)).toThrow();
    expect(githubIdSchema.safeParse(value).success).toBe(false);
  },
);

test('a GitHub id is a branded number: a plain number is not accepted where one is expected', () => {
  expectTypeOf<GithubId>().toExtend<number>();
  expectTypeOf<number>().not.toExtend<GithubId>();
  expectTypeOf(parseGithubId).returns.toEqualTypeOf<GithubId>();
});
