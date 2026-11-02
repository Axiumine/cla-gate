// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { printable } from '../code-caps/types.ts';

// E20-S07: what a memlab run turns into. memlab has no exit code of its own for a leak, so the exit code of the wrapper is
// decided here, from the outcome of every scenario, and nowhere else.

/** Nothing leaked and nothing failed. */
export const EXIT_CLEAN = 0;
/** At least one scenario leaked. */
export const EXIT_LEAKS = 1;
/** memlab or the browser failed, or there was nothing to run: the result cannot be trusted either way. */
export const EXIT_ERROR = 2;

/** Traces printed per scenario, steps printed per trace and characters printed per step; the full text is in leaks.json. */
const MAX_TRACES = 5;
const MAX_STEPS = 12;
const MAX_STEP_LENGTH = 200;

export interface Finished {
  readonly status: 'finished';
  readonly name: string;
  readonly leaks: number;
  /** One list of retainer steps per leak trace, shortest path first as memlab reports it. */
  readonly traces: readonly (readonly string[])[];
}

export interface Failed {
  readonly status: 'failed';
  readonly name: string;
  readonly message: string;
}

export type ScenarioOutcome = Finished | Failed;

/**
 * 0 when every scenario ran and none leaked, 1 when one leaked, 2 when one failed or none ran. An error beats a leak: a run
 * that did not finish says nothing about the scenarios after the failure, and it never counts as clean.
 */
export function exitCodeOf(outcomes: readonly ScenarioOutcome[]): number {
  if (outcomes.length === 0 || outcomes.some((outcome) => outcome.status === 'failed')) {
    return EXIT_ERROR;
  }
  return outcomes.some((outcome) => outcome.status === 'finished' && outcome.leaks > 0) ? EXIT_LEAKS : EXIT_CLEAN;
}

/**
 * The steps of one leak trace. memlab keys a trace by its steps (`0: [Window ...]`, `1: --global_object (shortcut)--->`, ...)
 * and adds bookkeeping keys that start with `$` (the tab order, with the page URL); those are not steps.
 */
export function traceSteps(leak: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(leak).filter((key) => !key.startsWith('$'));
}

function clipped(step: string): string {
  const text = printable(step);
  return text.length > MAX_STEP_LENGTH ? `${text.slice(0, MAX_STEP_LENGTH)}...` : text;
}

/**
 * The lines to print for one scenario. Every trace line is indented, so nothing a page put into a trace can start with
 * `::` and be taken for a workflow command, and control characters are shown escaped.
 */
export function reportLines(outcome: ScenarioOutcome): string[] {
  if (outcome.status === 'failed') {
    return [`scenario ${outcome.name}: ERROR ${printable(outcome.message)}`];
  }
  const head = `scenario ${outcome.name}: ${outcome.leaks} ${outcome.leaks === 1 ? 'leak' : 'leaks'}`;
  const traces = outcome.traces
    .slice(0, MAX_TRACES)
    .flatMap((steps, index) => [
      `  trace ${index + 1} of ${outcome.traces.length}:`,
      ...steps.slice(0, MAX_STEPS).map((step) => `    ${clipped(step)}`),
      ...(steps.length > MAX_STEPS ? [`    ... ${steps.length - MAX_STEPS} more steps`] : []),
    ]);
  return [head, ...traces];
}
