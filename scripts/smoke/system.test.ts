// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { realExec } from '../ci/lib/exec.ts';
import { pickSystemFreePort } from '../ci/lib/ports.ts';
import { exists } from '../ci/lib/test-support.ts';
import { cliDeps, stackDeps } from './system.ts';

// E19-S08: the real dependencies of the smoke test are the checkout, the process and the helpers of scripts/ci/lib.

test('the clean-up uses the default docker runner and the stacks a longer one', () => {
  expect(cliDeps.exec).toBe(realExec);
  expect(stackDeps.exec).not.toBe(realExec);
});

test('ports come from the random loopback probe of the CI helpers', () => {
  expect(stackDeps.pickPort).toBe(pickSystemFreePort);
});

test('the checkout is the repository: it holds the compose file, and the logs go to reports/smoke below it', () => {
  expect(exists(path.join(stackDeps.root, 'docker-compose.yml'))).toBe(true);
  expect(stackDeps.logsDirectory).toBe(path.join(stackDeps.root, 'reports', 'smoke'));
  expect(stackDeps.env).toBe(process.env);
});

test('the random integer includes both ends of the range', () => {
  const draws = new Set(Array.from({ length: 400 }, () => stackDeps.randomInt(3, 4)));
  expect([...draws].toSorted((a, b) => a - b)).toEqual([3, 4]);
});

test('the random tail is as many hexadecimal characters as twice the bytes asked for', () => {
  expect(stackDeps.randomHex(4)).toMatch(/^[0-9a-f]{8}$/);
  expect(stackDeps.randomHex(4)).not.toBe(stackDeps.randomHex(4));
});
