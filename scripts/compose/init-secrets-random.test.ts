// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { readText } from '../ci/lib/test-support.ts';
import { checkout, GENERATED, toolbox } from './test-support.ts';

// E19-S04: where the generated secrets come from. `openssl rand -hex 32` when it works, the kernel's /dev/urandom when it is
// absent, fails or answers with something that is not 256 bits of hexadecimal, and a refusal when neither works. The PATH of
// each run holds only links to the tools of the script, so the machine's own openssl is never the one that answers.

const FIXED = 'abcdef0123456789'.repeat(4);
const STUB = ['#!/bin/sh', 'echo "$@" >>"$STUB_LOG"', 'printf "%s\\n" "$STUB_OUTPUT"', 'exit "$STUB_STATUS"', ''].join(
  '\n',
);

function values(box: ReturnType<typeof checkout>): string[] {
  return GENERATED.map((name) => box.read(name).trim());
}

test('openssl is asked for 32 random bytes in hex, once per generated secret, and its answer is the secret', () => {
  const box = checkout();
  const log = path.join(box.outside, 'stub.log');
  const run = box.run({ env: { PATH: toolbox(STUB), STUB_LOG: log, STUB_STATUS: '0', STUB_OUTPUT: FIXED } });
  expect([run.status, run.stderr]).toEqual([0, '']);
  expect(values(box)).toEqual(GENERATED.map(() => FIXED));
  expect(box.read('database_url')).toContain(`:${FIXED}@`);
});

test('openssl is asked exactly "rand -hex 32"', () => {
  const box = checkout();
  const log = path.join(box.outside, 'stub.log');
  box.run({ env: { PATH: toolbox(STUB), STUB_LOG: log, STUB_STATUS: '0', STUB_OUTPUT: FIXED } });
  expect(readText(log).split('\n')).toEqual([...GENERATED.map(() => 'rand -hex 32'), '']);
});

test.each([
  ['is not installed', undefined, {}],
  ['fails', STUB, { STUB_STATUS: '1', STUB_OUTPUT: FIXED }],
  ['answers with too little', STUB, { STUB_OUTPUT: 'abcd' }],
  ['answers with something that is not hexadecimal', STUB, { STUB_OUTPUT: 'z'.repeat(64) }],
])('when openssl %s the kernel is the source: 64 hexadecimal characters, all different', (_case, stub, extra) => {
  const box = checkout();
  const log = path.join(box.outside, 'stub.log');
  const run = box.run({ env: { PATH: toolbox(stub), STUB_LOG: log, STUB_STATUS: '0', ...extra } });
  expect([run.status, run.stderr]).toEqual([0, '']);
  expect(values(box).map((value) => /^[0-9a-f]{64}$/.test(value))).toEqual(GENERATED.map(() => true));
  expect(new Set(values(box)).size).toBe(GENERATED.length);
  expect(values(box)).not.toContain(FIXED);
});

test('with no source of randomness at all the run stops, creates no secret and says what to install', () => {
  const box = checkout();
  const run = box.run({ env: { PATH: toolbox(undefined, ['dd']) } });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain(
    'init-secrets: no source of randomness: install openssl, or make /dev/urandom readable\n',
  );
  expect(box.listing()).toEqual([]);
});
