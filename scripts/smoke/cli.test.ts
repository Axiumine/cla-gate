// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { Exec } from '../ci/lib/exec.ts';
import { collectIo, fail, ok } from '../ci/lib/test-support.ts';
import { runSmokeCli } from './cli.ts';

// E19-S08: `yarn ci:smoke stop`, the `if: always()` step of the container job.

const RUN = { CLA_SMOKE_RUN: 'cla-smoke-31-1' };

function docker(reply: (args: readonly string[]) => ReturnType<typeof ok>): { exec: Exec; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    exec: (_file, args) => {
      calls.push(args.join(' '));
      return Promise.resolve(reply(args));
    },
  };
}

test.each([[[]], [['start']], [['stop', 'extra']], [['STOP']]])(
  'arguments %j print the usage and exit 2',
  async (argv) => {
    const { io, err } = collectIo();
    const { exec, calls } = docker(() => ok());
    expect(await runSmokeCli(argv, RUN, io, { exec })).toBe(2);
    expect(err).toEqual(['usage: ci-smoke stop']);
    expect(calls).toEqual([]);
  },
);

test('without a recorded run nothing is removed and the step succeeds', async () => {
  const { io, out } = collectIo();
  const { exec, calls } = docker(() => ok());
  expect(await runSmokeCli(['stop'], {}, io, { exec })).toBe(0);
  expect(out).toEqual(['no run recorded in CLA_SMOKE_RUN: nothing to remove']);
  expect(calls).toEqual([]);
});

test('an empty run counts as not recorded', async () => {
  const { io, out } = collectIo();
  expect(
    await runSmokeCli(
      ['stop'],
      { CLA_SMOKE_RUN: '' },
      io,
      docker(() => ok()),
    ),
  ).toBe(0);
  expect(out).toHaveLength(1);
});

test('the run is cleaned up and the counts are printed', async () => {
  const { io, out } = collectIo();
  const { exec } = docker((args) => (args[0] === 'ps' ? ok('c1\n') : ok()));
  expect(await runSmokeCli(['stop'], RUN, io, { exec })).toBe(0);
  expect(out).toEqual([
    'run cla-smoke-31-1: 0 compose projects down, removed 1 containers, 0 networks, 0 volumes and 0 images that were left',
  ]);
});

test('a name that is not a smoke run is refused before docker is called, and exit 1 says why', async () => {
  const { io, err } = collectIo();
  const { exec, calls } = docker(() => ok());
  expect(await runSmokeCli(['stop'], { CLA_SMOKE_RUN: 'production' }, io, { exec })).toBe(1);
  expect(err[0]).toContain('ci-smoke stop: CLA_SMOKE_RUN must be cla-smoke-');
  expect(calls).toEqual([]);
});

test('a failure of docker is reported on stderr, without the control characters of its message, and exit 1', async () => {
  const { io, err, out } = collectIo();
  const { exec } = docker(() => fail('Cannot connect to the Docker daemon\u001b[31m'));
  expect(await runSmokeCli(['stop'], RUN, io, { exec })).toBe(1);
  expect(out).toEqual([]);
  expect(err.join('\n')).toContain('ci-smoke stop: docker compose ls failed: Cannot connect to the Docker daemon');
  expect(err.join('\n')).not.toContain('\u001b');
});
