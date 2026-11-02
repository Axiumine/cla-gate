// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { collectIo } from '../ci/lib/test-support.ts';
import { guardExit } from './exit-guard.ts';
import { fakeProcess } from './test-support.ts';

// E20-S07: memlab calls process.exit(1) on an error; the guard makes any exit before the end an error (2).

test('installing the guard changes nothing by itself', () => {
  const target = fakeProcess();
  guardExit(target, collectIo().io);
  expect(target.exitCode).toBeUndefined();
});

test.each([[0], [1], [13]])(
  'an exit with code %i before the wrapper finished becomes exit code 2, with a message',
  (code) => {
    const target = fakeProcess();
    const { io, err } = collectIo();
    guardExit(target, io);
    target.fireExit(code);
    expect(target.exitCode).toBe(2);
    expect(err).toEqual([
      `leaks: the process was ended with code ${code} before every scenario had finished: that is an error`,
    ]);
  },
);

test('once the wrapper has finished, the exit that follows keeps the code the caller set', () => {
  const target = fakeProcess();
  const { io, err } = collectIo();
  const finish = guardExit(target, io);
  finish();
  target.exitCode = 1;
  target.fireExit(1);
  expect(target.exitCode).toBe(1);
  expect(err).toEqual([]);
});
