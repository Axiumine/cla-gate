// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { BASELINE_VERSION, CAPS, CapsError, compareNames, type Measure, measureKey } from './types.ts';

/** Result of comparing current violations with the baseline. */
export interface Verdict {
  readonly added: readonly Measure[];
  readonly grown: readonly { readonly item: Measure; readonly allowed: number }[];
  readonly improved: readonly { readonly key: string; readonly allowed: number; readonly now: number }[];
  readonly fixed: readonly string[];
}

export type Baseline = ReadonlyMap<string, number>;

export function hasFailed(verdict: Verdict): boolean {
  return verdict.added.length > 0 || verdict.grown.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (cause) {
    throw new CapsError(`${path.basename(file)}: ${String(cause)}`, { cause });
  }
}

/** `{key: value}` from the baseline file; empty if missing. Throws `CapsError` if corrupt. */
export function loadBaseline(file: string): Baseline {
  if (!fs.existsSync(file)) {
    return new Map();
  }
  const invalid = new CapsError(`${path.basename(file)} is not a valid code-caps baseline`);
  const data = readJson(file);
  const violations = isRecord(data) ? data['violations'] : undefined;
  if (!isRecord(violations)) {
    throw invalid;
  }
  const result = new Map<string, number>();
  for (const [key, value] of Object.entries(violations)) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw invalid;
    }
    result.set(key, value);
  }
  return result;
}

export function writeBaseline(file: string, violations: Baseline): void {
  const sorted = [...violations].sort(([a], [b]) => compareNames(a, b));
  const payload = { version: BASELINE_VERSION, caps: CAPS, violations: Object.fromEntries(sorted) };
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

/** Classify current violations against the baseline. */
export function compare(current: readonly Measure[], baseline: Baseline): Verdict {
  const added: Measure[] = [];
  const grown: { item: Measure; allowed: number }[] = [];
  const improved: { key: string; allowed: number; now: number }[] = [];
  const seen = new Set<string>();
  for (const item of current) {
    const key = measureKey(item);
    const allowed = baseline.get(key);
    seen.add(key);
    if (allowed === undefined) {
      added.push(item);
    } else if (item.value > allowed) {
      grown.push({ item, allowed });
    } else if (item.value < allowed) {
      improved.push({ key, allowed, now: item.value });
    }
  }
  const fixed = [...baseline.keys()].filter((key) => !seen.has(key)).sort(compareNames);
  return { added, grown, improved, fixed };
}

/** Baseline lowered to the current values; fixed entries dropped; nothing is ever added. */
export function ratcheted(current: readonly Measure[], baseline: Baseline): Baseline {
  const now = new Map(current.map((item) => [measureKey(item), item.value]));
  const lowered = [...baseline].flatMap(([key, old]): [string, number][] => {
    const value = now.get(key);
    return value === undefined ? [] : [[key, Math.min(old, value)]];
  });
  return new Map(lowered);
}
