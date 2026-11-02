// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  EXIT_CLEAN,
  EXIT_ERROR,
  EXIT_LEAKS,
  exitCodeOf,
  type Failed,
  type Finished,
  reportLines,
  traceSteps,
} from './outcome.ts';
import { trace } from './test-support.ts';

// E20-S07: the exit code of the wrapper and the text it prints for a scenario.

function finished(name: string, leaks: number, traces: readonly (readonly string[])[] = []): Finished {
  return { status: 'finished', name, leaks, traces };
}

function failed(name: string, message: string): Failed {
  return { status: 'failed', name, message };
}

test('the three exit codes are 0 clean, 1 leak and 2 error', () => {
  expect([EXIT_CLEAN, EXIT_LEAKS, EXIT_ERROR]).toEqual([0, 1, 2]);
});

test('every scenario clean gives 0', () => {
  expect(exitCodeOf([finished('a', 0), finished('b', 0)])).toBe(0);
});

test('one scenario with one leak gives 1, whichever position it has', () => {
  expect(exitCodeOf([finished('a', 1)])).toBe(1);
  expect(exitCodeOf([finished('a', 0), finished('b', 3), finished('c', 0)])).toBe(1);
  expect(exitCodeOf([finished('a', 7), finished('b', 0)])).toBe(1);
});

test('a failed scenario gives 2, even when the others are clean', () => {
  expect(exitCodeOf([failed('a', 'boom')])).toBe(2);
  expect(exitCodeOf([finished('a', 0), failed('b', 'boom')])).toBe(2);
});

test('an error beats a leak: a run that did not finish is never reported as only a leak', () => {
  expect(exitCodeOf([finished('a', 2), failed('b', 'boom')])).toBe(2);
  expect(exitCodeOf([failed('a', 'boom'), finished('b', 2)])).toBe(2);
});

test('a run of no scenario at all is an error, never a pass', () => {
  expect(exitCodeOf([])).toBe(2);
});

test('the steps of a trace are its keys without the bookkeeping keys that start with a dollar sign', () => {
  const leak = trace('0: [Window](native) @1', '1:   --retainedRows (property)--->  [Array](object) @2');
  expect(traceSteps(leak)).toEqual([
    '0: [Window](native) @1',
    '1:   --retainedRows (property)--->  [Array](object) @2',
  ]);
  expect(traceSteps({})).toEqual([]);
  expect(traceSteps({ $only: 'bookkeeping' })).toEqual([]);
});

test('a clean scenario prints its name and 0 leaks, and no trace', () => {
  expect(reportLines(finished('canary', 0))).toEqual(['scenario canary: 0 leaks']);
});

test('one leak is singular, several are plural, and each trace is listed with its steps indented', () => {
  expect(reportLines(finished('a', 1, [['0: root', '1: --x--->']]))).toEqual([
    'scenario a: 1 leak',
    '  trace 1 of 1:',
    '    0: root',
    '    1: --x--->',
  ]);
  expect(reportLines(finished('b', 2, [['0: first'], ['0: second']]))).toEqual([
    'scenario b: 2 leaks',
    '  trace 1 of 2:',
    '    0: first',
    '  trace 2 of 2:',
    '    0: second',
  ]);
});

test('at most five traces and twelve steps per trace are printed, and the rest is counted', () => {
  const steps = Array.from({ length: 14 }, (_, index) => `${index}: step`);
  const lines = reportLines(
    finished(
      'big',
      7,
      Array.from({ length: 7 }, () => steps),
    ),
  );
  expect(lines.filter((line) => line.startsWith('  trace '))).toHaveLength(5);
  expect(lines.filter((line) => line === '    11: step')).toHaveLength(5);
  expect(lines.filter((line) => line === '    12: step')).toEqual([]);
  expect(lines.filter((line) => line === '    ... 2 more steps')).toHaveLength(5);
  expect(lines[1]).toBe('  trace 1 of 7:');
});

test('a step of exactly twelve is printed whole, and a long step is cut at 200 characters', () => {
  const twelve = Array.from({ length: 12 }, (_, index) => `${index}: s`);
  expect(reportLines(finished('a', 1, [twelve])).join('\n')).not.toContain('more steps');
  const exact = 'x'.repeat(200);
  const lines = reportLines(finished('a', 1, [[exact, 'y'.repeat(201)]]));
  expect(lines[2]).toBe(`    ${exact}`);
  expect(lines[3]).toBe(`    ${'y'.repeat(200)}...`);
});

test('control characters of a trace are shown escaped and every trace line is indented, so none can start a workflow command', () => {
  const lines = reportLines(finished('a', 1, [['::error::injected\nnext', '\u001b[31mred']]));
  expect(lines[2]).toBe('    ::error::injected\\x0anext');
  expect(lines[3]).toBe('    \\x1b[31mred');
  expect(lines.slice(1).every((line) => line.startsWith('  '))).toBe(true);
});

test('a failed scenario prints its name and the message with control characters escaped', () => {
  expect(reportLines(failed('broken', 'No element\nfound'))).toEqual(['scenario broken: ERROR No element\\x0afound']);
});
