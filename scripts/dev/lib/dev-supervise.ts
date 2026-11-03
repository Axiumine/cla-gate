// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Io } from '../../ci/lib/io.ts';

/** A started process: `done` resolves with its exit code (never rejects), `stop` signals it. */
export interface Child {
  readonly stop: (signal: NodeJS.Signals) => void;
  readonly done: Promise<number>;
}

/** A child and the name that error messages call it by. */
export type Named = readonly [name: string, child: Child];

export interface Supervision {
  /** Calls `handler` with the signal on SIGINT and SIGTERM, until the returned function is called. */
  readonly onStop: (handler: (signal: NodeJS.Signals) => void) => () => void;
  readonly io: Io;
}

/**
 * Waits for the first of the children to end. A signal (Ctrl-C, `kill`) stops all of them and counts as a clean stop (0). A
 * child that ends by itself, with any code, stops the others and fails the run: a dev server that is gone leaves the page
 * half dead, so a non-zero exit (the child's own code, or 1 for a child that exited 0) tells the person and any script.
 */
export async function supervise(children: readonly Named[], { onStop, io }: Supervision): Promise<number> {
  // An object, not a variable: only the callback below sets it, which the compiler cannot see through a `let`.
  const stop = { signalled: false };
  const unsubscribe = onStop((signal) => {
    stop.signalled = true;
    children.forEach(([, child]) => {
      child.stop(signal);
    });
  });
  const [name, code] = await Promise.race(children.map(async ([label, child]) => [label, await child.done] as const));
  if (!stop.signalled) {
    io.err(`dev: ${name} exited with code ${code}: stopping the other dev server`);
    children.forEach(([, child]) => {
      child.stop('SIGTERM');
    });
  }
  await Promise.all(children.map(([, child]) => child.done));
  unsubscribe();
  return stop.signalled ? 0 : code || 1;
}
