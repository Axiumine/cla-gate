// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { fakeProcess, scenarioModule, trace } from './test-support.ts';

// E20-S07: the helpers of the leaks tests do what their names say, so a test built on them means what it appears to mean.

test('a trace has the bookkeeping key first and one key per step', () => {
  expect(Object.keys(trace('0: a', '1: b'))).toEqual(['$tabsOrder:[...]', '0: a', '1: b']);
});

test('a scenario module has a url on the fixture of that name and an action and a back that resolve', async () => {
  const { url, action, back } = scenarioModule('clean').default;
  expect(url()).toBe('http://127.0.0.1:40000/clean.html');
  await expect(action()).resolves.toBeUndefined();
  await expect(back()).resolves.toBeUndefined();
});

test('the fake process calls every exit listener with the code, in the order they were added', () => {
  const target = fakeProcess();
  const seen: string[] = [];
  target.on('exit', (code) => seen.push(`first ${code}`));
  target.on('exit', (code) => seen.push(`second ${code}`));
  target.fireExit(3);
  expect(seen).toEqual(['first 3', 'second 3']);
  expect(target.exitCode).toBeUndefined();
});
