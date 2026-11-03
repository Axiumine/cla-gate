// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { classNames } from './class-names.ts';

// E17-S06: the class-name joiner the primitives share.

type Parts = readonly (string | false | undefined)[];

test.each<[what: string, parts: Parts, expected: string]>([
  ['names in order', ['a', 'b', 'c'], 'a b c'],
  ['nothing at all', [], ''],
  ['a false condition', ['a', false, 'c'], 'a c'],
  ['an absent class name', ['a', undefined, 'c'], 'a c'],
  ['an empty string', ['a', '', 'c'], 'a c'],
  ['only absent parts', [false, undefined, ''], ''],
])('joins %s', (_what, parts, expected) => {
  expect(classNames(...parts)).toBe(expected);
});
