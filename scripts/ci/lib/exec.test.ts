// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import { expect, test } from 'vitest';
import { execWithTimeout, realExec } from './exec.ts';

/** Runs a one-line Node program, which exists on every machine that runs this test. */
function node(program: string, env?: Readonly<Record<string, string>>) {
  return realExec(process.execPath, ['-e', program], env);
}

test('a successful command resolves with its output and code 0', async () => {
  expect(await node("process.stdout.write('out'); process.stderr.write('warn')")).toEqual({
    code: 0,
    stdout: 'out',
    stderr: 'warn',
  });
});

test('a failing command resolves with its own exit code and stderr instead of rejecting', async () => {
  expect(await node("process.stderr.write('boom'); process.exit(3)")).toEqual({ code: 3, stdout: '', stderr: 'boom' });
});

test('a missing binary is code 127 and says so', async () => {
  const result = await realExec('definitely-not-a-real-binary-cla', []);
  expect(result.code).toBe(127);
  expect(result.stderr).toContain('ENOENT');
});

test('a child killed by a signal is code 1', async () => {
  const result = await node("process.kill(process.pid, 'SIGKILL')");
  expect(result.code).toBe(1);
});

test('the extra environment reaches the child without being a command-line argument', async () => {
  const result = await node('process.stdout.write(process.env.CLA_TEST_SECRET ?? "unset")', {
    CLA_TEST_SECRET: 's3cret',
  });
  expect(result.stdout).toBe('s3cret');
});

test('without extra environment the ambient one is still passed', async () => {
  const result = await node('process.stdout.write(typeof process.env.PATH)');
  expect(result.stdout).toBe('string');
});

test('a command that runs past the timeout is stopped and reported as a failure', async () => {
  const result = await execWithTimeout(200)(process.execPath, ['-e', 'setTimeout(() => undefined, 20000)']);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe('');
});
