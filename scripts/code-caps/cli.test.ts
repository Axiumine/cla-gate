// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { expect, test, vi } from 'vitest';
import { loadBaseline } from './baseline.ts';
import { main, parseOptions, STD_IO } from './cli.ts';
import { describeMeasure, report } from './report.ts';
import { capture, func, makeRepo, tempDir } from './test-support.ts';
import { BASELINE_NAME, type Measure } from './types.ts';

const OK = 'export const a = 1;\n';

/** Run the CLI in `root` and return its exit code with the captured output. */
function run(root: string, ...args: string[]): { code: number; out: string[]; err: string[] } {
  const { io, out, err } = capture();
  return { code: main(args, root, io), out, err };
}

/** The user's own `raise`: throws a value that is not an `Error`. */
function raise(value: unknown): never {
  throw value;
}

// --------------------------------------------------------------------------- options

test('options default to the given root and no flags', () => {
  expect(parseOptions([], '/repo')).toEqual({ root: '/repo', init: false, force: false, updateBaseline: false });
});

test('options accept every flag', () => {
  const argv = ['--root', '/other', '--init', '--force', '--update-baseline'];
  expect(parseOptions(argv, '/repo')).toEqual({ root: '/other', init: true, force: true, updateBaseline: true });
});

test('an unknown option is rejected', () => {
  expect(() => parseOptions(['--nope'], '/repo')).toThrow(TypeError);
});

// --------------------------------------------------------------------------- check

test('a clean repository passes', () => {
  const root = tempDir();
  makeRepo(root, { 'ok.ts': OK });
  expect(run(root)).toEqual({ code: 0, out: ['code caps ok (0 tolerated violation(s) in the baseline)'], err: [] });
});

test('a new violation fails and is described', () => {
  const root = tempDir();
  makeRepo(root, { 'big.ts': func('huge', 60) });
  const { code, out, err } = run(root);
  expect(code).toBe(1);
  expect(out).toEqual([]);
  expect(err).toEqual([
    "NEW   big.ts:1: function 'huge' = 60 lines (cap 50)",
    'code caps FAILED: new or grown violations (see above)',
  ]);
});

test('--root overrides the default root', () => {
  const root = tempDir();
  makeRepo(root, { 'ok.ts': OK });
  expect(main(['--root', root], '/does/not/exist', capture().io)).toBe(0);
});

test('a baselined violation is tolerated but not allowed to grow', () => {
  const root = tempDir();
  makeRepo(root, { 'big.ts': func('huge', 60) });
  expect(run(root, '--init').code).toBe(0);
  expect(run(root).out).toEqual(['code caps ok (1 tolerated violation(s) in the baseline)']);
  makeRepo(root, { 'big.ts': func('huge', 65) });
  const { code, err } = run(root);
  expect(code).toBe(1);
  expect(err[0]).toBe("GREW  big.ts:1: function 'huge' = 65 lines (cap 50) (baseline 60)");
});

test('better and fixed entries are reported on stdout without failing', () => {
  const root = tempDir();
  makeRepo(root, { 'big.ts': func('huge', 60), 'other.ts': func('worse', 70) });
  run(root, '--init');
  makeRepo(root, { 'big.ts': func('huge', 55), 'other.ts': OK });
  expect(run(root)).toEqual({
    code: 0,
    out: [
      'better: big.ts::function::huge 60 -> 55 (run --update-baseline to lock it in)',
      'fixed: other.ts::function::worse (run --update-baseline to drop it)',
      'code caps ok (1 tolerated violation(s) in the baseline)',
    ],
    err: [],
  });
});

// --------------------------------------------------------------------------- --init and --update-baseline

test('--init writes the baseline and refuses to overwrite it without --force', () => {
  const root = tempDir();
  makeRepo(root, { 'big.ts': func('huge', 60) });
  expect(run(root, '--init').out).toEqual([`wrote ${BASELINE_NAME} with 1 tolerated violation(s)`]);
  expect(run(root, '--init')).toMatchObject({ code: 2, err: [`${BASELINE_NAME} exists: use --force to overwrite`] });
  expect(run(root, '--init', '--force').code).toBe(0);
});

test('--update-baseline ratchets down, drops fixed entries and refuses new violations', () => {
  const root = tempDir();
  makeRepo(root, { 'big.ts': func('huge', 60), 'old.ts': func('old', 70) });
  run(root, '--init');
  makeRepo(root, { 'big.ts': func('huge', 55), 'old.ts': OK });
  expect(run(root, '--update-baseline')).toEqual({ code: 0, out: [`${BASELINE_NAME} updated`], err: [] });
  expect(loadBaseline(path.join(root, BASELINE_NAME))).toEqual(new Map([['big.ts::function::huge', 55]]));
  makeRepo(root, { 'new.ts': func('worse', 70) });
  const { code, err } = run(root, '--update-baseline');
  expect(code).toBe(1);
  expect(err).toEqual([
    "NEW   new.ts:1: function 'worse' = 70 lines (cap 50)",
    'refusing to update: fix new/grown violations first',
  ]);
});

// --------------------------------------------------------------------------- failures (exit code 2)

test('a syntax error is reported without a stack trace', () => {
  const root = tempDir();
  makeRepo(root, { 'bad.ts': 'function (:\n' });
  const { code, err } = run(root);
  expect(code).toBe(2);
  expect(err).toHaveLength(1);
  expect(err[0]).toMatch(/^code caps: bad\.ts:1: /);
});

test('a corrupt baseline and an unknown option exit with 2', () => {
  const root = tempDir();
  makeRepo(root, { 'ok.ts': OK, [BASELINE_NAME]: '[]' });
  expect(run(root).err).toEqual([`code caps: ${BASELINE_NAME} is not a valid code-caps baseline`]);
  expect(run(root, '--nope').code).toBe(2);
});

test('a thrown value that is not an Error is still reported', () => {
  const root = tempDir();
  makeRepo(root, { 'ok.ts': OK });
  vi.spyOn(fs, 'readFileSync').mockImplementation(() => raise('boom'));
  expect(run(root)).toMatchObject({ code: 2, err: ['code caps: boom'] });
  vi.restoreAllMocks();
});

// --------------------------------------------------------------------------- output

test('describe formats sized caps with a unit and counted caps without', () => {
  const base = { path: 'a.ts', line: 7, name: 'f', value: 9 };
  expect(describeMeasure({ ...base, kind: 'file', name: '-', value: 501 })).toBe('a.ts:7: file = 501 lines (cap 500)');
  expect(describeMeasure({ ...base, kind: 'class', value: 301 })).toBe("a.ts:7: class 'f' = 301 lines (cap 300)");
  expect(describeMeasure({ ...base, kind: 'params', value: 5 })).toBe("a.ts:7: params 'f' = 5 (cap 4)");
  expect(describeMeasure({ ...base, kind: 'nesting', value: 5 })).toBe("a.ts:7: nesting 'f' = 5 (cap 4)");
});

test('report prints nothing for a clean verdict', () => {
  const { io, out, err } = capture();
  report({ added: [], grown: [], improved: [], fixed: [] }, io);
  expect([out, err]).toEqual([[], []]);
});

test('the standard io writes lines to stdout and stderr', () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  STD_IO.out('hello');
  STD_IO.err('oops');
  expect(stdout).toHaveBeenCalledWith('hello\n');
  expect(stderr).toHaveBeenCalledWith('oops\n');
  vi.restoreAllMocks();
});

test('control characters in file names cannot reach the terminal', () => {
  const root = tempDir();
  makeRepo(root, { 'x\u001b[31m.ts': func('huge', 60) });
  expect(run(root).err[0]).toBe("NEW   x\\x1b[31m.ts:1: function 'huge' = 60 lines (cap 50)");
});

test('control characters in names cannot reach the terminal either', () => {
  const item: Measure = { path: 'a.ts', line: 1, kind: 'function', name: 'a\u001b[2Jb', value: 51 };
  expect(describeMeasure(item)).toBe("a.ts:1: function 'a\\x1b[2Jb' = 51 lines (cap 50)");
});
