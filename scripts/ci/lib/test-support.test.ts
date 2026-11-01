// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { collectIo, fail, fakeDocker, findOnPath, ok } from './test-support.ts';

test('replies are queued per verb, the last one repeats and every call is recorded', async () => {
  const docker = fakeDocker([['inspect', [ok('first'), ok('second')]]]);
  const stdouts = [
    (await docker.exec('docker', ['inspect', 'x'])).stdout,
    (await docker.exec('docker', ['inspect', 'x'])).stdout,
    (await docker.exec('docker', ['inspect', 'x'])).stdout,
  ];
  expect(stdouts).toEqual(['first', 'second', 'second']);
  expect(docker.calls).toHaveLength(3);
});

test('a verb nobody scripted succeeds with no output, and so does a call without arguments', async () => {
  const docker = fakeDocker();
  expect(await docker.exec('docker', ['logs', 'x'])).toEqual({ code: 0, stdout: '', stderr: '' });
  expect(await docker.exec('docker', [])).toEqual({ code: 0, stdout: '', stderr: '' });
});

test('an empty queue behaves like an unscripted verb', async () => {
  const docker = fakeDocker([['rm', []]]);
  expect(await docker.exec('docker', ['rm', 'x'])).toEqual(ok());
});

test('fail carries stderr and a code, collectIo records both streams separately', () => {
  expect(fail('boom', 125)).toEqual({ code: 125, stdout: '', stderr: 'boom' });
  expect(fail('boom').code).toBe(1);
  const { io, out, err } = collectIo();
  io.out('a');
  io.err('b');
  expect([out, err]).toEqual([['a'], ['b']]);
});

test('findOnPath returns the absolute path of a tool on the PATH, and says which tool is missing', () => {
  expect(findOnPath('node')).toMatch(/^\/.+\/node$/);
  expect(() => findOnPath('no-such-tool-for-cla-tests')).toThrow('no-such-tool-for-cla-tests is needed by this test');
});
