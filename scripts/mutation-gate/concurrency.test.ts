// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CHILD_MIB, concurrencyFor, MAIN_MIB, MEMORY_SHARE } from './concurrency.ts';

// The number of Stryker processes follows the CPUs and the memory of the machine (stryker.config.mjs). The nightly run on a
// shared runner with 8 cores and 32 GB took the whole machine down with Stryker's default of 7 processes, and the same job
// has to run on 4 cores and 16 GB, and on a 32-core development machine, without a change of the config.

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

/** The bytes that hold exactly `children` children and the main process at the share of memory the run plans with. */
const holding = (children: number) => ((MAIN_MIB + children * CHILD_MIB) / MEMORY_SHARE) * MIB;

test('the figures are the measured ones: a child 3 GiB, the main process 2.5 GiB, 70% of the available memory', () => {
  expect([CHILD_MIB, MAIN_MIB, MEMORY_SHARE]).toEqual([3072, 2560, 0.7]);
});

test.each([
  { name: '4 cores and 16 GB, 13 GiB free', cpus: 4, free: 13, expected: 2 },
  { name: '8 cores and 32 GB, 28 GiB free', cpus: 8, free: 28, expected: 5 },
  { name: '32 cores and 64 GB, 60 GiB free', cpus: 32, free: 60, expected: 13 },
])('$name: $expected processes', ({ cpus, free, expected }) => {
  expect(concurrencyFor({ cpus, availableBytes: free * GIB })).toBe(expected);
});

test('with memory to spare the CPUs decide: Stryker default of one less than the CPUs above four, all of them up to four', () => {
  expect(concurrencyFor({ cpus: 8, availableBytes: 512 * GIB })).toBe(7);
  expect(concurrencyFor({ cpus: 5, availableBytes: 512 * GIB })).toBe(4);
  expect(concurrencyFor({ cpus: 4, availableBytes: 512 * GIB })).toBe(4);
  expect(concurrencyFor({ cpus: 2, availableBytes: 512 * GIB })).toBe(2);
  expect(concurrencyFor({ cpus: 1, availableBytes: 512 * GIB })).toBe(1);
});

test('when the memory is the smaller limit it decides', () => {
  expect(concurrencyFor({ cpus: 32, availableBytes: holding(3) })).toBe(3);
  expect(concurrencyFor({ cpus: 8, availableBytes: holding(6) })).toBe(6);
  expect(concurrencyFor({ cpus: 8, availableBytes: holding(7) })).toBe(7);
});

test('a child that does not fit whole is not counted: one byte short of a child is one process fewer', () => {
  expect(concurrencyFor({ cpus: 32, availableBytes: holding(4) })).toBe(4);
  expect(concurrencyFor({ cpus: 32, availableBytes: holding(4) - 1 })).toBe(3);
  expect(concurrencyFor({ cpus: 32, availableBytes: holding(4) + (CHILD_MIB * MIB * MEMORY_SHARE) / 2 })).toBe(4);
});

test('the main process comes off first: memory that holds only the main process and a half child still runs one process', () => {
  expect(concurrencyFor({ cpus: 8, availableBytes: holding(0) })).toBe(1);
  expect(concurrencyFor({ cpus: 8, availableBytes: holding(0.5) })).toBe(1);
  expect(concurrencyFor({ cpus: 8, availableBytes: holding(1) })).toBe(1);
  expect(concurrencyFor({ cpus: 8, availableBytes: holding(2) })).toBe(2);
});

test('a machine that cannot hold one child, or reports nothing, still gets one process and never zero or a negative count', () => {
  expect(concurrencyFor({ cpus: 8, availableBytes: 1 * GIB })).toBe(1);
  expect(concurrencyFor({ cpus: 8, availableBytes: 0 })).toBe(1);
  expect(concurrencyFor({ cpus: 8, availableBytes: -1 })).toBe(1);
});
