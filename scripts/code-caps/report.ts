// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Verdict } from './baseline.ts';
import { CAPS, type Measure, printable } from './types.ts';

export interface Io {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const SIZE_KINDS: ReadonlySet<string> = new Set(['file', 'function', 'class']);

/** @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode). */
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
