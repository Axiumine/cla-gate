// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { fail, ok } from '../ci/lib/test-support.ts';
import { callsOf, scripted, verbOf } from './test-support.ts';

// E19-S08: the scripted docker that the tests of the smoke stack stand on.

const compose = (...args: string[]) => ({ file: 'docker', args: ['compose', ...args], env: undefined });

test('the verb of a plain docker call is its first word', () => {
  expect(verbOf({ file: 'docker', args: ['image', 'rm', 'x'], env: undefined })).toBe('image');
});

test('the verb of a compose call is the first word after the flags that take a value', () => {
  expect(verbOf(compose('--project-name', 'p', '--file', 'f', 'up', '--build'))).toBe('up');
});

test('a compose call with only flags has an empty verb, and so has a call with no arguments', () => {
  expect(verbOf(compose('--project-name', 'p'))).toBe('');
  expect(verbOf({ file: 'docker', args: [], env: undefined })).toBe('');
});

test('replies come in order, the last one repeats, and a verb nobody scripted succeeds', async () => {
  const { deps, calls } = scripted({ replies: { up: [fail('first'), ok('second')] } });
  const results = [
    await deps.exec('docker', ['compose', 'up']),
    await deps.exec('docker', ['compose', 'up']),
    await deps.exec('docker', ['compose', 'up']),
    await deps.exec('docker', ['compose', 'logs']),
  ];
  expect(results.map((result) => result.code)).toEqual([1, 0, 0, 0]);
  expect(results[2]?.stdout).toBe('second');
  expect(callsOf(calls, 'up')).toHaveLength(3);
});

test('ports come in order, and a fixed one is used when the list runs out', async () => {
  const { deps } = scripted({ ports: [41_000] });
  expect([await deps.pickPort(), await deps.pickPort()]).toEqual([41_000, 40_999]);
});
