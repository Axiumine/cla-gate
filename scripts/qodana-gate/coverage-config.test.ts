// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import vitestConfig from '../../vitest.config.ts';

// E20-S08: Vitest also writes coverage/lcov.info, which the coverage job uploads for Qodana. Nothing else about the
// coverage gate changes: the thresholds stay at 100% and the exclusion list stays the fixed one.

const coverage = vitestConfig.test?.coverage;

test('the coverage reporters are the terminal summary and lcov', () => {
  expect(coverage).toMatchObject({ provider: 'v8', reporter: ['text', 'lcov'] });
});

test('the thresholds are 100% and the exclusion list is the fixed one', () => {
  expect(coverage).toMatchObject({ thresholds: { 100: true } });
  expect(coverage?.include).toEqual(['src/**/*.{ts,tsx}', 'scripts/**/*.ts']);
  expect(coverage?.exclude).toEqual([
    '**/*.test.{ts,tsx}',
    '**/*.d.ts',
    '**/global-setup.ts',
    'e2e/**',
    'tests/leaks/**',
  ]);
});
