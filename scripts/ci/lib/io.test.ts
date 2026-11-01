// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { expect, test, vi } from 'vitest';
import { stdIo } from './io.ts';

test('stdIo writes one line per call to stdout and stderr', () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  stdIo.out('to out');
  stdIo.err('to err');
  expect(stdout).toHaveBeenCalledExactlyOnceWith('to out\n');
  expect(stderr).toHaveBeenCalledExactlyOnceWith('to err\n');
});
