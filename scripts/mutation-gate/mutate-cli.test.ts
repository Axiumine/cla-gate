// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { Env } from '../ci/lib/env.ts';
import { collectIo } from '../ci/lib/test-support.ts';
import { type MutateDeps, type Outcome, runMutateCli } from './mutate-cli.ts';
import { SERVER_SHARDS, SHARD_NAMES } from './shards.ts';

// E20-S04: `yarn mutate` and `yarn mutate:shard`. The runner is a fake that records every Stryker start.

interface Start {
  readonly args: readonly string[];
  readonly shard: string | undefined;
  readonly scope: string | undefined;
  readonly env: Env;
  readonly budgetMs: number | undefined;
}

/** Runs the CLI with a fake Stryker; `outcomes` are the results of the successive starts (the last repeats, default exit 0). */
async function mutate(argv: readonly string[], env: Env = {}, outcomes: readonly Outcome[] = []) {
  const starts: Start[] = [];
  const deps: MutateDeps = {
    run: (args, childEnv, budgetMs) => {
      starts.push({
        args,
        shard: childEnv['STRYKER_SHARD'],
        scope: childEnv['STRYKER_SCOPE'],
        env: childEnv,
        budgetMs,
      });
      return Promise.resolve(outcomes.at(Math.min(starts.length, outcomes.length) - 1) ?? { code: 0, timedOut: false });
    },
  };
  const { io, out, err } = collectIo();
  const code = await runMutateCli(argv, env, io, deps);
  return { code, starts, out, err };
}

const OK: Outcome = { code: 0, timedOut: false };
const SERVER_NAMES = SERVER_SHARDS.map((shard) => shard.name);

test('--all runs every server shard and then the scripts scope, one Stryker run each, always incremental', async () => {
  const result = await mutate(['--all']);
  expect(result.code).toBe(0);
  expect(result.starts.map((start) => start.args)).toEqual(SHARD_NAMES.map(() => ['run', '--incremental']));
  expect(result.starts.slice(0, -1).map((start) => start.shard)).toEqual(SERVER_NAMES);
  expect(result.starts.slice(0, -1).map((start) => start.scope)).toEqual(SERVER_NAMES.map(() => undefined));
});

test('the scripts shard runs in the scripts scope and without STRYKER_SHARD, which the config rejects next to it', async () => {
  const result = await mutate(['scripts']);
  expect(result.starts).toHaveLength(1);
  expect(result.starts[0]?.scope).toBe('scripts');
  expect(result.starts[0]?.shard).toBeUndefined();
  const fromEnvironment = await mutate([], { STRYKER_SHARD: 'scripts' });
  expect(fromEnvironment.starts[0]?.scope).toBe('scripts');
  expect(fromEnvironment.starts[0]?.shard).toBeUndefined();
});

test('a server shard sets STRYKER_SHARD and clears a STRYKER_SCOPE left in the environment', async () => {
  const result = await mutate(['shared'], { STRYKER_SCOPE: 'scripts', PATH: '/usr/bin' });
  expect(result.starts[0]?.shard).toBe('shared');
  expect(result.starts[0]?.scope).toBeUndefined();
  expect(result.starts[0]?.env['PATH']).toBe('/usr/bin');
});

test('the shard comes from the first argument or, without one, from STRYKER_SHARD', async () => {
  expect((await mutate(['config'])).starts.map((start) => start.shard)).toEqual(['config']);
  expect((await mutate([], { STRYKER_SHARD: 'config' })).starts.map((start) => start.shard)).toEqual(['config']);
  expect((await mutate(['config'], { STRYKER_SHARD: 'config' })).starts.map((start) => start.shard)).toEqual([
    'config',
  ]);
});

test('every other argument goes to Stryker, after --incremental, for a shard from an argument and from the environment', async () => {
  expect((await mutate(['shared', '--force'])).starts[0]?.args).toEqual(['run', '--incremental', '--force']);
  expect((await mutate(['--force'], { STRYKER_SHARD: 'shared' })).starts[0]?.args).toEqual([
    'run',
    '--incremental',
    '--force',
  ]);
  expect((await mutate(['--all', '--force', '--concurrency', '4'])).starts.map((start) => start.args)).toEqual(
    SHARD_NAMES.map(() => ['run', '--incremental', '--force', '--concurrency', '4']),
  );
});

test.each([[['sharde']], [['Shared']], [['scripts ']], [['all']], [['--force']], [[]]])(
  '%j names no shard: usage and exit code 2, and nothing runs',
  async (argv) => {
    const result = await mutate(argv);
    expect(result.code).toBe(2);
    expect(result.starts).toEqual([]);
    expect(result.err.join('\n')).toContain(`shards: ${SHARD_NAMES.join(', ')}`);
  },
);

test('the message says what was wrong: nothing given, or a name that is not a shard', async () => {
  expect((await mutate([])).err[0]).toBe('no shard given');
  expect((await mutate(['sharde'])).err[0]).toBe('"sharde" is not a shard');
  expect((await mutate([], { STRYKER_SHARD: 'nope' })).err[0]).toBe('"nope" is not a shard');
});

test('an argument and STRYKER_SHARD that name different shards are an error, not a guess', async () => {
  const result = await mutate(['shared'], { STRYKER_SHARD: 'config' });
  expect(result.code).toBe(2);
  expect(result.starts).toEqual([]);
  expect(result.err[0]).toBe('the argument "shared" and STRYKER_SHARD="config" name different shards');
});

test('--all together with STRYKER_SHARD is an error: it would otherwise silently run something else', async () => {
  const result = await mutate(['--all'], { STRYKER_SHARD: 'config' });
  expect(result.code).toBe(2);
  expect(result.starts).toEqual([]);
  expect(result.err[0]).toBe('--all runs every shard, so STRYKER_SHARD must be unset (it is "config")');
});

test('control characters in a wrong name are escaped in the message', async () => {
  const result = await mutate(['bad\u001b[31mname']);
  expect(result.err[0]).not.toContain('\u001b');
});

test('MUTATE_BUDGET_MINUTES becomes a budget in milliseconds for every Stryker run, and unset means no budget', async () => {
  expect((await mutate(['shared'], { MUTATE_BUDGET_MINUTES: '50' })).starts[0]?.budgetMs).toBe(3_000_000);
  expect((await mutate(['--all'], { MUTATE_BUDGET_MINUTES: '1' })).starts.map((start) => start.budgetMs)).toEqual(
    SHARD_NAMES.map(() => 60_000),
  );
  expect((await mutate(['shared'])).starts[0]?.budgetMs).toBeUndefined();
  expect((await mutate(['shared'], { MUTATE_BUDGET_MINUTES: '' })).starts[0]?.budgetMs).toBeUndefined();
});

test.each(['0', '-5', '1.5', 'abc', '50 ', '10000', '07'])(
  'a budget of %j is an error before anything runs, never an unlimited run',
  async (budget) => {
    const result = await mutate(['shared'], { MUTATE_BUDGET_MINUTES: budget });
    expect(result.code).toBe(2);
    expect(result.starts).toEqual([]);
    expect(result.err[0]).toMatch(/^MUTATE_BUDGET_MINUTES must be a whole number of minutes from 1 to 9999, not /);
  },
);

test('a failing shard fails the run, the other shards still run, and the summary names the failed ones', async () => {
  const failed: Outcome = { code: 1, timedOut: false };
  const result = await mutate(['--all'], {}, [OK, failed, OK, failed, OK]);
  expect(result.code).toBe(1);
  expect(result.starts).toHaveLength(SHARD_NAMES.length);
  expect(result.err.at(-1)).toBe(
    `mutation: 2 of ${SHARD_NAMES.length} shard(s) failed: ${SHARD_NAMES[1]}, ${SHARD_NAMES[3]}`,
  );
});

test('the exit code of a single shard decides the run, and each shard reports its own exit code', async () => {
  expect((await mutate(['shared'], {}, [OK])).code).toBe(0);
  const failed = await mutate(['shared'], {}, [{ code: 7, timedOut: false }]);
  expect(failed.code).toBe(1);
  expect(failed.out).toContain('mutation shard shared: exit code 7');
  expect(failed.err).toEqual(['mutation: 1 of 1 shard(s) failed: shared']);
});

test('a shard stopped by its budget fails and says that the next run continues from the saved results', async () => {
  const result = await mutate(['shared'], { MUTATE_BUDGET_MINUTES: '5' }, [{ code: 130, timedOut: true }]);
  expect(result.code).toBe(1);
  expect(result.err[0]).toBe(
    'mutation shard shared: stopped after the MUTATE_BUDGET_MINUTES budget; Stryker saves the results of the mutants it had finished (none are saved when it is stopped before the first result), and the next run continues from them',
  );
  const quiet = await mutate(['shared'], { MUTATE_BUDGET_MINUTES: '5' }, [OK]);
  expect(quiet.err).toEqual([]);
});

test('each shard announces itself with the Stryker command it runs', async () => {
  const result = await mutate(['config', '--force']);
  expect(result.out).toEqual([
    'mutation shard config: stryker run --incremental --force',
    'mutation shard config: exit code 0',
  ]);
  expect((await mutate(['config'])).out[0]).toBe('mutation shard config: stryker run --incremental');
});
