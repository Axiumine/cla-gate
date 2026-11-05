// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { mapFound, whenPresent } from './when-present.ts';

test('whenPresent applies the filter with the value, and returns what the filter returned', () => {
  expect(whenPresent(['a'], 'b', (list, value) => [...list, value])).toEqual(['a', 'b']);
  expect(whenPresent(0, 5, (total, value) => total + value)).toBe(5);
});

test('whenPresent gives the query back untouched, without calling the filter, when there is no value', () => {
  const query = ['a'];
  const apply = (list: string[], value: string) => [...list, value];
  const calls: string[] = [];
  const result = whenPresent(query, null, (list, value: string) => {
    calls.push(value);
    return apply(list, value);
  });
  expect(result).toBe(query);
  expect(calls).toEqual([]);
});

test('mapFound converts the row a statement found, and answers null, without converting, when it found none', () => {
  const converted: number[] = [];
  const convert = (row: number) => {
    converted.push(row);
    return `row ${String(row)}`;
  };
  expect(mapFound(undefined, convert)).toBeNull();
  expect(converted).toEqual([]);
  expect(mapFound(7, convert)).toBe('row 7');
  expect(converted).toEqual([7]);
});
