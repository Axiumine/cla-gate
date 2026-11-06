// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  incrementalFileOf,
  MUTATE_EXCLUSIONS,
  SCRIPTS_SHARD,
  SERVER_SHARDS,
  SHARD_NAMES,
  type Shard,
  serverShard,
  UNSHARDED_SERVER_GLOBS,
} from './shards.ts';
import { isMutated, mutantsOf, mutated, originalText, ownersOf } from './test-support.ts';

// E20-S04: the shards of the server and shared scope. Nothing may escape the gate and nothing may be mutated twice, so the
// files on disk are matched against the unsharded scope and against every shard.

const UNSHARDED = [...UNSHARDED_SERVER_GLOBS, ...MUTATE_EXCLUSIONS];
const files = mutated(UNSHARDED, ['src/server', 'src/shared']);
const byName = (a: string, b: string) => a.localeCompare(b);

test('the unsharded scope selects the real server and shared files, and not their tests or helpers', () => {
  expect(files.length).toBeGreaterThan(100);
  expect(files).toEqual(expect.arrayContaining(['src/server/app.ts', 'src/shared/errors.ts']));
  expect(files.filter((file) => /\.test\.ts$|\/test-support\.ts$|\/global-setup\.ts$/.test(file))).toEqual([]);
});

test('every file of the unsharded scope belongs to exactly one shard', () => {
  const owners = files.map((file) => ({ file, owners: ownersOf(file, SERVER_SHARDS, MUTATE_EXCLUSIONS) }));
  expect(owners.filter(({ owners: names }) => names.length === 0)).toEqual([]);
  expect(owners.filter(({ owners: names }) => names.length > 1)).toEqual([]);
});

test('the shards select nothing outside the unsharded scope', () => {
  const sharded = SERVER_SHARDS.flatMap((shard) => mutated([...shard.mutate, ...MUTATE_EXCLUSIONS], ['src']));
  expect(sharded.toSorted(byName)).toEqual(files.toSorted(byName));
});

test('no glob of any shard matches nothing, so a deleted directory or a mistyped glob fails here', () => {
  for (const shard of SERVER_SHARDS) {
    const positive = shard.mutate.filter((glob) => !glob.startsWith('!'));
    for (const glob of positive) {
      expect(mutated([glob, ...MUTATE_EXCLUSIONS], ['src']), `${shard.name}: ${glob}`).not.toEqual([]);
    }
    // A negation takes files out of what the globs before it select, so it has to take at least one, or it is a leftover.
    for (const glob of shard.mutate.filter((each) => each.startsWith('!'))) {
      const without = mutated([...positive, ...MUTATE_EXCLUSIONS], ['src']);
      const within = mutated([...positive, glob, ...MUTATE_EXCLUSIONS], ['src']);
      expect(within.length, `${shard.name}: ${glob}`).toBeLessThan(without.length);
    }
  }
});

test('a file in a directory nobody assigned has no owner, and a file two shards select has two', () => {
  const unassigned = 'src/server/new-directory/handler.ts';
  expect(ownersOf(unassigned, SERVER_SHARDS, MUTATE_EXCLUSIONS)).toEqual([]);
  const overlapping: Shard[] = [
    { name: 'first', mutate: ['src/shared/**/*.ts'] },
    { name: 'second', mutate: ['src/shared/e*.ts'] },
  ];
  expect(ownersOf('src/shared/errors.ts', overlapping, MUTATE_EXCLUSIONS)).toEqual(['first', 'second']);
  expect(ownersOf('src/shared/audit.ts', overlapping, MUTATE_EXCLUSIONS)).toEqual(['first']);
});

test('a test file, a test-support file and a global setup are owned by no shard', () => {
  for (const file of [
    'src/shared/errors.test.ts',
    'src/server/test-support.ts',
    'src/server/adapters/db/global-setup.ts',
  ]) {
    expect(ownersOf(file, SERVER_SHARDS, MUTATE_EXCLUSIONS), file).toEqual([]);
  }
  expect(isMutated('src/shared/errors.test.ts', UNSHARDED)).toBe(false);
});

test('the directories with letter ranges cover the whole alphabet and every digit, so no file name falls between two ranges', () => {
  const ranged = SERVER_SHARDS.filter((shard) => shard.mutate.some((glob) => glob.includes('[')));
  expect(ranged.length).toBeGreaterThan(0);
  for (const directory of [
    'src/server/adapters/github',
    'src/server/adapters/http',
    'src/server/domain',
    'src/server/domain/evaluation',
    'src/server/services',
  ]) {
    for (const first of 'abcdefghijklmnopqrstuvwxyz0123456789') {
      const file = `${directory}/${first}-probe.ts`;
      expect(ownersOf(file, SERVER_SHARDS, MUTATE_EXCLUSIONS), file).toHaveLength(1);
    }
  }
});

test('the shared code is cut by a negation: a name that starts with cla- is in shared-cla, and any other name, near misses included, is in shared', () => {
  for (const file of ['cla-text.ts', 'cla-x.ts', 'cla-.ts']) {
    expect(ownersOf(`src/shared/${file}`, SERVER_SHARDS, MUTATE_EXCLUSIONS), file).toEqual(['shared-cla']);
  }
  for (const file of [
    'cla.ts',
    'cl-text.ts',
    'clb-text.ts',
    'c.ts',
    'check.ts',
    'Cla-text.ts',
    '1cla-text.ts',
    'errors.ts',
  ]) {
    expect(ownersOf(`src/shared/${file}`, SERVER_SHARDS, MUTATE_EXCLUSIONS), file).toEqual(['shared']);
  }
});

// The size rule of the split of 2026-11-06: the nightly run 42014893309 lost five shards of 881 to 4586 mutants to the budget of
// 170 minutes. The count is Stryker's own, from its instrumenter, so it is the figure Stryker prints before the initial test run
// ("Instrumented N source file(s) with M mutant(s)"): no test run is needed, and it takes about a second.
const MAX_MUTANTS = 1500;

test(`no shard has more than ${MAX_MUTANTS} mutants, so a shard that grows past it is split in the pull request that grows it`, async () => {
  const mutants = await mutantsOf(files.map((name) => ({ name, content: originalText(name) })));
  const perFile = new Map<string, number>();
  for (const { fileName } of mutants) {
    perFile.set(fileName, (perFile.get(fileName) ?? 0) + 1);
  }
  const perShard = SERVER_SHARDS.map((shard) => ({
    name: shard.name,
    mutants: files
      .filter((file) => isMutated(file, [...shard.mutate, ...MUTATE_EXCLUSIONS]))
      .reduce((sum, file) => sum + (perFile.get(file) ?? 0), 0),
  }));
  // The guard is not empty: the biggest shards hold a thousand mutants and more.
  expect(Math.max(...perShard.map(({ mutants: count }) => count))).toBeGreaterThan(1000);
  expect(perShard.filter(({ mutants: count }) => count > MAX_MUTANTS)).toEqual([]);
});

test('shard names are unique lower case words joined by hyphens, and none is the name of the scripts shard', () => {
  const names = SERVER_SHARDS.map((shard) => shard.name);
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) {
    expect(name).toMatch(/^[a-z]/);
    for (const word of name.split('-')) {
      expect(word, name).toMatch(/^[a-z0-9]+$/);
    }
  }
  expect(names).not.toContain(SCRIPTS_SHARD);
  expect(SHARD_NAMES).toEqual([...names, SCRIPTS_SHARD]);
  expect(SCRIPTS_SHARD).toBe('scripts');
});

test('every shard lists at least one glob, and every glob stays below src/server or src/shared', () => {
  for (const shard of SERVER_SHARDS) {
    expect(shard.mutate.length, shard.name).toBeGreaterThan(0);
    for (const glob of shard.mutate) {
      expect(glob, shard.name).toMatch(/^!?src\/(?:server|shared)\/.+\.ts$/);
    }
  }
});

test('the shard lookup returns the shard by name and throws for anything else, listing the valid names', () => {
  expect(serverShard('shared-cla')).toEqual({ name: 'shared-cla', mutate: ['src/shared/cla-*.ts'] });
  expect(serverShard('shared').mutate).toEqual(['src/shared/**/*.ts', '!src/shared/cla-*.ts']);
  for (const wrong of ['', 'Shared', 'share', 'scripts', 'shared ', 'all']) {
    expect(() => serverShard(wrong)).toThrow(
      `STRYKER_SHARD must be unset or one of ${SERVER_SHARDS.map((shard) => shard.name).join(', ')}, not ${JSON.stringify(wrong)}`,
    );
  }
});

test('the incremental file of a shard is named after it under reports/, and no two shards share one', () => {
  expect(incrementalFileOf('shared')).toBe('reports/stryker-incremental-shared.json');
  expect(incrementalFileOf(SCRIPTS_SHARD)).toBe('reports/stryker-incremental-scripts.json');
  expect(new Set(SHARD_NAMES.map(incrementalFileOf)).size).toBe(SHARD_NAMES.length);
});
