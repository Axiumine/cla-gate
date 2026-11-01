// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { compare, hasFailed, loadBaseline, ratcheted, type Verdict, writeBaseline } from './baseline.ts';
import { measureRepo } from './files.ts';
import { BASELINE_NAME, CAPS, type Measure, measureKey, printable } from './types.ts';

export interface Io {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface Options {
  readonly root: string;
  readonly init: boolean;
  readonly force: boolean;
  readonly updateBaseline: boolean;
}

export const STD_IO: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

const SIZE_KINDS: ReadonlySet<string> = new Set(['file', 'function', 'class']);

/** Throws on an unknown option (reported as exit code 2). */
export function parseOptions(argv: readonly string[], defaultRoot: string): Options {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      root: { type: 'string' },
      init: { type: 'boolean' },
      force: { type: 'boolean' },
      'update-baseline': { type: 'boolean' },
    },
    strict: true,
  });
  return {
    root: values.root ?? defaultRoot,
    init: values.init ?? false,
    force: values.force ?? false,
    updateBaseline: values['update-baseline'] ?? false,
  };
}

export function describeMeasure(item: Measure): string {
  const what = item.kind === 'file' ? 'file' : `${item.kind} '${printable(item.name)}'`;
  const unit = SIZE_KINDS.has(item.kind) ? ' lines' : '';
  return `${printable(item.path)}:${item.line}: ${what} = ${item.value}${unit} (cap ${CAPS[item.kind]})`;
}

export function report(verdict: Verdict, io: Io): void {
  for (const item of verdict.added) {
    io.err(`NEW   ${describeMeasure(item)}`);
  }
  for (const { item, allowed } of verdict.grown) {
    io.err(`GREW  ${describeMeasure(item)} (baseline ${allowed})`);
  }
  for (const { key, allowed, now } of verdict.improved) {
    io.out(`better: ${printable(key)} ${allowed} -> ${now} (run --update-baseline to lock it in)`);
  }
  for (const key of verdict.fixed) {
    io.out(`fixed: ${printable(key)} (run --update-baseline to drop it)`);
  }
}

function runInit(options: Options, current: readonly Measure[], io: Io): number {
  const target = path.join(options.root, BASELINE_NAME);
  if (fs.existsSync(target) && !options.force) {
    io.err(`${BASELINE_NAME} exists: use --force to overwrite`);
    return 2;
  }
  writeBaseline(target, new Map(current.map((item) => [measureKey(item), item.value])));
  io.out(`wrote ${BASELINE_NAME} with ${current.length} tolerated violation(s)`);
  return 0;
}

function runUpdate(root: string, current: readonly Measure[], io: Io): number {
  const target = path.join(root, BASELINE_NAME);
  const baseline = loadBaseline(target);
  const verdict = compare(current, baseline);
  if (hasFailed(verdict)) {
    report(verdict, io);
    io.err('refusing to update: fix new/grown violations first');
    return 1;
  }
  writeBaseline(target, ratcheted(current, baseline));
  io.out(`${BASELINE_NAME} updated`);
  return 0;
}

function runCheck(root: string, current: readonly Measure[], io: Io): number {
  const verdict = compare(current, loadBaseline(path.join(root, BASELINE_NAME)));
  report(verdict, io);
  if (hasFailed(verdict)) {
    io.err('code caps FAILED: new or grown violations (see above)');
    return 1;
  }
  io.out(`code caps ok (${current.length} tolerated violation(s) in the baseline)`);
  return 0;
}

/** Exit code: 0 ok, 1 new or grown violations, 2 unusable input (syntax error, bad baseline, bad option). */
export function main(argv: readonly string[], defaultRoot: string, io: Io = STD_IO): number {
  try {
    const options = parseOptions(argv, defaultRoot);
    const current = measureRepo(options.root);
    if (options.init) {
      return runInit(options, current, io);
    }
    return options.updateBaseline ? runUpdate(options.root, current, io) : runCheck(options.root, current, io);
  } catch (error) {
    io.err(`code caps: ${printable(error instanceof Error ? error.message : String(error))}`);
    return 2;
  }
}
